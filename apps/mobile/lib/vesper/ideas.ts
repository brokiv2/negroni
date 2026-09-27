import type { ScratchpadItem } from "@rakazo/contracts";
import { t } from "../i18n";
import { sortScratchpadItems } from "./goals";

/**
 * Ideas, derived from `ScratchpadItem` with `status: "parked"` — the same
 * convention the personal workspace already uses for "something to come back to".
 *
 * The reference design shows each suggestion with its source evidence. Negroni
 * has no evidence model at all (spec task 37), so an idea shows its own notes
 * and nothing it cannot prove. Accepting an idea either promotes it to a goal
 * (`status: "open"`) or sends it to the assistant as a message; dismissing it
 * removes the row.
 */

export function ideaItems(items: readonly ScratchpadItem[]): ScratchpadItem[] {
  return sortScratchpadItems(items.filter((item) => item.status === "parked"));
}

/**
 * A glyph for the idea row, chosen from the title.
 *
 * Cosmetic and deliberately conservative: with no `kind` column there is nothing
 * to key off but words, so an unrecognised idea gets the neutral lightbulb
 * rather than a confident wrong guess.
 */
export function ideaGlyph(title: string): string {
  const text = title.toLowerCase();
  if (/\b(documents?|paperwork|forms?|permits?|visas?|passports?|renew)\b/.test(text)) return "📋";
  if (/\b(money|budgets?|spend|spending|savings?|invoices?|bills?|taxe?s?)\b/.test(text))
    return "💸";
  if (/\b(plans?|goals?|train|training|habits?|workouts?|runs?|running)\b/.test(text)) return "👟";
  if (/\b(dinner|lunch|tables?|restaurants?|recipes?|cook|cooking)\b/.test(text)) return "🍽️";
  if (/\b(flights?|trips?|travel|hotels?|holidays?|vacations?)\b/.test(text)) return "✈️";
  if (/\b(emails?|inbox|messages?|reply|write|drafts?)\b/.test(text)) return "✉️";
  return "💡";
}

/** The first line of the notes, for the collapsed row. */
export function ideaSummary(notes: string): string {
  const line = notes
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? "";
}

/** The message sent to the assistant when an idea is handed over rather than kept. */
export function ideaStartMessage(idea: Pick<ScratchpadItem, "title" | "notes">): string {
  const notes = idea.notes.trim();
  const opening = t("Let's do this: {title}", { title: idea.title.trim() });
  return notes ? `${opening}\n\n${notes}` : opening;
}
