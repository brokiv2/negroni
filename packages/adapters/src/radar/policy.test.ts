import { RadarSettingsSchema } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { PolicyContext, RadarJudgement } from "./policy.js";
import {
  decide,
  needsSecondOpinion,
  RADAR_POLICY_VERSION,
  radarImportance,
  radarUrgency,
} from "./policy.js";
import { meetingEnd, quietHoursEnd } from "./schedule.js";

const now = new Date("2026-10-05T10:00:00Z");
const scores = (value: number, seen = 3) => ({
  addressed: value,
  actionRequired: value,
  timePressure: value,
  stakes: value,
  relationship: value,
  novelty: value,
  linkage: value,
  seen,
});
/** importance 100, everything an interrupt needs. */
const urgent: RadarJudgement = {
  scores: scores(3),
  costOfDelay: "high",
  verdict: "scored",
  whoMustAct: "owner",
  confidence: 0.9,
};
const context = (patch: Partial<PolicyContext> = {}): PolicyContext => ({
  now,
  level: "important",
  dailyCap: 4,
  ownerOffset: 0,
  senderShift: 0,
  rules: { never: [], digest: [], always: [] },
  paused: false,
  interruptsToday: 0,
  ...patch,
});

describe("importance", () => {
  it("weights the rubric and discounts what was already handled", () => {
    expect(radarImportance(scores(3))).toBe(100);
    expect(radarImportance(scores(0, 0))).toBe(0);
    expect(radarImportance(scores(3, 0))).toBe(30);
    expect(
      radarImportance({ ...scores(0), actionRequired: 3, stakes: 3, addressed: 3, seen: 3 }),
    ).toBe(52);
  });

  it("derives the view's urgency from time pressure and cost of delay", () => {
    expect(radarUrgency({ ...urgent, costOfDelay: "critical" })).toBe("now");
    expect(radarUrgency({ ...urgent, scores: { ...scores(2), timePressure: 2 } })).toBe("today");
    expect(
      radarUrgency({ ...urgent, costOfDelay: "low", scores: { ...scores(1), timePressure: 1 } }),
    ).toBe("week");
    expect(radarUrgency({ ...urgent, costOfDelay: "none", scores: scores(0) })).toBe("none");
  });
});

