import { randomUUID } from "node:crypto";
import type {
  RadarFeedbackKind,
  RadarOrigin,
  RadarPerson,
  RadarRule,
  RadarRuleKind,
  RadarRuleMatch,
} from "@rakazo/contracts";
import {
  RADAR_MAX_PEOPLE,
  RADAR_MAX_RULES,
  RadarPersonSchema,
  RadarRuleSchema,
} from "@rakazo/contracts";
import type { ZodType } from "zod";
import { topicKey } from "../feed-profile.js";
import { RadarError } from "./errors.js";

/** Rules (explicit and learned) and people who matter, as stored on the profile. */
export type RadarLearned = { rules: RadarRule[]; people: RadarPerson[] };
/** Who an update came from, as learning keys it. */
export type RadarSender = { address: string; name?: string };
/** This sender's updates marked important or not important inside the learning window. */
export type SenderHistory = { important: number; notImportant: number };

/** Feedback older than this no longer counts toward a learned rule. */
export const LEARNING_WINDOW_MS = 30 * 86_400_000;

/** Read tolerantly: an entry that does not validate is dropped instead of failing the profile. */
export function parseLearned(value: unknown): RadarLearned {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    rules: validEntries(raw.rules, RadarRuleSchema).slice(-RADAR_MAX_RULES),
    people: validEntries(raw.people, RadarPersonSchema).slice(-RADAR_MAX_PEOPLE),
  };
}

function validEntries<T>(value: unknown, schema: ZodType<T>): T[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Learning keys a sender by normalized address only; a name alone is too ambiguous. */
export function senderOf(actor: unknown): RadarSender | null {
  if (!actor || typeof actor !== "object") return null;
  const { address, name } = actor as { address?: unknown; name?: unknown };
  if (typeof address !== "string") return null;
  const normalized = address.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return null;
  return typeof name === "string" && name.trim()
    ? { address: normalized, name: name.trim() }
    : { address: normalized };
}

/** Rules with the same match are one rule; topics compare like feed topics. */
export function ruleKey(match: RadarRuleMatch): string {
  return JSON.stringify([
    match.sender ?? "",
    match.domain ?? "",
    match.topic ? topicKey(match.topic) : "",
    match.source ?? "",
  ]);
}

export function newRule(
  kind: RadarRuleKind,
  match: RadarRuleMatch,
  origin: RadarOrigin,
  now: Date,
  note?: string,
): RadarRule {
  return {
    id: randomUUID(),
    kind,
    match,
    origin,
    createdAt: now.toISOString(),
    ...(note ? { note } : {}),
  };
}

/**
 * Puts a rule in place of the one with the same match. An explicit rule replaces anything;
 * learning never replaces or crowds out an explicit rule. Returns `learned` itself when
 * nothing changes.
 */
export function withRule(learned: RadarLearned, rule: RadarRule): RadarLearned {
  const key = ruleKey(rule.match);
  const existing = learned.rules.find((item) => ruleKey(item.match) === key);
  if (existing?.origin === "explicit" && rule.origin === "learned") return learned;
  if (
    existing &&
    existing.kind === rule.kind &&
    existing.origin === rule.origin &&
    existing.note === rule.note
  )
    return learned;
  const rules = [...learned.rules.filter((item) => item !== existing), rule];
  if (rules.length > RADAR_MAX_RULES) {
    const oldestLearned = rules.findIndex((item) => item.origin === "learned" && item !== rule);
    if (oldestLearned < 0) {
      if (rule.origin === "learned") return learned;
      throw new RadarError("BAD_REQUEST", "Remove a rule before adding another.");
    }
    rules.splice(oldestLearned, 1);
  }
  return { ...learned, rules };
}

export function withoutRule(learned: RadarLearned, id: string): RadarLearned {
  const rules = learned.rules.filter((rule) => rule.id !== id);
  return rules.length === learned.rules.length ? learned : { ...learned, rules };
}

/** A learned person gains weight; people the owner described are left as they are. */
export function withImportantSender(learned: RadarLearned, sender: RadarSender): RadarLearned {
  const index = learned.people.findIndex((person) => person.addresses.includes(sender.address));
  const known = learned.people[index];
  if (known) {
    if (known.origin === "explicit" || known.weight >= 3) return learned;
    return {
      ...learned,
      people: learned.people.with(index, { ...known, weight: known.weight + 1 }),
    };
  }
  const person: RadarPerson = {
    name: (sender.name || sender.address).slice(0, 120),
    addresses: [sender.address],
    relation: "",
    weight: 1,
    origin: "learned",
  };
  const people = [...learned.people, person];
  if (people.length > RADAR_MAX_PEOPLE) {
    const learnedPeople = people.filter((item) => item.origin === "learned" && item !== person);
    if (!learnedPeople.length) return learned;
    const weakest = Math.min(...learnedPeople.map((item) => item.weight));
    people.splice(
      people.findIndex(
        (item) => item.origin === "learned" && item !== person && item.weight === weakest,
      ),
      1,
    );
  }
  return { ...learned, people };
}

/**
 * Deterministic learning from one piece of feedback (docs/proactive-layer.md, section 8).
 * `history` already includes this feedback. Returns `learned` itself when nothing changes.
 */
export function learnFromFeedback(
  learned: RadarLearned,
  kind: RadarFeedbackKind,
  sender: RadarSender | null,
  history: SenderHistory,
  now: Date,
): RadarLearned {
  if (!sender) return learned;
  const match = { sender: sender.address };
  switch (kind) {
    case "mute_sender":
      return withRule(learned, newRule("never", match, "explicit", now));
    case "always_sender":
      return withRule(learned, newRule("always", match, "explicit", now));
    case "not_important":
      return history.notImportant >= 2 && history.important === 0
        ? withRule(learned, newRule("digest", match, "learned", now))
        : learned;
    case "important": {
      const weighted = withImportantSender(learned, sender);
      return history.important >= 2
        ? withRule(weighted, newRule("always", match, "learned", now))
        : weighted;
    }
    default:
      return learned;
  }
}
