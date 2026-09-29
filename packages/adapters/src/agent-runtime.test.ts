import type { AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { parseAgentModelRouting, RoutedAgentRuntime } from "./agent-runtime.js";

const request: AgentRunRequest = {
  botId: "b",
  threadId: "t",
  runId: "r",
  prompt: "Hello",
  instructions: "Own the conversation",
  history: [],
  tools: [],
  model: { provider: "original", id: "original" },
};
const routes = {
  conversation: { provider: "fast-provider", modelId: "fast" },
  task: { provider: "task-provider", modelId: "task" },
};
function fixture() {
  const received: AgentRunRequest[] = [];
  const runtime: AgentRuntime = {
    describe: () => ({
      id: "test",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
    }),
    abort: vi.fn(),
    async *run(next) {
      received.push(next);
      yield { type: "done" };
    },
  };
  return { received, runtime: new RoutedAgentRuntime(runtime, async () => routes) };
}
async function drain(value: ReturnType<AgentRuntime["run"]>) {
  for await (const _event of value) {
  }
}

describe("model profiles", () => {
  it("routes conversation and task work through scoped credential resolution", async () => {
    const { runtime, received } = fixture();
    const resolveModel = vi.fn(async (provider: string, id: string) => ({
      provider,
      id,
      apiKey: "fixture-key",
    }));
    await drain(runtime.run({ ...request, workload: "conversation", resolveModel }));
    await drain(runtime.run({ ...request, workload: "task", resolveModel }));
    expect(received.map((r) => r.model.id)).toEqual(["fast", "task"]);
    expect(received[0]!.instructions).toContain("run_subagent");
    expect((await received[0]!.resolveTaskModel!()).id).toBe("task");
  });
  it("does not silently fall back when a selected connection is unavailable", async () => {
    const { runtime, received } = fixture();
    await expect(
      drain(
        runtime.run({
          ...request,
          workload: "conversation",
          resolveModel: async () => {
            throw new Error("Connection required");
          },
        }),
      ),
    ).rejects.toThrow("Connection required");
    expect(received).toEqual([]);
  });
  it("rejects malformed routing and keeps credentials out of its parsed configuration", () => {
    expect(() => parseAgentModelRouting({ task: { provider: "p" } })).toThrow();
    expect(
      parseAgentModelRouting({ task: { provider: "p", modelId: "m", apiKey: "unwanted" } }),
    ).toEqual({ task: { provider: "p", modelId: "m" } });
  });
});