describe("decision policy", () => {
  it("is versioned", () => {
    expect(RADAR_POLICY_VERSION).toBeGreaterThan(0);
  });

  it.each([
    ["urgent", 80, 50],
    ["important", 70, 45],
    ["more", 60, 35],
  ] as const)("level %s interrupts at %i and briefs at %i", (level, interrupt, brief) => {
    expect(decide(urgent, context({ level })).thresholds).toEqual({ interrupt, brief });
  });

  it("interrupts only with importance, a real cost of delay, confidence and an unseen item", () => {
    expect(decide(urgent, context())).toMatchObject({ disposition: "interrupt", held: false });
    expect(decide({ ...urgent, costOfDelay: "low" }, context()).disposition).toBe("brief");
    expect(decide({ ...urgent, confidence: 0.84 }, context())).toMatchObject({
      disposition: "brief",
      gates: ["low_confidence"],
    });
    expect(decide({ ...urgent, scores: scores(3, 1) }, context())).toMatchObject({
      disposition: "brief",
      gates: ["already_seen"],
    });
    const quiet = decide({ ...urgent, scores: scores(0) }, context());
    expect(quiet).toMatchObject({ disposition: "silent", reason: "Below your threshold." });
    expect(quiet.gates).toEqual(["below_threshold"]);
    // Expected action alone earns a brief.
    expect(
      decide({ ...urgent, scores: { ...scores(0), actionRequired: 2, seen: 3 } }, context())
        .disposition,
    ).toBe("brief");
  });

  it("applies rules first: never, then digest, then always", () => {
    expect(
      decide(urgent, context({ rules: { never: ["r1"], digest: [], always: ["r2"] } })),
    ).toMatchObject({
      disposition: "silent",
      gates: ["rule_never"],
    });
    expect(
      decide(urgent, context({ rules: { never: [], digest: ["r1"], always: ["r2"] } })),
    ).toMatchObject({
      disposition: "brief",
      gates: ["rule_digest"],
    });
    const always = decide(
      { ...urgent, scores: scores(1), costOfDelay: "none", confidence: 0.2 },
      context({ rules: { never: [], digest: [], always: ["r2"] } }),
    );
    expect(always).toMatchObject({ disposition: "interrupt" });
    expect(always.gates).toContain("rule_always");
  });

  it("keeps someone else's task and unclear items for the brief", () => {
    expect(decide({ ...urgent, whoMustAct: "someone_else" }, context())).toMatchObject({
      disposition: "brief",
      gates: ["not_owner"],
    });
    expect(decide({ ...urgent, verdict: "unclear" }, context())).toMatchObject({
      disposition: "brief",
      gates: ["unclear"],
    });
    // A rule cannot make another person's task an interrupt either.
    expect(
      decide(
        { ...urgent, whoMustAct: "nobody" },
        context({ rules: { never: [], digest: [], always: ["r"] } }),
      ).disposition,
    ).toBe("brief");
  });

  it("holds while paused, critical or not", () => {
    const paused = decide({ ...urgent, costOfDelay: "critical" }, context({ paused: true }));
    expect(paused).toMatchObject({ disposition: "brief", held: true, critical: true });
    expect(paused.gates).toEqual(["critical", "paused"]);
  });

  it("defers for quiet hours and meetings unless critical", () => {
    const quietUntil = new Date("2026-10-06T05:00:00Z");
    expect(decide(urgent, context({ quietUntil }))).toMatchObject({
      disposition: "interrupt",
      held: true,
      deliverAt: quietUntil,
      gates: ["quiet_hours"],
    });
    const meetingUntil = new Date("2026-10-05T10:30:00Z");
    expect(decide(urgent, context({ meetingUntil }))).toMatchObject({
      disposition: "interrupt",
      deliverAt: new Date("2026-10-05T10:32:00Z"),
      gates: ["in_meeting"],
    });
    const critical = decide(
      { ...urgent, costOfDelay: "critical" },
      context({ quietUntil, meetingUntil }),
    );
    expect(critical).toMatchObject({ disposition: "interrupt", critical: true, held: false });
    expect(critical.deliverAt).toBeUndefined();
  });

  it("caps the day, limits a story to one interrupt and spaces interrupts", () => {
    expect(
      decide({ ...urgent, costOfDelay: "critical" }, context({ interruptsToday: 4 })),
    ).toMatchObject({
      disposition: "brief",
      held: true,
      gates: ["critical", "daily_cap"],
    });
    expect(decide(urgent, context({ storyInterrupt: { critical: false } }))).toMatchObject({
      disposition: "brief",
      gates: ["story_limit"],
    });
    // Cost of delay rising to critical earns one more.
    expect(
      decide(
        { ...urgent, costOfDelay: "critical" },
        context({ storyInterrupt: { critical: false } }),
      ).disposition,
    ).toBe("interrupt");
    expect(
      decide(
        { ...urgent, costOfDelay: "critical" },
        context({ storyInterrupt: { critical: true } }),
      ).disposition,
    ).toBe("brief");
    const last = new Date("2026-10-05T09:45:00Z");
    expect(decide(urgent, context({ lastInterruptAt: last }))).toMatchObject({
      disposition: "interrupt",
      deliverAt: new Date("2026-10-05T10:15:00Z"),
      gates: ["spacing"],
    });
    expect(
      decide({ ...urgent, costOfDelay: "critical" }, context({ lastInterruptAt: last })).deliverAt,
    ).toBeUndefined();
  });

  it("shifts the interrupt threshold within bounds", () => {
    const at = (ownerOffset: number, senderShift: number) =>
      decide(urgent, context({ ownerOffset, senderShift })).thresholds.interrupt;
    expect(at(5, 0)).toBe(75);
    expect(at(-3, -10)).toBe(57);
    expect(at(40, 40)).toBe(90);
    expect(at(-40, -40)).toBe(52);
    // 73 interrupts at the default threshold but not once the owner asked for fewer.
    const seventyTwo = { ...urgent, scores: { ...scores(2), actionRequired: 3, seen: 3 } };
    expect(radarImportance(seventyTwo.scores)).toBe(73);
    expect(decide(seventyTwo, context()).disposition).toBe("interrupt");
    expect(decide(seventyTwo, context({ ownerOffset: 5 })).disposition).toBe("brief");
  });

  it("asks for a second opinion on borderline interrupts and critical claims from strangers", () => {
    const close = { ...urgent, scores: { ...scores(2), actionRequired: 3, seen: 3 } };
    expect(needsSecondOpinion(close, decide(close, context()))).toBe(true);
    expect(needsSecondOpinion(urgent, decide(urgent, context()))).toBe(false);
    const stranger = {
      ...urgent,
      costOfDelay: "critical" as const,
      scores: { ...scores(3), relationship: 0 },
    };
    expect(needsSecondOpinion(stranger, decide(stranger, context()))).toBe(true);
    const ruled = decide(close, context({ rules: { never: [], digest: [], always: ["r"] } }));
    expect(needsSecondOpinion(close, ruled)).toBe(false);
  });
});

