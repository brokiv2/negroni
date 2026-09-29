import type { AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import { emptyModelRouting, ModelRoutingSchema } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { routeModel } from "./model-router.js";

const fast = { provider: "gateway", modelId: "deepseek/fast" };
const task = { provider: "subscription", modelId: "glm" };
const router = { provider: "gateway", modelId: "openai/gpt" };
function fixture(reply: string) {
  const received: AgentRunRequest[] = [];
  const runtime = {
    describe: () => ({
      id: "fixture",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
    }),
    abort: vi.fn(),
    async *run(request: AgentRunRequest) {
      received.push(request);
      yield { type: "text", text: reply };
      yield { type: "done" };
    },
  } as AgentRuntime;
  const resolve = vi.fn(async (r) => ({
    provider: r.provider,
    id: r.modelId,
    apiKey: "fake-test-key",
  }));
  const input = {
    routing: { enabled: [fast, task, router], conversation: fast, task, router },
    workload: "conversation" as const,
    prompt: "Plan a migration",
    history: [],
    runtime,
    resolve,
    runId: "r",
    botId: "b",
    threadId: "t",
    context: {},
    onUsage: vi.fn(),
  };
  return { input, received, resolve };
}
describe("model orchestration", () => {
  it("keeps Auto inside the enabled pool when role defaults are not set", async () => {
    const { input } = fixture("");
    expect(
      await routeModel({ ...input, routing: { ...emptyModelRouting(), enabled: [fast] } }),
    ).toEqual(fast);
  });
  it("uses the router credential and returns only a configured provider/model pair", async () => {
    const { input, received, resolve } = fixture('{"index":1}');
    expect(await routeModel(input)).toEqual(task);
    expect(resolve).toHaveBeenCalledWith(router);
    expect(received[0]?.tools).toEqual([]);
    expect(received[0]?.modelRoutingApplied).toBe(true);
    expect(received[0]?.executeTool).toBeUndefined();
  });
  it.each(['{"index":99}', '{"index":-1}', '{"index":"1"}', "Use the expensive model"])(
    "rejects invalid classifier output: %s",
    async (reply) => {
      await expect(routeModel(fixture(reply).input)).rejects.toThrow();
    },
  );
  it("uses the task profile without an extra model call when no router is configured", async () => {
    const { input, received } = fixture("");
    expect(
      await routeModel({ ...input, workload: "task", routing: { ...input.routing, router: null } }),
    ).toEqual(task);
    expect(received).toHaveLength(0);
  });
  it("does not expose a disconnected provider through role settings", () => {
    expect(
      ModelRoutingSchema.safeParse({ ...emptyModelRouting(), conversation: fast }).success,
    ).toBe(false);
    expect(
      ModelRoutingSchema.safeParse({ ...emptyModelRouting(), enabled: [fast, fast] }).success,
    ).toBe(false);
    expect(
      ModelRoutingSchema.safeParse({
        ...emptyModelRouting(),
        enabled: [fast, { ...fast, provider: "direct" }],
      }).success,
    ).toBe(true);
  });
});
