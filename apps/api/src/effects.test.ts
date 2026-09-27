import { describe, expect, it } from "vitest";
import { effectSummaryRows, toEffectReceipt } from "./effects.js";

describe("effectSummaryRows", () => {
  it("keeps the named fields in a fixed order", () => {
    expect(effectSummaryRows({ amount: 42, subject: "Invoice", to: "ada@example.com" })).toEqual([
      { k: "to", v: "ada@example.com" },
      { k: "subject", v: "Invoice" },
      { k: "amount", v: "42" },
    ]);
  });

  it("never leaks a field it was not asked for", () => {
    expect(
      effectSummaryRows({
        to: "ada@example.com",
        api_key: "sk-live-secret",
        password: "hunter2",
        headers: { authorization: "Bearer token" },
      }),
    ).toEqual([{ k: "to", v: "ada@example.com" }]);
  });

  it("drops empty values and refuses nested structures", () => {
    expect(effectSummaryRows({ to: "", subject: null, title: { nested: true } })).toEqual([]);
  });

  it("collapses whitespace and truncates a long body", () => {
    const rows = effectSummaryRows({ body: `line\n\nline ${"x".repeat(400)}` });
    expect(rows[0]?.v.startsWith("line line x")).toBe(true);
    expect(rows[0]?.v).toHaveLength(280);
    expect(rows[0]?.v.endsWith("…")).toBe(true);
  });

  it("returns nothing for a non-object request", () => {
    expect(effectSummaryRows(null)).toEqual([]);
    expect(effectSummaryRows("send it")).toEqual([]);
    expect(effectSummaryRows([{ to: "ada@example.com" }])).toEqual([]);
  });
});

describe("toEffectReceipt", () => {
  it("carries the review verdict and drops the raw payload", () => {
    const receipt = toEffectReceipt({
      id: "eff_1",
      runId: "run_1",
      kind: "gmail_send_email",
      status: "succeeded",
      request: { to: "ada@example.com", token: "secret" },
      reviewDecision: "pass",
      reviewReason: "Recipient matches the thread",
      reviewModel: "claude",
      createdAt: new Date("2026-09-27T10:00:00.000Z"),
      updatedAt: new Date("2026-09-27T10:00:05.000Z"),
    });
    expect(receipt).toEqual({
      id: "eff_1",
      runId: "run_1",
      kind: "gmail_send_email",
      status: "succeeded",
      summary: [{ k: "to", v: "ada@example.com" }],
      reviewDecision: "pass",
      reviewReason: "Recipient matches the thread",
      reviewModel: "claude",
      createdAt: "2026-09-27T10:00:00.000Z",
      updatedAt: "2026-09-27T10:00:05.000Z",
    });
    expect(JSON.stringify(receipt)).not.toContain("secret");
  });
});
