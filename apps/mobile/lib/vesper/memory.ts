import type { MemoryDocument } from "@rakazo/contracts";
import { vesperLight } from "@rakazo/ui-tokens";
import { t } from "../i18n";

/**
 * Personal context: what the assistant is called, how it sounds, and what it
 * remembers.
 *
 * Negroni's memory is a whole markdown document per `(scope, botId, path)` with
 * a revision counter and a revision history — not atomic, individually
 * forgettable rows. So "forget this one fact" has no natural implementation
 * here: Vesper shows each document, previews its lines, and edits the whole
 * document through `memory.update`, which is the existing revision path.
 */

/** A readable name for a memory document's path. */
export function memoryDocumentTitle(document: Pick<MemoryDocument, "path" | "scope">): string {
  const filename = document.path.split("/").filter(Boolean).pop() ?? "";
  if (!filename || /^\.?memory\.md$/i.test(filename)) {
    return document.scope === "user" ? t("About you") : t("What Vesper has learned");
  }
  return filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
}

export function memoryScopeLabel(scope: MemoryDocument["scope"]): string {
  return scope === "user" ? t("About you") : t("This assistant");
}

/** Newest revision first, so the thing that just changed is at the top. */
export function sortMemoryDocuments(documents: readonly MemoryDocument[]): MemoryDocument[] {
  return [...new Map(documents.map((document) => [document.id, document])).values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/**
 * The document's content as display lines: headings and list bullets stripped,
 * blanks dropped. This is a preview of a document, not a list of facts — the
 * distinction matters, because editing one line rewrites the whole document.
 */
export function memoryPreviewLines(content: string, limit = 6): string[] {
  const lines = content
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
  return limit > 0 ? lines.slice(0, limit) : lines;
}

export function memoryLineCount(content: string): number {
  return memoryPreviewLines(content, 0).length;
}

/** Append a fact to a document without disturbing what is already written. */
export function appendMemoryLine(content: string, fact: string): string {
  const addition = fact.trim();
  if (!addition) return content;
  const body = content.replace(/\s+$/, "");
  return body ? `${body}\n- ${addition}\n` : `- ${addition}\n`;
}

/* -------------------------------------------------------------------- tone */

/**
 * Tone is three presets that write a managed block into the bot's free-text
 * instructions. `Bot.instructions` is not an enum, so the block is fenced by
 * markers: writing a preset twice replaces it instead of stacking, and
 * everything a person has written by hand outside the fence is left alone.
 */
export const VESPER_TONES = ["warm", "concise", "thoughtful"] as const;

export type VesperTone = (typeof VESPER_TONES)[number];

const TONE_OPEN = "<!-- vesper:tone -->";
const TONE_CLOSE = "<!-- /vesper:tone -->";
const TONE_BLOCK = /<!-- vesper:tone -->[\s\S]*?<!-- \/vesper:tone -->/;

export function toneLabel(tone: VesperTone): string {
  switch (tone) {
    case "warm":
      return t("Warm");
    case "concise":
      return t("Concise");
    case "thoughtful":
      return t("Thoughtful");
  }
}

export function toneDetail(tone: VesperTone): string {
  switch (tone) {
    case "warm":
      return t("Friendly, encouraging, a little informal.");
    case "concise":
      return t("Short answers. No preamble, no recap.");
    case "thoughtful":
      return t("Works through the reasoning before landing on an answer.");
  }
}

/** The instruction text a preset writes. English on purpose: it is a prompt, not chrome. */
export function toneInstruction(tone: VesperTone): string {
  switch (tone) {
    case "warm":
      return "Speak warmly and informally. Encourage, and keep the conversation human.";
    case "concise":
      return "Answer in as few words as the question needs. No preamble, no recap, no filler.";
    case "thoughtful":
      return "Think the problem through out loud before you answer, and say what you are unsure about.";
  }
}

/** Which preset the bot's instructions currently carry, if any. */
export function toneFromInstructions(instructions: string): VesperTone | null {
  const match = TONE_BLOCK.exec(instructions);
  if (!match) return null;
  const body = match[0].slice(TONE_OPEN.length, match[0].length - TONE_CLOSE.length).trim();
  return VESPER_TONES.find((tone) => toneInstruction(tone) === body) ?? null;
}

/** Instructions with the managed tone block replaced, added, or removed. */
export function applyToneInstruction(instructions: string, tone: VesperTone | null): string {
  const block = tone ? `${TONE_OPEN}\n${toneInstruction(tone)}\n${TONE_CLOSE}` : "";
  if (TONE_BLOCK.test(instructions)) {
    return instructions
      .replace(TONE_BLOCK, block)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (!block) return instructions.trim();
  const body = instructions.trim();
  return body ? `${body}\n\n${block}` : block;
}

/** What a person wrote by hand, with the managed block taken out. */
export function instructionsWithoutTone(instructions: string): string {
  return instructions
    .replace(TONE_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ avatar */

/**
 * The avatar is one asset on one of three tints — the reference design's sky /
 * sand / lilac treatment. Negroni stores a bot avatar in `Bot.color`, which
 * accepts a hex, so the tint round-trips through `bots.update({ color })` with
 * no new column. A colour Vesper does not recognise (one chosen in Negroni)
 * reads back as sky rather than as an error.
 */
export const VESPER_AVATAR_VARIANTS = ["sky", "sand", "lilac"] as const;

export type VesperAvatarVariantName = (typeof VESPER_AVATAR_VARIANTS)[number];

export const DEFAULT_AVATAR_VARIANT: VesperAvatarVariantName = "sky";

export function avatarVariantColor(variant: VesperAvatarVariantName): string {
  switch (variant) {
    case "sky":
      return vesperLight.extras.avatarSky;
    case "sand":
      return vesperLight.extras.avatarSand;
    case "lilac":
      return vesperLight.extras.avatarLilac;
  }
}

export function avatarVariantFromColor(color: string | null | undefined): VesperAvatarVariantName {
  const value = (color ?? "").trim().toLowerCase();
  return (
    VESPER_AVATAR_VARIANTS.find((variant) => avatarVariantColor(variant).toLowerCase() === value) ??
    DEFAULT_AVATAR_VARIANT
  );
}

export function avatarVariantLabel(variant: VesperAvatarVariantName): string {
  switch (variant) {
    case "sky":
      return t("Sky");
    case "sand":
      return t("Sand");
    case "lilac":
      return t("Lilac");
  }
}
