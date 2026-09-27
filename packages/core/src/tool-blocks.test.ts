import {
  MAX_FINANCE_TRANSACTIONS,
  MAX_PLAN_STEPS,
  MessageBlock,
  TOOL_CARD_SUMMARY_MAX_LENGTH,
} from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { blocksToAgentHistoryText } from "./attachments.js";
import { speechFromBlocks } from "./speech-text.js";
import {
  browserCardBlock,
  browserCardSiteLabel,
  browserCardSummary,
  financeCardBlock,
  isToolCardBlock,
  mailSearchCardBlock,
  mailThreadCardBlock,
  pdfCardBlock,
  planCardBlock,
  planCardProgress,
  planCardStatusLabel,
  toolCardSummary,
} from "./tool-blocks.js";

describe("browserCardSiteLabel", () => {
  it("strips www and keeps the host", () => {
    expect(browserCardSiteLabel("https://www.example.com/a/b?c=d")).toBe("example.com");
  });

  it("falls back for a URL it cannot parse", () => {
    expect(browserCardSiteLabel("not a url")).toBe("a page");
  });
});

describe("browserCardSummary", () => {
  it("describes each status in the reader's terms", () => {
    expect(browserCardSummary({ url: "https://example.com", status: "loading" })).toBe(
      "Opening example.com",
    );
    expect(
      browserCardSummary({ url: "https://example.com", title: "Pricing", status: "ready" }),
    ).toContain("Pricing");
    expect(
      browserCardSummary({ url: "https://example.com", status: "error", error: "DNS failed" }),
    ).toBe("Could not read example.com: DNS failed");
  });
});

describe("browserCardBlock", () => {
  it("builds a block the contract accepts", () => {
    const block = browserCardBlock({
      url: "https://example.com/pricing",
      title: "Pricing",
      status: "ready",
      screenshot: { artifactId: "art_1", mimeType: "image/png", width: 1280, height: 800 },
      computerId: "cmp_1",
    });
    expect(MessageBlock.parse(block)).toEqual(block);
    expect(block.summary).toContain("example.com");
  });

  it("omits every optional the caller did not supply", () => {
    const block = browserCardBlock({ url: "https://example.com", status: "loading" });
    expect(block).toEqual({
      kind: "browser",
      summary: "Opening example.com",
      url: "https://example.com",
      status: "loading",
    });
    expect("title" in block).toBe(false);
    expect("screenshot" in block).toBe(false);
  });

  it("truncates rather than throwing on an overlong title", () => {
    // A card must never be the reason a tool call fails.
    const block = browserCardBlock({
      url: "https://example.com",
      title: "t".repeat(TOOL_CARD_SUMMARY_MAX_LENGTH * 3),
      status: "ready",
    });
    expect(block.title?.length).toBe(TOOL_CARD_SUMMARY_MAX_LENGTH);
    expect(MessageBlock.safeParse(block).success).toBe(true);
  });

  it("honours an explicit summary over the derived one", () => {
    expect(
      browserCardBlock({ url: "https://example.com", status: "ready", summary: "Checked the docs" })
        .summary,
    ).toBe("Checked the docs");
  });
});

describe("mail card builders", () => {
  it("counts search results in words a reader understands", () => {
    expect(mailSearchCardBlock({ matchCount: 0 }).summary).toBe("No matching emails");
    expect(mailSearchCardBlock({ matchCount: 1 }).summary).toBe("Found 1 email");
    expect(mailSearchCardBlock({ matchCount: 12, truncated: true }).summary).toBe(
      "Found at least 12 emails",
    );
  });

  it("builds a thread card the contract accepts", () => {
    const block = mailThreadCardBlock({
      subject: "Q3 invoice",
      sender: "Acme Billing",
      excerpt: "Attached is the invoice for Q3.",
      messageCount: 3,
      provider: "gmail",
      unread: true,
    });
    expect(MessageBlock.parse(block)).toEqual(block);
    expect(block).toMatchObject({ mode: "thread", messageCount: 3, unread: true });
  });

  it("drops a zero attachment count instead of rendering a zero", () => {
    expect("attachmentCount" in mailThreadCardBlock({ subject: "Hi", attachmentCount: 0 })).toBe(
      false,
    );
  });
});

