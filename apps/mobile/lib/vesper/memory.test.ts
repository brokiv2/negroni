import type { MemoryDocument } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  appendMemoryLine,
  applyToneInstruction,
  avatarVariantColor,
  avatarVariantFromColor,
  avatarVariantLabel,
  DEFAULT_AVATAR_VARIANT,
  instructionsWithoutTone,
  memoryDocumentTitle,
  memoryLineCount,
  memoryPreviewLines,
  memoryScopeLabel,
  sortMemoryDocuments,
  toneDetail,
  toneFromInstructions,
  toneInstruction,
  toneLabel,
  VESPER_AVATAR_VARIANTS,
  VESPER_TONES,
} from "./memory";

function document(over: Partial<MemoryDocument> & { id: string }): MemoryDocument {
  return {
    scope: "bot",
    botId: "bot",
    path: "memory.md",
    content: "",
    revision: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as MemoryDocument;
}

describe("memoryDocumentTitle", () => {
  it("names the two root documents by who they are about", () => {
    expect(memoryDocumentTitle({ path: "memory.md", scope: "user" })).toBe("About you");
    expect(memoryDocumentTitle({ path: ".memory.md", scope: "bot" })).toBe(
      "What Vesper has learned",
    );
  });

  it("reads a nested document's filename back as words", () => {
    expect(memoryDocumentTitle({ path: "notes/travel-preferences.md", scope: "user" })).toBe(
      "travel preferences",
    );
  });

  it("falls back to the scope when the path is empty", () => {
    expect(memoryDocumentTitle({ path: "", scope: "user" })).toBe("About you");
  });
});

describe("memoryScopeLabel", () => {
  it("distinguishes the two scopes", () => {
    expect(memoryScopeLabel("user")).toBe("About you");
    expect(memoryScopeLabel("bot")).toBe("This assistant");
  });
});

describe("sortMemoryDocuments", () => {
  it("puts the most recent revision first and drops duplicates", () => {
    const sorted = sortMemoryDocuments([
      document({ id: "a", updatedAt: "2026-09-01T00:00:00.000Z" }),
      document({ id: "b", updatedAt: "2026-09-11T00:00:00.000Z" }),
      document({ id: "b", updatedAt: "2026-09-11T00:00:00.000Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("memoryPreviewLines", () => {
  it("strips list markers and headings and drops blank lines", () => {
    expect(memoryPreviewLines("# Heading\n\n- Likes tea\n* Hates queues\n\n")).toEqual([
      "Heading",
      "Likes tea",
      "Hates queues",
    ]);
  });

  it("honours the limit, and counts the whole document separately", () => {
    const content = "- one\n- two\n- three";
    expect(memoryPreviewLines(content, 2)).toEqual(["one", "two"]);
    expect(memoryLineCount(content)).toBe(3);
  });
});

describe("appendMemoryLine", () => {
  it("adds a bullet without disturbing what is already there", () => {
    expect(appendMemoryLine("- one\n", "two")).toBe("- one\n- two\n");
  });

  it("starts the document when it is empty", () => {
    expect(appendMemoryLine("", " two ")).toBe("- two\n");
  });

  it("ignores an empty addition", () => {
    expect(appendMemoryLine("- one\n", "   ")).toBe("- one\n");
  });
});

describe("tone presets", () => {
  it("labels and describes every preset", () => {
    for (const tone of VESPER_TONES) {
      expect(toneLabel(tone)).toBeTruthy();
      expect(toneDetail(tone)).toBeTruthy();
      expect(toneInstruction(tone)).toBeTruthy();
    }
  });

  it("round-trips a preset through the instructions", () => {
    for (const tone of VESPER_TONES) {
      expect(toneFromInstructions(applyToneInstruction("", tone))).toBe(tone);
    }
  });

  it("replaces the managed block instead of stacking presets", () => {
    const once = applyToneInstruction("Keep it British.", "warm");
    const twice = applyToneInstruction(once, "concise");
    expect(toneFromInstructions(twice)).toBe("concise");
    expect(twice.match(/vesper:tone/g)).toHaveLength(2);
    expect(instructionsWithoutTone(twice)).toBe("Keep it British.");
  });

  it("leaves hand-written instructions alone when the tone is cleared", () => {
    const withTone = applyToneInstruction("Keep it British.", "thoughtful");
    expect(applyToneInstruction(withTone, null)).toBe("Keep it British.");
  });

  it("reports no preset for instructions that were written by hand", () => {
    expect(toneFromInstructions("Be nice.")).toBeNull();
  });

  it("reports no preset when the fenced block was edited to something else", () => {
    expect(toneFromInstructions("<!-- vesper:tone -->\nBe a pirate.\n<!-- /vesper:tone -->")).toBe(
      null,
    );
  });
});

describe("avatar variants", () => {
  it("round-trips every tint through the colour Negroni stores", () => {
    for (const variant of VESPER_AVATAR_VARIANTS) {
      expect(avatarVariantFromColor(avatarVariantColor(variant))).toBe(variant);
      expect(avatarVariantLabel(variant)).toBeTruthy();
    }
  });

  it("reads a colour chosen in Negroni back as the default rather than failing", () => {
    expect(avatarVariantFromColor("#FF781C")).toBe(DEFAULT_AVATAR_VARIANT);
    expect(avatarVariantFromColor(null)).toBe(DEFAULT_AVATAR_VARIANT);
    expect(avatarVariantFromColor("")).toBe(DEFAULT_AVATAR_VARIANT);
  });

  it("does not care about the case the colour was written in", () => {
    expect(avatarVariantFromColor(avatarVariantColor("lilac").toUpperCase())).toBe("lilac");
  });
});