describe("quiet hours and meetings", () => {
  const settings = (zone: string, start = "22:00", end = "08:00") =>
    RadarSettingsSchema.parse({ timeZone: zone, quietHours: { start, end } });

  it("spans midnight in the owner's time zone", () => {
    const helsinki = settings("Europe/Helsinki");
    // 23:30 local → ends 08:00 tomorrow local.
    expect(quietHoursEnd(helsinki, new Date("2026-10-05T20:30:00Z"))?.toISOString()).toBe(
      "2026-10-06T05:00:00.000Z",
    );
    // 06:00 local → ends 08:00 today local.
    expect(quietHoursEnd(helsinki, new Date("2026-10-06T03:00:00Z"))?.toISOString()).toBe(
      "2026-10-06T05:00:00.000Z",
    );
    expect(quietHoursEnd(helsinki, new Date("2026-10-06T07:00:00Z"))).toBeUndefined();
    // The same instant is daytime in Los Angeles.
    expect(
      quietHoursEnd(settings("America/Los_Angeles"), new Date("2026-10-05T20:30:00Z")),
    ).toBeUndefined();
  });

  it("handles a window inside one day and turned-off quiet hours", () => {
    const lunch = settings("UTC", "12:00", "13:00");
    expect(quietHoursEnd(lunch, new Date("2026-10-05T12:30:00Z"))?.toISOString()).toBe(
      "2026-10-05T13:00:00.000Z",
    );
    expect(quietHoursEnd(lunch, new Date("2026-10-05T13:00:00Z"))).toBeUndefined();
    const off = RadarSettingsSchema.parse({ quietHours: { enabled: false } });
    expect(quietHoursEnd(off, new Date("2026-10-05T23:00:00Z"))).toBeUndefined();
  });

  it("finds an accepted meeting with others in progress and chains overlaps", () => {
    const event = (id: string, start: string, end: string, extra: object = {}) => ({
      id,
      title: id,
      start,
      end,
      attendees: ["colleague@example.test"],
      response: "accepted",
      ...extra,
    });
    const agenda = [
      event("a", "2026-10-05T09:30:00Z", "2026-10-05T10:15:00Z"),
      event("b", "2026-10-05T10:15:00Z", "2026-10-05T11:00:00Z"),
      event("solo", "2026-10-05T09:00:00Z", "2026-10-05T12:00:00Z", { attendees: [] }),
      event("declined", "2026-10-05T09:00:00Z", "2026-10-05T12:00:00Z", { response: "declined" }),
      event("day", "2026-10-05", "2026-10-06", { allDay: true }),
    ];
    expect(meetingEnd(agenda, now)?.toISOString()).toBe("2026-10-05T11:00:00.000Z");
    expect(meetingEnd(agenda, new Date("2026-10-05T12:00:00Z"))).toBeUndefined();
  });
});