describe("pdfCardBlock", () => {
  it("builds a block the contract accepts and pluralizes pages", () => {
    const one = pdfCardBlock({
      artifactId: "art_1",
      name: "W-9.pdf",
      mimeType: "application/pdf",
      size: 10,
      pageCount: 1,
    });
    expect(one.summary).toBe("W-9.pdf — 1 page");
    const many = pdfCardBlock({
      artifactId: "art_1",
      name: "W-9.pdf",
      mimeType: "application/pdf",
      size: 10,
      pageCount: 4,
    });
    expect(many.summary).toBe("W-9.pdf — 4 pages");
    expect(MessageBlock.parse(many)).toEqual(many);
  });

  it("caps the form-field peek", () => {
    const block = pdfCardBlock({
      artifactId: "art_1",
      name: "form.pdf",
      mimeType: "application/pdf",
      size: 10,
      fields: Array.from({ length: 80 }, (_, index) => ({
        name: `f${index}`,
        value: "",
        type: "text" as const,
      })),
    });
    expect(block.fields).toHaveLength(32);
    expect(MessageBlock.safeParse(block).success).toBe(true);
  });
});

describe("plan card", () => {
  it("counts skipped steps as complete", () => {
    expect(
      planCardProgress([
        { title: "a", status: "done" },
        { title: "b", status: "skipped" },
        { title: "c", status: "running" },
      ]),
    ).toEqual({ done: 2, total: 3 });
  });

  it("derives the progress fraction into the summary", () => {
    const block = planCardBlock({
      title: "Book the trip",
      status: "running",
      steps: [
        { title: "Compare flights", status: "done" },
        { title: "Draft the itinerary", status: "running" },
      ],
    });
    expect(block.summary).toBe("Book the trip — Working · 1/2 steps");
    expect(MessageBlock.parse(block)).toEqual(block);
  });

  it("omits the fraction when there are no steps yet", () => {
    expect(planCardBlock({ title: "Book the trip", status: "queued", steps: [] }).summary).toBe(
      "Book the trip — Queued",
    );
  });

  it("caps the step list at the contract bound", () => {
    const block = planCardBlock({
      title: "Long plan",
      status: "running",
      steps: Array.from({ length: MAX_PLAN_STEPS + 20 }, (_, index) => ({
        title: `step ${index}`,
        status: "pending" as const,
      })),
    });
    expect(block.steps).toHaveLength(MAX_PLAN_STEPS);
    expect(MessageBlock.safeParse(block).success).toBe(true);
  });

  it("labels the statuses the header status line also uses", () => {
    expect(planCardStatusLabel("waiting_approval")).toBe("Ready to review");
    expect(planCardStatusLabel("waiting_input")).toBe("Needs your input");
  });
});

describe("financeCardBlock", () => {
  it("builds a block the contract accepts", () => {
    const block = financeCardBlock({
      title: "September spending",
      currency: "eur",
      income: 4000,
      spending: 2841.2,
      saved: 1158.8,
      categories: [{ name: "Rent", amount: 1400 }],
      period: { from: "2026-09-01", to: "2026-09-30" },
    });
    expect(MessageBlock.parse(block)).toEqual(block);
    expect(block.currency).toBe("EUR");
    expect(block.summary).toContain("2841.20 EUR");
  });

  it("drops a currency that is not a three-letter code", () => {
    const block = financeCardBlock({
      title: "Spending",
      currency: "euros",
      income: 1,
      spending: 1,
      saved: 0,
      categories: [],
    });
    expect("currency" in block).toBe(false);
  });

  it("caps the transaction window", () => {
    const block = financeCardBlock({
      title: "Spending",
      income: 0,
      spending: 0,
      saved: 0,
      categories: [],
      transactions: Array.from({ length: MAX_FINANCE_TRANSACTIONS + 50 }, () => ({
        date: "2026-09-02",
        description: "row",
        amount: -1,
      })),
      transactionCount: 250,
    });
    expect(block.transactions).toHaveLength(MAX_FINANCE_TRANSACTIONS);
    expect(block.transactionCount).toBe(250);
    expect(MessageBlock.safeParse(block).success).toBe(true);
  });
});

describe("card summaries in shared text paths", () => {
  const card = browserCardBlock({
    url: "https://example.com",
    title: "Pricing",
    status: "ready",
  });

  it("narrows only the card kinds", () => {
    expect(isToolCardBlock(card)).toBe(true);
    expect(isToolCardBlock({ kind: "text", text: "hi" })).toBe(false);
    expect(toolCardSummary({ kind: "text", text: "hi" })).toBe("");
  });

  it("keeps a card in the bot's own history", () => {
    // Without this the bot cannot see the pages it read on an earlier turn.
    expect(blocksToAgentHistoryText([card])).toBe(`[browser: ${card.summary}]`);
  });

  it("speaks the summary rather than nothing", () => {
    expect(speechFromBlocks([card])).toBe(card.summary);
  });
});
