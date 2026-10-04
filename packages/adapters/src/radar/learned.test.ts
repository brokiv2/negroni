import { RADAR_MAX_PEOPLE, RADAR_MAX_RULES } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { RadarLearned } from "./learned.js";
import {
  learnFromFeedback,
  newRule,
  parseLearned,
  ruleKey,
  senderOf,
  withImportantSender,
  withoutRule,
  withRule,
} from "./learned.js";

const now = new Date("2026-10-04T09:00:00Z");
const empty = (): RadarLearned => ({ rules: [], people: [] });
const sender = { address: "colleague@example.test", name: "A colleague" };
const none = { important: 0, notImportant: 0 };

describe("radar learning", () => {
  it("keys senders by normalized address only", () => {
    expect(senderOf({ name: "X", address: "  Colleague@Example.TEST " })).toEqual({
      address: "colleague@example.test",
      name: "X",
    });
    expect(senderOf({ name: "Only a name" })).toBeNull();
    expect(senderOf(null)).toBeNull();
    expect(senderOf({ address: "" })).toBeNull();
  });

  it("turns mute and always into explicit rules for the sender", () => {
    const muted = learnFromFeedback(empty(), "mute_sender", sender, none, now);
    expect(muted.rules).toMatchObject([
      { kind: "never", origin: "explicit", match: { sender: sender.address } },
    ]);
    const always = learnFromFeedback(muted, "always_sender", sender, none, now);
    expect(always.rules).toMatchObject([
      { kind: "always", origin: "explicit", match: { sender: sender.address } },
    ]);
  });

  it("learns a digest rule after two not-important marks without an important one", () => {
    const once = learnFromFeedback(
      empty(),
      "not_important",
      sender,
      { important: 0, notImportant: 1 },
      now,
    );
    expect(once.rules).toEqual([]);
    const twice = learnFromFeedback(
      empty(),
      "not_important",
      sender,
      { important: 0, notImportant: 2 },
      now,
    );
    expect(twice.rules).toMatchObject([
      { kind: "digest", origin: "learned", match: { sender: sender.address } },
    ]);
    const contested = learnFromFeedback(
      empty(),
      "not_important",
      sender,
      { important: 1, notImportant: 3 },
      now,
    );
    expect(contested.rules).toEqual([]);
  });

  it("weights a sender marked important and learns an always rule the second time", () => {
    const once = learnFromFeedback(
      empty(),
      "important",
      sender,
      { important: 1, notImportant: 0 },
      now,
    );
    expect(once.people).toEqual([
      {
        name: "A colleague",
        addresses: [sender.address],
        relation: "",
        weight: 1,
        origin: "learned",
      },
    ]);
    expect(once.rules).toEqual([]);
    const twice = learnFromFeedback(
      once,
      "important",
      sender,
      { important: 2, notImportant: 0 },
      now,
    );
    expect(twice.people[0]?.weight).toBe(2);
    expect(twice.rules).toMatchObject([{ kind: "always", origin: "learned" }]);
    // A learned always rule replaces the learned digest rule for the same sender.
    const digest = withRule(empty(), newRule("digest", { sender: sender.address }, "learned", now));
    const flipped = learnFromFeedback(
      digest,
      "important",
      sender,
      { important: 2, notImportant: 0 },
      now,
    );
    expect(flipped.rules).toMatchObject([{ kind: "always", origin: "learned" }]);
  });

  it("never lets learning replace or remove an explicit rule or person", () => {
    const explicit = withRule(
      empty(),
      newRule("never", { sender: sender.address }, "explicit", now),
    );
    expect(
      learnFromFeedback(explicit, "important", sender, { important: 5, notImportant: 0 }, now)
        .rules,
    ).toEqual(explicit.rules);
    const described: RadarLearned = {
      rules: [],
      people: [
        {
          name: "Manager",
          addresses: [sender.address],
          relation: "manager",
          weight: 2,
          origin: "explicit",
        },
      ],
    };
    expect(withImportantSender(described, sender)).toBe(described);
  });

  it("returns the same object when nothing changes", () => {
    const learned = withRule(
      empty(),
      newRule("digest", { sender: sender.address }, "learned", now),
    );
    expect(withRule(learned, newRule("digest", { sender: sender.address }, "learned", now))).toBe(
      learned,
    );
    expect(learnFromFeedback(learned, "done", sender, none, now)).toBe(learned);
    expect(learnFromFeedback(learned, "mute_sender", null, none, now)).toBe(learned);
    expect(withoutRule(learned, "missing")).toBe(learned);
    expect(withoutRule(learned, learned.rules[0]!.id).rules).toEqual([]);
  });

  it("treats topic spelling and case as one rule", () => {
    expect(ruleKey({ topic: "Quarterly Report" })).toBe(ruleKey({ topic: " quarterly report " }));
    expect(ruleKey({ sender: "a@example.test" })).not.toBe(ruleKey({ domain: "example.test" }));
  });

  it("keeps within caps: learning drops its oldest rule, an explicit rule over the cap is refused", () => {
    let learned = empty();
    for (let index = 0; index < RADAR_MAX_RULES; index++)
      learned = withRule(learned, newRule("never", { topic: `topic ${index}` }, "explicit", now));
    expect(learned.rules).toHaveLength(RADAR_MAX_RULES);
    expect(withRule(learned, newRule("digest", { sender: sender.address }, "learned", now))).toBe(
      learned,
    );
    expect(() =>
      withRule(learned, newRule("never", { topic: "one more" }, "explicit", now)),
    ).toThrow(/Remove a rule/);
    const mixed = withRule(
      {
        ...learned,
        rules: [
          newRule("digest", { sender: "old@example.test" }, "learned", now),
          ...learned.rules.slice(1),
        ],
      },
      newRule("digest", { sender: sender.address }, "learned", now),
    );
    expect(mixed.rules).toHaveLength(RADAR_MAX_RULES);
    expect(mixed.rules.some((rule) => rule.match.sender === "old@example.test")).toBe(false);
    let people = empty();
    for (let index = 0; index <= RADAR_MAX_PEOPLE; index++)
      people = withImportantSender(people, { address: `p${index}@example.test` });
    expect(people.people).toHaveLength(RADAR_MAX_PEOPLE);
  });

  it("reads stored learning tolerantly", () => {
    const rule = newRule("never", { sender: sender.address }, "explicit", now);
    expect(parseLearned({ rules: [rule, { kind: "bogus" }], people: "nope" })).toEqual({
      rules: [rule],
      people: [],
    });
    expect(parseLearned(null)).toEqual(empty());
  });
});
