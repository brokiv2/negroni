import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { GatewayWebProvider } from "./gateway-web.js";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";
import { webProviderForModel } from "./web-provider-factory.js";

const ctx: AdapterContext = {
  operationId: "test",
  traceId: "test",
  spaceId: "test",
  userId: "test",
  signal: new AbortController().signal,
};
const call = {
  type: "tool-call",
  toolName: "web_search",
  toolCallId: "1",
  input: '{"query":"test"}',
  providerExecuted: true,
};
const hit = {
  title: "Verified source",
  url: "https://example.test/source",
  snippet: "A source preview",
};
function fixture(content: unknown[]) {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ content, finishReason: { unified: "stop" }, usage: {}, warnings: [] }),
  );
  const reader = new FakeWebProvider();
  const provider = new GatewayWebProvider(reader, {
    apiKey: "test-key",
    modelId: "test/model",
    fetch: fetcher,
  });
  return { provider, fetcher, reader };
}
describe("connected Gateway search", () => {
  it("uses only correlated provider tool results and bounds the request", async () => {
    const f = fixture([
      call,
      { type: "text", text: "https://invented.test" },
      {
        type: "tool-result",
        toolName: "web_search",
        toolCallId: "1",
        result: { results: [hit, hit] },
      },
    ]);
    expect(await f.provider.search({ query: "test", maxResults: 1 }, ctx)).toEqual([hit]);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body));
    expect(body.tools).toEqual([
      expect.objectContaining({ id: "gateway.perplexity_search", name: "web_search" }),
    ]);
    expect(body.maxOutputTokens).toBe(1024);
    expect(body.toolChoice).toEqual({ type: "tool", toolName: "web_search" });
    expect(body.prompt).toHaveLength(2);
  });
  it.each([
    [{ type: "text", text: JSON.stringify({ results: [hit] }) }],
    [
      call,
      {
        type: "tool-result",
        toolName: "web_search",
        toolCallId: "other",
        result: { results: [hit] },
      },
    ],
    [
      call,
      {
        type: "tool-result",
        toolName: "web_search",
        toolCallId: "1",
        isError: true,
        result: { error: "quota" },
      },
    ],
    [
      call,
      {
        type: "tool-result",
        toolName: "web_search",
        toolCallId: "1",
        result: { results: [{ title: "malformed" }] },
      },
    ],
  ])("rejects unverified or malformed search results %#", async (...content) => {
    const f = fixture(content);
    await expect(f.provider.search({ query: "test" }, ctx)).rejects.toThrow(
      "Connected web search is unavailable",
    );
  });
  it("redacts transport failures and preserves cancellation", async () => {
    const provider = new GatewayWebProvider(new FakeWebProvider(), {
      apiKey: "test-key",
      modelId: "test/model",
      fetch: async () => {
        throw new Error("sensitive-request-payload");
      },
    });
    await expect(provider.search({ query: "test" }, ctx)).rejects.toThrow(
      "Connected web search is unavailable",
    );
    const controller = new AbortController();
    controller.abort(new Error("Cancelled by caller"));
    await expect(
      provider.search({ query: "test", signal: controller.signal }, ctx),
    ).rejects.toThrow("Cancelled by caller");
  });

  it("allows a verified empty search result", async () => {
    const f = fixture([
      call,
      { type: "tool-result", toolName: "web_search", toolCallId: "1", result: { results: [] } },
    ]);
    expect(await f.provider.search({ query: "test" }, ctx)).toEqual([]);
  });
  it("keeps source reading in the existing restricted adapter", async () => {
    const f = fixture([]);
    await f.provider.fetch({ url: hit.url, allowedDomains: ["example.test"] }, ctx);
    expect(f.reader.lastFetch?.allowedDomains).toEqual(["example.test"]);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("does not replace fake/custom providers or send a credential to a custom host", () => {
    const fake = new FakeWebProvider();
    const model = { provider: "vercel-ai-gateway", id: "test/model", apiKey: "test-key" };
    expect(webProviderForModel(fake, model)).toBe(fake);
    const keyless = new KeylessHttpWebProvider();
    expect(webProviderForModel(keyless, { ...model, baseUrl: "https://private.test" })).toBe(
      keyless,
    );
    expect(webProviderForModel(keyless, { ...model, provider: "another" })).toBe(keyless);
    expect(webProviderForModel(keyless, model).describe().id).toBe("gateway-search");
  });
});
