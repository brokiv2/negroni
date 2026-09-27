import type { ScratchpadItem } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { ideaGlyph, ideaItems, ideaStartMessage, ideaSummary } from "./ideas";

function item(over: Partial<ScratchpadItem> & { id: string }): ScratchpadItem {
  return {
    botId: "bot",
    title: "Idea",
    status: "parked",
    notes: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as ScratchpadItem;
}

describe("ideaItems", () => {
  it("takes parked items only, newest first", () => {
    const items = [
      item({ id: "old", updatedAt: "2026-09-01T00:00:00.000Z" }),
      item({ id: "goal", status: "open" }),
      item({ id: "new", updatedAt: "2026-09-20T00:00:00.000Z" }),
    ];
    expect(ideaItems(items).map((entry) => entry.id)).toEqual(["new", "old"]);
  });
});

describe("ideaGlyph", () => {
  it("picks a glyph from the words in the title", () => {
    expect(ideaGlyph("Renew my passport")).toBe("📋");
    expect(ideaGlyph("Cut the streaming spending")).toBe("💸");
    expect(ideaGlyph("Start a running habit")).toBe("👟");
    expect(ideaGlyph("Book a table for Saturday")).toBe("🍽️");
    expect(ideaGlyph("Compare flights to Lisbon")).toBe("✈️");
    expect(ideaGlyph("Reply to the landlord email")).toBe("✉️");
  });

  it("falls back to the neutral glyph rather than guessing", () => {
    expect(ideaGlyph("Something entirely unlike the others")).toBe("💡");
    expect(ideaGlyph("")).toBe("💡");
  });

  it("matches whole words, so a substring does not steer the glyph", () => {
    expect(ideaGlyph("Honeymoon planning")).toBe("💡");
  });
});

describe("ideaSummary", () => {
  it("returns the first line that has something on it", () => {
    expect(ideaSummary("\n\n  Because the lease renews in March  \nmore")).toBe(
      "Because the lease renews in March",
    );
  });

  it("is empty when the notes are", () => {
    expect(ideaSummary("   \n  ")).toBe("");
  });
});

describe("ideaStartMessage", () => {
  it("hands the idea over with its notes", () => {
    expect(ideaStartMessage({ title: "Renew the passport", notes: "Expires in May" })).toBe(
      "Let's do this: Renew the passport\n\nExpires in May",
    );
  });

  it("stays a single line when there are no notes", () => {
    expect(ideaStartMessage({ title: "Renew the passport", notes: "  " })).toBe(
      "Let's do this: Renew the passport",
    );
  });
});
