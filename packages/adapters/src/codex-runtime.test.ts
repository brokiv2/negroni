import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./codex-model-bridge.js", () => ({
  startCodexModelBridge: async () => ({
    baseUrl: "http://127.0.0.1:9/v1",
    token: "bridge-token",
    close: async () => undefined,
  }),
}));

const { CodexAgentRuntime } = await import("./codex-runtime.js");

/**
 * A minimal stand-in for `codex app-server`: JSON-RPC over stdio, one dynamic tool call
 * per turn, and (like plugin sync) a helper process that keeps writing into CODEX_HOME.
 */
function fakeServer(record: string, mode: "tool" | "crash") {
  return `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const home = process.env.CODEX_HOME;
fs.mkdirSync(path.join(home, ".tmp", "plugins-clone"), { recursive: true });
const helper = spawn(process.execPath, ["-e", "const fs=require('fs');let i=0;setInterval(()=>{try{fs.writeFileSync(process.argv[1]+'/f'+(i++),'x')}catch{}},2)", path.join(home, ".tmp", "plugins-clone")], { stdio: "ignore" });
const state = { argv: process.argv.slice(2), home, helperPid: helper.pid };
const save = () => fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(state));
save();
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "thread/start") { state.features = m.params.config.features; save(); send({ id: m.id, result: { thread: { id: "t1" } } }); }
  else if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "u1" } } });
    if (${JSON.stringify(mode)} === "crash") process.exit(3);
    send({ id: 900, method: "item/tool/call", params: { tool: "probe_tool", callId: "c1", arguments: {} } });
  } else if (m.id === 900) {
    state.toolResult = m.result; save();
    send({ method: "item/agentMessage/delta", params: { delta: "answer" } });
    send({ method: "turn/completed", params: { turn: { status: "completed" } } });
  }
});
`;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function request(executeTool: AgentRunRequest["executeTool"]): AgentRunRequest {
  return {
    botId: "bot",
    threadId: "thread",
    runId: `run-${Math.random().toString(36).slice(2)}`,
    prompt: "hello",
    instructions: "test",
    history: [],
    tools: [{ name: "probe_tool", description: "probe", inputSchema: { type: "object" } }],
    model: { provider: "test", id: "fake-model" },
    executeTool,
  } as AgentRunRequest;
}

async function collect(iterable: AsyncIterable<AgentRuntimeEvent>) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe.skipIf(process.platform === "win32")("Codex runtime process handling", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "codex-runtime-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function install(mode: "tool" | "crash") {
    const record = join(root, "record.json");
    const binary = join(root, "codex");
    await writeFile(binary, fakeServer(record, mode));
    await chmod(binary, 0o700);
    return { binary, record: () => JSON.parse(readFileSync(record, "utf8")) };
  }

  it("disables plugin sync, stops helper processes and removes its home", async () => {
    const { binary, record } = await install("tool");
    const runtime = new CodexAgentRuntime({ binary });
    const events = await collect(runtime.run(request(async () => ({ ok: true }))));

    expect(events.filter((e) => e.type === "text").map((e) => e.text)).toEqual(["answer"]);
    expect(events.at(-1)).toEqual({ type: "done" });
    const state = record();
    expect(state.argv).toEqual([
      "app-server",
      "-c",
      "features.plugins=false",
      "-c",
      "features.remote_plugin=false",
      "-c",
      "features.apps=false",
    ]);
    expect(state.features).toMatchObject({ shell_tool: false, shell_snapshot: false });
    expect(state.toolResult.success).toBe(true);
    // The helper shared the server's process group; a SIGTERM to the server alone left
    // it writing into the home while rm ran (ENOTEMPTY).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(state.helperPid)).toBe(false);
    expect(existsSync(state.home)).toBe(false);
  });

  it("tells the model a tool returned an error instead of reporting success", async () => {
    const { binary, record } = await install("tool");
    const runtime = new CodexAgentRuntime({ binary });
    await collect(runtime.run(request(async () => ({ error: "command timed out" }))));
    expect(record().toolResult.success).toBe(false);
  });

  it("surfaces an engine exit mid-turn as a clear failure", async () => {
    const { binary, record } = await install("crash");
    const runtime = new CodexAgentRuntime({ binary });
    await expect(collect(runtime.run(request(async () => ({ ok: true }))))).rejects.toThrow(
      /Agent engine stopped unexpectedly \(exit 3\)/,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(record().helperPid)).toBe(false);
    expect(existsSync(record().home)).toBe(false);
  });

  it("reports a missing engine as a start failure, not a generic exit", async () => {
    const runtime = new CodexAgentRuntime({ binary: "negroni-missing-codex-binary" });
    await expect(collect(runtime.run(request(async () => ({ ok: true }))))).rejects.toThrow(
      /Agent engine could not start \(ENOENT\)/,
    );
  });
});

it("leaves no orphaned fake servers behind", () => {
  const listed = spawnSync("pgrep", ["-f", "codex-runtime-test-"], { encoding: "utf8" });
  expect(listed.stdout.trim()).toBe("");
});
