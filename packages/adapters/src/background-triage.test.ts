import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  backgroundCostScore,
  backgroundModelCandidates,
  parseBackgroundModel,
  parseJsonObject,
  quoteInSource,
  resolveBackgroundModel,
  runJsonPass,
  runJsonPassResult,
} from "./background-triage.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

const route = (provider: string, modelId: string) => ({ provider, modelId });
const routing = {
  enabled: [
    route("vercel-ai-gateway", "deepseek/deepseek-v4.1-flash"),
    route("zai", "glm-5.3-flash"),
    route("vercel-ai-gateway", "openai/gpt-6-luna"),
    route("vercel-ai-gateway", "google/gemini-3.8-flash"),
  ],
  conversation: route("vercel-ai-gateway", "deepseek/deepseek-v4.1-flash"),
  task: null,
  router: null,
};

describe("background model selection", () => {
  it("parses provider:modelId overrides with slashes in the model id", () => {
    expect(parseBackgroundModel("vercel-ai-gateway:openai/gpt-6-luna")).toEqual(
      route("vercel-ai-gateway", "openai/gpt-6-luna"),
    );
    expect(parseBackgroundModel("")).toBeNull();
    expect(parseBackgroundModel("no-separator")).toBeNull();
    expect(parseBackgroundModel("zai:")).toBeNull();
  });
  it("ranks enabled models cheapest first, unknown pricing last, override first", () => {
    const prices: Record<string, number> = {
      "deepseek/deepseek-v4.1-flash": 0.525,
      "glm-5.3-flash": 0.2375,
      "openai/gpt-6-luna": 0.2,
    };
    const score = (r: { modelId: string }) => prices[r.modelId] ?? Number.POSITIVE_INFINITY;
    expect(backgroundModelCandidates(routing, undefined, score).map((r) => r.modelId)).toEqual([
      "openai/gpt-6-luna",
      "glm-5.3-flash",
      "deepseek/deepseek-v4.1-flash",
      "google/gemini-3.8-flash",
    ]);
    expect(
      backgroundModelCandidates(routing, "zai:glm-5.3-flash", score).map((r) => r.modelId)[0],
    ).toBe("glm-5.3-flash");
    expect(backgroundModelCandidates(null, undefined, score)).toEqual([]);
  });
  it("prefers the background role, then the deprecated env pin, then the cheapest", () => {
    const score = (r: { modelId: string }) => ({ "openai/gpt-6-luna": 0.2 })[r.modelId] ?? 9;
    const chosen = {
      ...routing,
      background: route("vercel-ai-gateway", "google/gemini-3.8-flash"),
    };
    expect(
      backgroundModelCandidates(chosen, "zai:glm-5.3-flash", score).map((r) => r.modelId),
    ).toEqual([
      "google/gemini-3.8-flash",
      "glm-5.3-flash",
      "openai/gpt-6-luna",
      "deepseek/deepseek-v4.1-flash",
    ]);
    expect(
      backgroundModelCandidates({ ...routing, background: null }, undefined, score)[0],
    ).toEqual(route("vercel-ai-gateway", "openai/gpt-6-luna"));
  });
  it("reads real catalog pricing and treats unknown models as most expensive", () => {
    expect(Number.isFinite(backgroundCostScore(routing.conversation))).toBe(true);
    expect(backgroundCostScore(route("nope", "missing"))).toBe(Number.POSITIVE_INFINITY);
  });
  it("skips candidates without credentials and caps the pass (thinking off)", async () => {
    const main = { provider: "vercel-ai-gateway", id: "deepseek/deepseek-v4.1-flash" };
    const resolve = vi.fn(async (r: { provider: string; modelId: string }) => {
      if (r.modelId === "openai/gpt-6-luna") throw new Error("Connect that model provider first");
      return {
        provider: r.provider,
        id: r.modelId,
        maxTokens: 64000,
        thinkingLevel: "high" as const,
      };
    });
    const picked = await resolveBackgroundModel({
      routing,
      override: undefined,
      main,
      resolve,
      score: (r) => ({ "openai/gpt-6-luna": 1, "glm-5.3-flash": 2 })[r.modelId] ?? 9,
    });
    expect(picked).toMatchObject({ id: "glm-5.3-flash", thinkingLevel: "off", maxTokens: 2048 });
  });
  it("falls back to the escalation model when nothing cheaper resolves", async () => {
    const main = { provider: "p", id: "m" };
    const picked = await resolveBackgroundModel({
      routing: null,
      override: undefined,
      main,
      resolve: async () => {
        throw new Error("unreachable");
      },
    });
    expect(picked).toMatchObject({ provider: "p", id: "m", thinkingLevel: "off" });
  });
});

describe("tolerant parsing", () => {
  it("extracts JSON from fences and prose", () => {
    expect(parseJsonObject('{"shortlist":["a"]}')).toEqual({ shortlist: ["a"] });
    expect(parseJsonObject('```json\n{"shortlist":[]}\n```')).toEqual({ shortlist: [] });
    expect(parseJsonObject('Here you go: {"shortlist":["b"]} hope that helps')).toEqual({
      shortlist: ["b"],
    });
    expect(parseJsonObject("no json")).toBeNull();
    expect(parseJsonObject("[1,2]")).toBeNull();
  });
  it("matches faithful quotes across JSON encoding, whitespace, entities and typography", () => {
    const source = JSON.stringify({
      subject: "Invoice",
      from: "a@b.test",
      snippet: 'Please pay "today" &mdash; it&#39;s due\nnow',
    });
    expect(quoteInSource(source, 'Please pay "today"')).toBe(true);
    expect(quoteInSource(source, "Please pay “today”")).toBe(true);
    expect(quoteInSource(source, "it's due now")).toBe(true);
    expect(quoteInSource(source, "Never written anywhere")).toBe(false);
    expect(quoteInSource(source, "pay  x")).toBe(false);
  });
});

