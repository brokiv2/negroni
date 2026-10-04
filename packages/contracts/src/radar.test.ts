import { describe, expect, it } from "vitest";
import { MessageBlock, StoredMessageBlock, UNSUPPORTED_BLOCK_TEXT } from "./events.js";
import {
  isRadarSource,
  RADAR_PAUSED_UNTIL_RESUMED,
  RadarFeedbackInput,
  RadarRuleChange,
  RadarRuleMatch,
  RadarSettingsPatch,
  RadarSettingsSchema,
  RadarTraceSchema,
  RadarUpdateSchema,
  RadarUpdatesInput,
} from "./radar.js";

describe("radar settings", () => {
  it("defaults to off with the documented schedule", () => {
    expect(RadarSettingsSchema.parse({})).toEqual({
      enabled: false,
      level: "important",
      timeZone: "UTC",
      language: "",
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
      morningBrief: { enabled: true, time: "08:30" },
      eveningBrief: { enabled: false, time: "18:30" },
      maxInterruptsPerDay: 6,
      meetingPrep: true,
      contextPaths: [],
    });
  });

  it("fills fields a stored nested object predates", () => {
    expect(RadarSettingsSchema.parse({ quietHours: { enabled: false } }).quietHours).toEqual({
      enabled: false,
      start: "22:00",
      end: "08:00",
    });
  });

  it("validates times, zones, caps and language", () => {
    const bad = [
      { quietHours: { start: "24:00" } },
      { morningBrief: { time: "8:30" } },
      { timeZone: "Mars/Olympus" },
      { maxInterruptsPerDay: 31 },
      { maxInterruptsPerDay: -1 },
      { level: "everything" },
      { language: "x".repeat(41) },
    ];
    for (const value of bad)
      expect(RadarSettingsSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    expect(RadarSettingsSchema.parse({ timeZone: "Europe/Helsinki" }).timeZone).toBe(
      "Europe/Helsinki",
    );
  });

  it("keeps context files inside the knowledge folder", () => {
    const ok = (contextPaths: string[]) => RadarSettingsSchema.safeParse({ contextPaths }).success;
    expect(ok(["Notes/priorities.md", "AGENTS.md", "a/b..c/notes.md"])).toBe(true);
    expect(ok(["/etc/passwd"])).toBe(false);
    expect(ok(["~/notes.md"])).toBe(false);
    expect(ok(["C:\\notes.md"])).toBe(false);
    expect(ok(["notes/../../secret.md"])).toBe(false);
    expect(ok(["..\\secret.md"])).toBe(false);
    expect(ok(["notes.md", "notes.md"])).toBe(false);
    expect(ok(Array.from({ length: 11 }, (_, index) => `n${index}.md`))).toBe(false);
  });

  it("patches carry only what was sent, including inside nested objects", () => {
    expect(RadarSettingsPatch.parse({})).toEqual({});
    expect(RadarSettingsPatch.parse({ level: "urgent" })).toEqual({ level: "urgent" });
    expect(RadarSettingsPatch.parse({ quietHours: { start: "23:00" } })).toEqual({
      quietHours: { start: "23:00" },
    });
    expect(RadarSettingsPatch.parse({ eveningBrief: { enabled: true } })).toEqual({
      eveningBrief: { enabled: true },
    });
    expect(RadarSettingsPatch.safeParse({ quietHours: { start: "25:00" } }).success).toBe(false);
  });

  it("pauses until a time, resumes with null, and keeps a pause when omitted", () => {
    expect(RadarSettingsSchema.parse({}).pausedUntil).toBeUndefined();
    expect(RadarSettingsSchema.parse({ pausedUntil: RADAR_PAUSED_UNTIL_RESUMED }).pausedUntil).toBe(
      RADAR_PAUSED_UNTIL_RESUMED,
    );
    expect(RadarSettingsPatch.parse({ pausedUntil: null })).toEqual({ pausedUntil: null });
    expect(RadarSettingsPatch.parse({ level: "more" })).not.toHaveProperty("pausedUntil");
    expect(RadarSettingsPatch.safeParse({ pausedUntil: "in an hour" }).success).toBe(false);
  });
});

describe("radar rules and inputs", () => {
  it("needs at least one match field and normalizes addresses", () => {
    expect(RadarRuleMatch.safeParse({}).success).toBe(false);
    expect(RadarRuleMatch.parse({ sender: "  Someone@Example.TEST " })).toEqual({
      sender: "someone@example.test",
    });
    expect(RadarRuleMatch.parse({ domain: "Example.TEST" })).toEqual({ domain: "example.test" });
    expect(RadarRuleMatch.safeParse({ domain: "@example.test" }).success).toBe(false);
    expect(RadarRuleMatch.parse({ source: "Gmail" })).toEqual({ source: "gmail" });
  });

  it("adds or removes exactly one rule", () => {
    const add = { kind: "never", match: { topic: "Newsletters" } };
    expect(RadarRuleChange.safeParse({ add }).success).toBe(true);
    expect(RadarRuleChange.safeParse({ removeId: "rule-1" }).success).toBe(true);
    expect(RadarRuleChange.safeParse({}).success).toBe(false);
    expect(RadarRuleChange.safeParse({ add, removeId: "rule-1" }).success).toBe(false);
  });

  it("requires a time for a snooze and only for a snooze", () => {
    const until = "2026-10-04T08:00:00.000Z";
    expect(RadarFeedbackInput.safeParse({ id: "u1", kind: "snooze" }).success).toBe(false);
    expect(RadarFeedbackInput.safeParse({ id: "u1", kind: "snooze", until }).success).toBe(true);
    expect(RadarFeedbackInput.safeParse({ id: "u1", kind: "done", until }).success).toBe(false);
    expect(RadarFeedbackInput.safeParse({ id: "u1", kind: "done" }).success).toBe(true);
  });

  it("bounds update pages", () => {
    expect(RadarUpdatesInput.parse({ view: "open" })).toEqual({ view: "open", limit: 50 });
    expect(RadarUpdatesInput.safeParse({ view: "open", limit: 101 }).success).toBe(false);
    expect(RadarUpdatesInput.safeParse({ view: "later" }).success).toBe(false);
  });

  it("knows which toolkits it can read", () => {
    expect(isRadarSource("gmail")).toBe(true);
    expect(isRadarSource(" GoogleCalendar ")).toBe(true);
    expect(isRadarSource("github")).toBe(false);
  });
});

describe("radar message blocks", () => {
  const update = {
    kind: "update",
    summary: "A colleague needs the budget figures by 15:00.",
    updateId: "signal-1",
    source: "gmail",
    title: "Budget figures due today",
    actor: { name: "A colleague", address: "colleague@example.test" },
    why: "They need the figures before the 15:00 review.",
    nextStep: "Send the spreadsheet.",
    url: "https://mail.example.test/thread/1",
    urgency: "today",
    action: "reply",
    occurredAt: "2026-10-04T09:12:00.000Z",
  };
  const brief = {
    kind: "brief",
    summary: "Two things need you today.",
    briefId: "brief-1",
    period: "morning",
    title: "Morning brief",
    items: [{ updateId: "signal-1", title: "Budget figures due today", source: "gmail" }],
    agenda: [{ title: "Review", start: "2026-10-04T12:00:00.000Z", end: "2026-10-04T13:00:00Z" }],
  };

  it("accepts update and brief cards", () => {
    expect(MessageBlock.parse(update)).toEqual(update);
    expect(MessageBlock.parse(brief)).toEqual(brief);
  });

  it("refuses links that are not http(s) and over-long text", () => {
    expect(MessageBlock.safeParse({ ...update, url: "javascript:alert(1)" }).success).toBe(false);
    expect(MessageBlock.safeParse({ ...update, url: "file:///etc/hosts" }).success).toBe(false);
    expect(MessageBlock.safeParse({ ...update, why: "x".repeat(281) }).success).toBe(false);
    expect(MessageBlock.safeParse({ ...update, summary: "" }).success).toBe(false);
    expect(
      MessageBlock.safeParse({
        ...brief,
        items: [{ ...brief.items[0], url: "mailto:someone@example.test" }],
      }).success,
    ).toBe(false);
  });

  it("still reads blocks written before Radar and degrades a malformed card to its summary", () => {
    for (const block of [
      { kind: "text", text: "hello" },
      { kind: "meta", text: "note" },
      { kind: "card", lines: [{ k: "a", v: "b" }] },
    ])
      expect(StoredMessageBlock.parse(block)).toEqual(block);
    expect(StoredMessageBlock.parse({ ...update, urgency: "someday" })).toEqual({
      kind: "meta",
      text: update.summary,
    });
    expect(StoredMessageBlock.parse({ kind: "hologram" })).toEqual({
      kind: "meta",
      text: UNSUPPORTED_BLOCK_TEXT,
    });
  });
});

describe("radar triage fields", () => {
  it("records the rubric, cost of delay, verdict, who must act and the owner's offset", () => {
    const trace = {
      scores: {
        addressed: 3,
        actionRequired: 2,
        timePressure: 2,
        stakes: 1,
        relationship: 3,
        novelty: 1,
        linkage: 0,
        seen: 0,
      },
      costOfDelay: "high",
      verdict: "scored",
      whoMustAct: "owner",
      thresholdOffset: -4,
    };
    expect(RadarTraceSchema.parse(trace)).toEqual(trace);
    expect(RadarTraceSchema.safeParse({ scores: { ...trace.scores, stakes: 4 } }).success).toBe(
      false,
    );
    expect(RadarTraceSchema.safeParse({ whoMustAct: "team" }).success).toBe(false);
    expect(RadarTraceSchema.safeParse({ costOfDelay: "medium" }).success).toBe(false);
  });

  it("bounds the offer and the evidence on views and cards", () => {
    const view = {
      id: "signal-1",
      source: "gmail",
      kind: "email",
      title: "Budget figures due today",
      occurredAt: "2026-10-04T09:12:00.000Z",
      excerpt: "",
      state: "open",
      offer: "Draft a reply?",
      evidence: "Could you send the budget figures before the review?",
    };
    expect(RadarUpdateSchema.parse(view)).toEqual(view);
    expect(RadarUpdateSchema.safeParse({ ...view, offer: "x".repeat(81) }).success).toBe(false);
    expect(RadarUpdateSchema.safeParse({ ...view, evidence: "x".repeat(301) }).success).toBe(false);
    const card = {
      kind: "update",
      summary: "A colleague needs the budget figures.",
      updateId: "signal-1",
      source: "gmail",
      title: "Budget figures due today",
      why: "They need the figures before the review.",
      urgency: "today",
      action: "reply",
      occurredAt: "2026-10-04T09:12:00.000Z",
      offer: "Draft a reply?",
      evidence: "Could you send the budget figures before the review?",
    };
    expect(MessageBlock.parse(card)).toEqual(card);
    expect(MessageBlock.safeParse({ ...card, offer: "x".repeat(81) }).success).toBe(false);
    expect(MessageBlock.safeParse({ ...card, evidence: "" }).success).toBe(false);
  });
});
