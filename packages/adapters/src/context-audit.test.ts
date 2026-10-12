import { describe, expect, it } from "vitest";
import { describeContextUsage, describeRunContext } from "./context-audit.js";

describe("context and cache measurements", () => {
  const request = {
    instructions: "Stable policy\n\nMemory index A\n\nData stays untrusted.",
    prompt: "A private request with a credential sk-example.",
    history: [{ role: "user" as const, content: "Private memory 🙂" }],
    tools: [
      {
        name: "read",
        description: "Read a document",
        inputSchema: {
          type: "object",
          properties: { b: { type: "number" }, a: { type: "string" } },
        },
      },
    ],
  };
  const options = { volatileSections: ["Memory index A"], compacted: true, summaryBytes: 30 };
  it("measures stable policy, tool shape and compaction without storing content", () => {
    const result = describeRunContext(request, options);
    expect(result.stablePrefix.bytes).toBe(Buffer.byteLength("Stable policy\n\n"));
    expect(result.history).toEqual({
      messages: 1,
      textBytes: Buffer.byteLength("Private memory 🙂"),
      compacted: true,
      summaryBytes: 30,
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      "Stable policy",
      "Private memory",
      "sk-example",
      "Memory index",
      '"read"',
    ])
      expect(serialized).not.toContain(secret);
    const changed = describeRunContext(
      {
        ...request,
        instructions: request.instructions.replace("Memory index A", "Memory index B"),
      },
      { ...options, volatileSections: ["Memory index B"] },
    );
    expect(changed.stablePrefix).toEqual(result.stablePrefix);
    expect(changed.instructions.fingerprint).not.toBe(result.instructions.fingerprint);
    expect(
      describeRunContext(
        {
          ...request,
          instructions: request.instructions.replace("Stable policy", "Changed policy"),
        },
        options,
      ).stablePrefix.fingerprint,
    ).not.toBe(result.stablePrefix.fingerprint);
    const reordered = [
      {
        inputSchema: {
          properties: { a: { type: "string" }, b: { type: "number" } },
          type: "object",
        },
        name: "read",
        description: "Read a document",
      },
    ];
    const other = describeRunContext({ ...request, tools: reordered }, options);
    expect(other.tools.shapeFingerprint).toBe(result.tools.shapeFingerprint);
    expect(other.tools.fingerprint).not.toBe(result.tools.fingerprint);
  });
  it("distinguishes unavailable cache accounting from a reported miss", () => {
    const usage = {
      type: "usage" as const,
      provider: "example",
      model: "model",
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    expect(describeContextUsage(usage)).toMatchObject({
      cacheReported: false,
      cacheReadFraction: null,
    });
    expect(
      describeContextUsage({ ...usage, cacheReadTokens: 0, cacheUsageReported: true }),
    ).toMatchObject({
      cacheReported: true,
      cacheReadFraction: 0,
    });
    expect(
      describeContextUsage({ ...usage, cacheReadTokens: 40, cacheWriteTokens: 10 }),
    ).toMatchObject({ cacheReadFraction: 0.4, cacheWriteTokens: 10 });
    expect(describeContextUsage({ ...usage, inputTokens: 0, cacheReadTokens: 0 })).toMatchObject({
      cacheReadFraction: null,
    });
  });
});
