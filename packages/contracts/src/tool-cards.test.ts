import { describe, expect, it } from "vitest";
import {
  MAX_FINANCE_TRANSACTIONS,
  MAX_PLAN_STEPS,
  MessageBlock,
  StoredMessageBlock,
  ThreadMessageSchema,
  TOOL_CARD_SUMMARY_MAX_LENGTH,
  UNSUPPORTED_BLOCK_TEXT,
} from "./index.js";

describe("tool-card message blocks", () => {
  it("parses a browser card with a screenshot reference", () => {
    expect(
      MessageBlock.parse({
        kind: "browser",
        summary: "Read example.com",
        url: "https://example.com/pricing",
        title: "Pricing",
        status: "ready",
        screenshot: { artifactId: "art_1", mimeType: "image/png", width: 1280, height: 800 },
        computerId: "cmp_1",
      }),
    ).toMatchObject({ kind: "browser", status: "ready", screenshot: { width: 1280 } });
  });

  it("parses a browser card with nothing but the required fields", () => {
    expect(
      MessageBlock.parse({
        kind: "browser",
        summary: "Opening a page",
        url: "https://example.com",
        status: "loading",
      }),
    ).toMatchObject({ kind: "browser", status: "loading" });
  });

  it("rejects a card without a summary", () => {
    // The summary is what a client that does not know the kind renders, so it
    // is the one field an emitter may never skip.
    expect(
      MessageBlock.safeParse({ kind: "browser", url: "https://example.com", status: "ready" })
        .success,
    ).toBe(false);
    expect(
      MessageBlock.safeParse({
        kind: "browser",
        summary: "",
        url: "https://example.com",
        status: "ready",
      }).success,
    ).toBe(false);
  });

  it("rejects a summary over the bound", () => {
    expect(
      MessageBlock.safeParse({
        kind: "browser",
        summary: "x".repeat(TOOL_CARD_SUMMARY_MAX_LENGTH + 1),
        url: "https://example.com",
        status: "ready",
      }).success,
    ).toBe(false);
  });

  it("parses both mail modes", () => {
    expect(
      MessageBlock.parse({
        kind: "mail",
        summary: "Found 12 emails",
        mode: "search",
        matchCount: 12,
        truncated: true,
      }),
    ).toMatchObject({ mode: "search", matchCount: 12 });
    expect(
      MessageBlock.parse({
        kind: "mail",
        summary: "Q3 invoice from Acme",
        mode: "thread",
        subject: "Q3 invoice",
        sender: "Acme Billing",
        messageCount: 3,
      }),
    ).toMatchObject({ mode: "thread", messageCount: 3 });
  });

  it("parses a pdf card as a structural superset of a file block", () => {
    const block = MessageBlock.parse({
      kind: "pdf",
      summary: "W-9.pdf. 2 pages",
      artifactId: "art_9",
      mimeType: "application/pdf",
      name: "W-9.pdf",
      size: 184320,
      pageCount: 2,
      fields: [{ name: "legal_name", value: "", type: "checkbox" }],
    });
    // A renderer with no pdf branch can route these four fields into its file card.
    expect(block).toMatchObject({
      artifactId: "art_9",
      mimeType: "application/pdf",
      name: "W-9.pdf",
      size: 184320,
    });
  });

  it("parses a plan card and bounds its step list", () => {
    const step = { title: "Compare flights", status: "done" as const };
    expect(
      MessageBlock.parse({
        kind: "plan",
        summary: "Book the trip. Working",
        title: "Book the trip",
        status: "running",
        steps: [step, { title: "Draft the itinerary", status: "running" }],
      }),
    ).toMatchObject({ kind: "plan", status: "running" });
    expect(
      MessageBlock.safeParse({
        kind: "plan",
        summary: "Too many steps",
        title: "Too many steps",
        status: "running",
        steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, () => step),
      }).success,
    ).toBe(false);
  });

  it("parses a finance card and bounds its transaction window", () => {
    const transaction = { date: "2026-09-02", description: "Pingo Doce", amount: -48.12 };
    expect(
      MessageBlock.parse({
        kind: "finance",
        summary: "September spending",
        title: "September spending",
        currency: "EUR",
        income: 4000,
        spending: 2841.2,
        saved: 1158.8,
        categories: [{ name: "Rent", amount: 1400 }],
        transactions: [transaction],
        transactionCount: 143,
      }),
    ).toMatchObject({ kind: "finance", currency: "EUR", transactionCount: 143 });
    expect(
      MessageBlock.safeParse({
        kind: "finance",
        summary: "Too many rows",
        title: "Too many rows",
        income: 0,
        spending: 0,
        saved: 0,
        categories: [],
        transactions: Array.from({ length: MAX_FINANCE_TRANSACTIONS + 1 }, () => transaction),
      }).success,
    ).toBe(false);
  });

  it("keeps the generic card and progress additions optional", () => {
    expect(MessageBlock.parse({ kind: "card", lines: [{ k: "a", v: "b" }] })).toMatchObject({
      kind: "card",
    });
    expect(
      MessageBlock.parse({ kind: "card", lines: [], title: "Flights", subtitle: "October" }),
    ).toMatchObject({ title: "Flights", subtitle: "October" });
    expect(MessageBlock.parse({ kind: "progress", text: "Working" })).toMatchObject({
      kind: "progress",
    });
    expect(MessageBlock.parse({ kind: "progress", text: "Working", percent: 60 })).toMatchObject({
      percent: 60,
    });
    expect(
      MessageBlock.safeParse({ kind: "progress", text: "Working", percent: 101 }).success,
    ).toBe(false);
  });
});

describe("StoredMessageBlock", () => {
  it("degrades an unknown kind to its summary rather than failing", () => {
    expect(
      StoredMessageBlock.parse({ kind: "hologram", summary: "Rendered a hologram", spin: 3 }),
    ).toEqual({ kind: "meta", text: "Rendered a hologram" });
  });

  it("falls back to a fixed line when an unknown block has no summary", () => {
    expect(StoredMessageBlock.parse({ kind: "hologram", spin: 3 })).toEqual({
      kind: "meta",
      text: UNSUPPORTED_BLOCK_TEXT,
    });
  });

  it("leaves a known block untouched", () => {
    expect(StoredMessageBlock.parse({ kind: "text", text: "hello" })).toEqual({
      kind: "text",
      text: "hello",
    });
  });

  it("keeps one unreadable block from failing a whole message page", () => {
    // Before this, a block written by a newer build made threads.get reject the
    // entire page at the oRPC output boundary, not just that block.
    const message = ThreadMessageSchema.parse({
      id: "msg_1",
      threadId: "thr_1",
      seq: 4,
      role: "bot",
      createdAt: "2026-09-27T10:00:00.000Z",
      blocks: [
        { kind: "text", text: "Here is what I found." },
        { kind: "hologram", summary: "Rendered a hologram" },
      ],
    });
    expect(message.blocks).toEqual([
      { kind: "text", text: "Here is what I found." },
      { kind: "meta", text: "Rendered a hologram" },
    ]);
  });
});
