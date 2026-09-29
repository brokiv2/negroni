import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { CodexAgentRuntime } from "@rakazo/adapters";
import { describe, expect, it } from "vitest";
import { startModelEmulator } from "./model-emulator.js";

const binary = process.env.CODEX_TEST_BINARY;
const request = (
  model: AgentRunRequest["model"],
  extra: Partial<AgentRunRequest> = {},
): AgentRunRequest => ({
  botId: "fixture",
  threadId: "fixture",
  runId: randomUUID(),
  prompt: "Read the note",
  instructions: "Use the tools, then answer.",
  history: [],
  model,
  tools: [
    {
      name: "read_note",
      description: "Read a note",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  ...extra,
});
async function collect(events: AsyncIterable<AgentRuntimeEvent>) {
  const result: AgentRuntimeEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe.skipIf(!binary)("real Codex core with an offline model endpoint", () => {
  it("executes an application tool and streams the model's answer", async () => {
    const server = await startModelEmulator({
      apiKey: "fixture-key",
      steps: [
        { expect() {}, response: { type: "tool", name: "read_note", id: "read1", arguments: {} } },
        {
          expect(input) {
            expect(input.messages.findLast((m) => m.role === "tool")?.content).toContain(
              "fixture note",
            );
          },
          response: { type: "text", text: "The note is ready." },
        },
      ],
    });
    try {
      const events = await collect(
        new CodexAgentRuntime({ binary }).run(
          request(server.model, { executeTool: async () => ({ text: "fixture note" }) }),
        ),
      );
      expect(
        events
          .filter((e) => e.type === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe("The note is ready.");
      expect(events.some((e) => e.type === "tool" && e.name === "read_note")).toBe(true);
      expect(events.at(-1)?.type).toBe("done");
    } finally {
      await server.close();
      server.assertComplete();
    }
  }, 30_000);
});

describe.skipIf(!binary)("Codex lifecycle and delegation", () => {
  it("runs a temporary helper on Codex and returns its result to the parent", async () => {
    const server = await startModelEmulator({
      steps: [
        {
          expect() {},
          response: {
            type: "tool",
            id: "delegate1",
            name: "run_subagent",
            arguments: { name: "Scout", task: "Find a fact" },
          },
        },
        {
          expect(input) {
            expect(input.tools?.some((t) => t.function.name === "run_subagent")).toBe(false);
          },
          response: { type: "text", text: "Verified fixture fact." },
        },
        {
          expect(input) {
            expect(input.messages.findLast((m) => m.role === "tool")?.content).toContain(
              "Verified fixture fact.",
            );
          },
          response: { type: "text", text: "Here is the result." },
        },
      ],
    });
    try {
      const events = await collect(
        new CodexAgentRuntime({ binary }).run(
          request(server.model, {
            tools: [
              {
                name: "run_subagent",
                description: "Delegate a short task",
                inputSchema: {
                  type: "object",
                  properties: { name: { type: "string" }, task: { type: "string" } },
                  required: ["name", "task"],
                },
              },
              {
                name: "read_note",
                description: "Read",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }),
        ),
      );
      expect(events.filter((e) => e.type === "subagent").map((e) => e.status)).toEqual([
        "running",
        "completed",
      ]);
      expect(
        events
          .filter((e) => e.type === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe("Here is the result.");
      server.assertComplete();
    } finally {
      await server.close();
    }
  }, 30_000);

  it("stops at an approval without letting the model claim completion", async () => {
    const server = await startModelEmulator({
      steps: [
        {
          expect() {},
          response: { type: "tool", id: "approval1", name: "read_note", arguments: {} },
        },
      ],
    });
    try {
      const events = await collect(
        new CodexAgentRuntime({ binary }).run(
          request(server.model, {
            executeTool: async () => ({
              kind: "agent_tool_result",
              content: [{ type: "text", text: "Waiting for approval." }],
              details: { approval: "paused" },
              terminate: true,
            }),
          }),
        ),
      );
      expect(events.some((e) => e.type === "done")).toBe(false);
      server.assertComplete();
    } finally {
      await server.close();
    }
  }, 30_000);

  it("uses persisted conversation history without replacing the current user turn", async () => {
    const server = await startModelEmulator({
      steps: [
        {
          expect(input) {
            const text = JSON.stringify(input.messages);
            expect(text).toContain("Earlier fact");
            expect(text).toContain("Read the note");
          },
          response: { type: "text", text: "I remember." },
        },
      ],
    });
    try {
      const events = await collect(
        new CodexAgentRuntime({ binary }).run(
          request(server.model, {
            history: [
              { role: "user", content: "Earlier fact" },
              { role: "assistant", content: "Recorded." },
            ],
          }),
        ),
      );
      expect(events.some((e) => e.type === "done")).toBe(true);
      server.assertComplete();
    } finally {
      await server.close();
    }
  }, 30_000);

  it("does not dispatch a tool that was not supplied by the executor", async () => {
    let calls = 0;
    const server = await startModelEmulator({
      steps: Array.from({ length: 8 }, () => ({
        expect() {},
        response: {
          type: "tool" as const,
          id: "bad",
          name: "exec_command",
          arguments: { cmd: "fixture" },
        },
      })),
    });
    try {
      await expect(
        collect(
          new CodexAgentRuntime({ binary }).run(
            request(server.model, {
              executeTool: async () => {
                calls++;
              },
            }),
          ),
        ),
      ).rejects.toThrow();
      expect(calls).toBe(0);
    } finally {
      await server.close();
    }
  }, 30_000);
});

describe.skipIf(!binary)("Codex cancellation", () => {
  it("aborts a quiet model stream and closes the run", async () => {
    let started!: () => void;
    const modelStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = await startModelEmulator({
      steps: [
        {
          expect() {
            started();
          },
          response: { type: "hold", onOpen: started },
        },
      ],
    });
    const runtime = new CodexAgentRuntime({ binary });
    const turn = request(server.model);
    const events = collect(runtime.run(turn));
    try {
      await modelStarted;
      await runtime.abort(turn.runId);
      const result = await events;
      expect(result.some((e) => e.type === "done")).toBe(false);
    } finally {
      await server.close();
    }
  }, 15_000);
});