describe("runJsonPass", () => {
  const base = {
    request: { botId: "b", threadId: "t", runId: "r" },
    suffix: "triage",
    model: { provider: "scripted", id: "cheap" },
    instructions: "x",
    prompt: "{}",
    context: {
      spaceId: "s",
      userId: "u",
      operationId: "o",
      traceId: "t",
      signal: new AbortController().signal,
    },
  };
  it("returns parsed JSON and reports usage", async () => {
    const runtime = new ScriptedAgentRuntime();
    const usage: AgentRuntimeEvent = {
      type: "usage",
      provider: "scripted",
      model: "cheap",
      inputTokens: 10,
      outputTokens: 2,
    } as AgentRuntimeEvent;
    runtime.run = async function* (request) {
      expect(request.tools).toEqual([]);
      expect(request.runId).toBe("r:triage");
      yield usage;
      yield { type: "text", text: '{"shortlist":["x"]}' };
    };
    const onUsage = vi.fn(async () => undefined);
    expect(await runJsonPass({ ...base, runtime, onUsage })).toEqual({ shortlist: ["x"] });
    expect(onUsage).toHaveBeenCalledTimes(1);
  });
  it("degrades to null when the model call throws", async () => {
    const runtime = new ScriptedAgentRuntime();
    runtime.run = async function* () {
      yield { type: "text", text: "" };
      throw new Error("gateway 503");
    };
    expect(await runJsonPass({ ...base, runtime })).toBeNull();
  });
});

describe("runJsonPassResult", () => {
  const base = {
    request: { botId: "b", threadId: "t", runId: "r" },
    suffix: "judge",
    model: { provider: "scripted", id: "cheap" },
    instructions: "x",
    prompt: "{}",
    context: {
      spaceId: "s",
      userId: "u",
      operationId: "o",
      traceId: "t",
      signal: new AbortController().signal,
    },
  };
  const answering = (text: string) => {
    const runtime = new ScriptedAgentRuntime();
    runtime.run = async function* () {
      yield { type: "text", text };
    };
    return runtime;
  };

  it("keeps an answer, an unusable answer and a call that failed apart", async () => {
    expect(await runJsonPassResult({ ...base, runtime: answering('{"a":1}') })).toEqual({
      status: "ok",
      value: { a: 1 },
    });
    // The model answered, just not with JSON: another try may help.
    for (const text of ["", "I could not decide.", "[1, 2]"])
      expect(await runJsonPassResult({ ...base, runtime: answering(text) })).toEqual({
        status: "invalid",
      });
    const refused = Object.assign(new Error("402 Payment Required"), { status: 402 });
    const runtime = new ScriptedAgentRuntime();
    runtime.run = async function* () {
      yield { type: "text", text: "" };
      throw refused;
    };
    // The error comes back as it was thrown, so a caller can tell what happened.
    const result = await runJsonPassResult({ ...base, runtime });
    expect(result).toEqual({ status: "failed", error: refused });
    expect((result as { error: unknown }).error).toBe(refused);
  });

  it("calls a provider that does not answer in time a failure, not an unusable answer", async () => {
    // A runtime ends quietly once its signal fires, which looks like an empty reply.
    const runtime = new ScriptedAgentRuntime();
    runtime.run = async function* (_request, context) {
      await new Promise<void>((resolve) =>
        context?.signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const result = await runJsonPassResult({ ...base, runtime, timeoutMs: 20 });
    expect(result).toMatchObject({ status: "failed", error: { name: "TimeoutError" } });
    // An answer that arrived in time still counts.
    const late = new ScriptedAgentRuntime();
    late.run = async function* (_request, context) {
      yield { type: "text", text: '{"a":1}' };
      await new Promise<void>((resolve) =>
        context?.signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    expect(await runJsonPassResult({ ...base, runtime: late, timeoutMs: 20 })).toEqual({
      status: "ok",
      value: { a: 1 },
    });
  });

  it("still throws when the caller's own signal stopped the pass", async () => {
    const owner = new AbortController();
    const runtime = new ScriptedAgentRuntime();
    runtime.run = async function* () {
      yield { type: "text", text: "" };
      owner.abort();
      throw new Error("aborted");
    };
    await expect(
      runJsonPassResult({ ...base, runtime, context: { ...base.context, signal: owner.signal } }),
    ).rejects.toThrow("aborted");
  });

  it("leaves runJsonPass as it was: null for every way of not getting JSON", async () => {
    expect(await runJsonPass({ ...base, runtime: answering("prose") })).toBeNull();
    const failing = new ScriptedAgentRuntime();
    failing.run = async function* () {
      yield { type: "text", text: "" };
      throw new Error("503");
    };
    expect(await runJsonPass({ ...base, runtime: failing })).toBeNull();
    const hanging = new ScriptedAgentRuntime();
    hanging.run = async function* (_request, context) {
      await new Promise<void>((resolve) =>
        context?.signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    expect(await runJsonPass({ ...base, runtime: hanging, timeoutMs: 20 })).toBeNull();
    expect(await runJsonPass({ ...base, runtime: answering('{"a":1}') })).toEqual({ a: 1 });
  });
});
