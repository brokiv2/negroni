import * as z from "zod";
import { Id, IsoDate } from "./ids.js";
import { TimeZoneSchema } from "./personal-feed.js";

/**
 * Radar watches the owner's connected accounts in the background and decides, for each
 * change, whether to tell the owner now, keep it for the next brief, or stay silent.
 * Design: docs/proactive-layer.md.
 */

/** Toolkit slugs Radar can read. Every other connected account is listed as unsupported. */
export const RADAR_SOURCES = [
  "gmail",
  "googlecalendar",
  "granola_mcp",
  "slack",
  "todoist",
  "googledrive",
] as const;
export const isRadarSource = (slug: string) =>
  (RADAR_SOURCES as readonly string[]).includes(slug.trim().toLowerCase());

export const RADAR_MAX_RULES = 200;
export const RADAR_MAX_PEOPLE = 100;
/** Excerpts are stored longer for triage; views and cards carry a short one. */
export const RADAR_VIEW_EXCERPT_MAX = 500;
/** The one action the assistant proposes, phrased as a short question. */
export const RADAR_OFFER_MAX = 80;
/** A short verbatim quote from the source that grounds the reason. */
export const RADAR_EVIDENCE_MAX = 300;
/** `pausedUntil` for "until resumed". */
export const RADAR_PAUSED_UNTIL_RESUMED = "9999-12-31T23:59:59.000Z";
export const RADAR_UPDATES_MAX_LIMIT = 100;

/* -------------------------------- settings ------------------------------- */

export const RadarLevel = z.enum(["urgent", "important", "more"]);
export type RadarLevel = z.infer<typeof RadarLevel>;
/** Daily interrupt cap each level starts with; the cap follows the level until changed. */
export const RADAR_LEVEL_DEFAULT_CAP: Record<RadarLevel, number> = {
  urgent: 2,
  important: 4,
  more: 8,
};

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time");
const RadarLanguage = z.string().trim().max(40);
const InterruptCap = z.number().int().min(0).max(30);
/** A file under the owner's knowledge folder: never absolute, never climbing out of it. */
const ContextPath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (path) =>
      !/^([/\\~]|[a-z]:)/i.test(path) &&
      !path.split(/[/\\]/).includes("..") &&
      !path.includes("\0"),
    "Use a path inside your knowledge folder",
  );
const ContextPaths = z
  .array(ContextPath)
  .max(10)
  .refine((paths) => new Set(paths).size === paths.length, "Choose each file once");

export const RadarSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  level: RadarLevel.default("important"),
  timeZone: TimeZoneSchema.default("UTC"),
  /** Empty follows the language of the owner's conversation. */
  language: RadarLanguage.default(""),
  quietHours: z
    .object({
      enabled: z.boolean().default(true),
      start: ClockTime.default("22:00"),
      end: ClockTime.default("08:00"),
    })
    .prefault({}),
  morningBrief: z
    .object({ enabled: z.boolean().default(true), time: ClockTime.default("08:30") })
    .prefault({}),
  eveningBrief: z
    .object({ enabled: z.boolean().default(false), time: ClockTime.default("18:30") })
    .prefault({}),
  maxInterruptsPerDay: InterruptCap.default(RADAR_LEVEL_DEFAULT_CAP.important),
  meetingPrep: z.boolean().default(true),
  contextPaths: ContextPaths.default([]),
  /** Paused until this time; null or absent means running. */
  pausedUntil: IsoDate.nullable().optional(),
});
export type RadarSettings = z.infer<typeof RadarSettingsSchema>;

const BriefTime = z.object({ enabled: z.boolean(), time: ClockTime });
// Patch fields must not inherit settings defaults: omitted values, including omitted fields
// inside quiet hours and briefs, preserve what is saved.
export const RadarSettingsPatch = z.object({
  enabled: z.boolean().optional(),
  level: RadarLevel.optional(),
  timeZone: TimeZoneSchema.optional(),
  language: RadarLanguage.optional(),
  quietHours: z
    .object({ enabled: z.boolean(), start: ClockTime, end: ClockTime })
    .partial()
    .optional(),
  morningBrief: BriefTime.partial().optional(),
  eveningBrief: BriefTime.partial().optional(),
  maxInterruptsPerDay: InterruptCap.optional(),
  meetingPrep: z.boolean().optional(),
  contextPaths: ContextPaths.optional(),
  /** A time pauses Radar until then; null resumes it. */
  pausedUntil: IsoDate.nullable().optional(),
});
export type RadarSettingsPatch = z.infer<typeof RadarSettingsPatch>;

/* -------------------------------- learning ------------------------------- */

export const RadarRuleKind = z.enum(["always", "digest", "never"]);
export type RadarRuleKind = z.infer<typeof RadarRuleKind>;
export const RadarOrigin = z.enum(["explicit", "learned"]);
export type RadarOrigin = z.infer<typeof RadarOrigin>;

const Address = z.string().trim().toLowerCase().min(1).max(320);
export const RadarRuleMatch = z
  .object({
    /** Sender address or account handle, compared case-insensitively. */
    sender: Address.optional(),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/, "Use a domain like example.com")
      .optional(),
    topic: z.string().trim().min(1).max(100).optional(),
    /** Toolkit slug, for example `gmail`. */
    source: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_.-]+$/)
      .optional(),
  })
  .refine(
    (match) => Boolean(match.sender || match.domain || match.topic || match.source),
    "Match at least one of sender, domain, topic or source",
  );
export type RadarRuleMatch = z.infer<typeof RadarRuleMatch>;

export const RadarRuleInput = z.object({
  kind: RadarRuleKind,
  match: RadarRuleMatch,
  note: z.string().trim().max(200).optional(),
});
export const RadarRuleSchema = RadarRuleInput.extend({
  id: z.string().min(1).max(100),
  origin: RadarOrigin,
  createdAt: IsoDate,
});
export type RadarRule = z.infer<typeof RadarRuleSchema>;

export const RadarPersonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  addresses: z.array(Address).max(10),
  relation: z.string().trim().max(120),
  weight: z.number().int().min(-2).max(3),
  origin: RadarOrigin,
});
export type RadarPerson = z.infer<typeof RadarPersonSchema>;

/* -------------------------------- sources -------------------------------- */

export const RadarSourceState = z.enum(["ok", "error", "revoked", "paused", "unsupported"]);
export type RadarSourceState = z.infer<typeof RadarSourceState>;
export const RadarSourceStatusSchema = z.object({
  connectionId: Id,
  /** Toolkit slug. */
  source: z.string(),
  label: z.string(),
  /** Provider-verified account, when known. */
  account: z.string().optional(),
  enabled: z.boolean(),
  supported: z.boolean(),
  state: RadarSourceState,
  lastCheckAt: IsoDate.optional(),
  nextCheckAt: IsoDate.optional(),
  lastError: z.string().optional(),
  seenToday: z.number().int().nonnegative(),
  /** Items the last check left unread because of its cap. */
  overflow: z.number().int().nonnegative().optional(),
});
export type RadarSourceStatus = z.infer<typeof RadarSourceStatusSchema>;
export const RadarSourceInput = z.object({ connectionId: Id, enabled: z.boolean() });

/* -------------------------------- updates -------------------------------- */

export const RadarUrgency = z.enum(["now", "today", "week", "none"]);
export type RadarUrgency = z.infer<typeof RadarUrgency>;
export const RadarAction = z.enum(["reply", "decide", "attend", "review", "pay", "read", "none"]);
export type RadarAction = z.infer<typeof RadarAction>;
export const RadarDisposition = z.enum(["interrupt", "brief", "silent"]);
export type RadarDisposition = z.infer<typeof RadarDisposition>;
export const RadarUpdateState = z.enum([
  "pending",
  "open",
  "done",
  "snoozed",
  "dismissed",
  "expired",
]);
export type RadarUpdateState = z.infer<typeof RadarUpdateState>;
export const RadarFeedbackKind = z.enum([
  "done",
  "snooze",
  "not_important",
  "important",
  "mute_sender",
  "always_sender",
  "opened",
]);
export type RadarFeedbackKind = z.infer<typeof RadarFeedbackKind>;
export const RadarBriefPeriod = z.enum(["morning", "evening", "now"]);
export type RadarBriefPeriod = z.infer<typeof RadarBriefPeriod>;

export const RadarActorSchema = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(320).optional(),
});
export type RadarActor = z.infer<typeof RadarActorSchema>;

const RubricScore = z.number().int().min(0).max(3);
/** Triage rubric: each dimension scored 0 to 3. */
export const RadarScoresSchema = z.object({
  addressed: RubricScore,
  actionRequired: RubricScore,
  timePressure: RubricScore,
  stakes: RubricScore,
  relationship: RubricScore,
  novelty: RubricScore,
  linkage: RubricScore,
  seen: RubricScore,
});
export type RadarScores = z.infer<typeof RadarScoresSchema>;
export const RadarCostOfDelay = z.enum(["none", "low", "high", "critical"]);
export const RadarVerdict = z.enum(["scored", "unclear"]);
export const RadarWhoMustAct = z.enum(["owner", "someone_else", "nobody", "unclear"]);

/**
 * Reasons that shaped a decision, as written to `trace.gates` in evaluation order. Traces are
 * read tolerantly, so a client should treat a name it does not know as no explanation.
 */
export const RadarGate = z.enum([
  // Explicit rules.
  "rule_never",
  "rule_digest",
  "rule_always",
  // Judgement.
  "unclear",
  "not_owner",
  "below_threshold",
  "low_confidence",
  "already_seen",
  "second_opinion",
  // Delivery gates.
  "critical",
  "paused",
  "quiet_hours",
  "in_meeting",
  "daily_cap",
  "story_limit",
  "spacing",
  "folded_into_brief",
  // Fresh look at the source right before sending.
  "handled_in_source",
  "seen_in_source",
  // Screened before any model call.
  "own",
  "security_code",
  "bulk",
  "declined",
  "calendar_window",
  "backoff",
  "duplicate",
  "stale",
  "unevaluated",
  "meeting_prep",
]);
export type RadarGate = z.infer<typeof RadarGate>;

/** What triage and the policy saw and applied, so the app can answer "why now" and "why not". */
export const RadarTraceSchema = z.object({
  level: RadarLevel.optional(),
  importance: z.number().optional(),
  urgency: RadarUrgency.optional(),
  confidence: z.number().optional(),
  scores: RadarScoresSchema.optional(),
  costOfDelay: RadarCostOfDelay.optional(),
  verdict: RadarVerdict.optional(),
  whoMustAct: RadarWhoMustAct.optional(),
  /** This owner's adaptive shift applied to the level's thresholds. */
  thresholdOffset: z.number().optional(),
  thresholds: z.object({ interrupt: z.number(), brief: z.number() }).optional(),
  /** Ids of the rules that matched. */
  rules: z.array(z.string()).optional(),
  /** Gates that changed the outcome, in evaluation order (`RadarGate` names). */
  gates: z.array(z.string()).optional(),
  result: RadarDisposition.optional(),
  /** Version of the decision policy that produced this trace. */
  policyVersion: z.number().int().optional(),
});
export type RadarTrace = z.infer<typeof RadarTraceSchema>;

export const RadarUpdateSchema = z.object({
  id: Id,
  source: z.string(),
  kind: z.string(),
  title: z.string(),
  actor: RadarActorSchema.optional(),
  occurredAt: IsoDate,
  /** Only http(s) links reach a view. */
  url: z.string().optional(),
  excerpt: z.string().max(RADAR_VIEW_EXCERPT_MAX),
  importance: z.number().int().min(0).max(100).optional(),
  urgency: RadarUrgency.optional(),
  action: RadarAction.optional(),
  why: z.string().optional(),
  nextStep: z.string().optional(),
  offer: z.string().max(RADAR_OFFER_MAX).optional(),
  evidence: z.string().max(RADAR_EVIDENCE_MAX).optional(),
  disposition: RadarDisposition.optional(),
  /** Why it was skipped or deferred, in words the owner can read. */
  reason: z.string().optional(),
  state: RadarUpdateState,
  snoozedUntil: IsoDate.optional(),
  feedback: RadarFeedbackKind.optional(),
  deliveredAt: IsoDate.optional(),
  messageId: Id.optional(),
  threadId: Id.optional(),
  trace: RadarTraceSchema.optional(),
  /** When the story stops mattering (event start, task due). */
  deadline: IsoDate.optional(),
  /** An interrupt that pause, quiet hours, a meeting or the budget postponed. */
  held: z.boolean().optional(),
  /** The account it came from: provider-verified address or the connection's name. */
  account: z.string().optional(),
});
export type RadarUpdate = z.infer<typeof RadarUpdateSchema>;

export const RadarView = z.enum(["open", "brief", "skipped", "all"]);
export type RadarView = z.infer<typeof RadarView>;
export const RadarUpdatesInput = z.object({
  view: RadarView,
  limit: z.number().int().min(1).max(RADAR_UPDATES_MAX_LIMIT).default(50),
  cursor: z.string().min(1).max(500).optional(),
});
export const RadarUpdatesPage = z.object({
  items: z.array(RadarUpdateSchema),
  nextCursor: z.string().optional(),
});

export const RadarFeedbackInput = z
  .object({ id: Id, kind: RadarFeedbackKind, until: IsoDate.optional() })
  .superRefine((value, ctx) => {
    if (value.kind === "snooze" && !value.until)
      ctx.addIssue({ code: "custom", path: ["until"], message: "Choose when to bring it back" });
    if (value.kind !== "snooze" && value.until)
      ctx.addIssue({ code: "custom", path: ["until"], message: "Only a snooze takes a time" });
  });
export type RadarFeedbackInput = z.infer<typeof RadarFeedbackInput>;

/** Forget a person Radar learned or was told about, by one of their addresses or their name. */
export const RadarPersonRemove = z
  .object({
    address: z.string().trim().toLowerCase().min(1).max(320).optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => Boolean(value.address || value.name), "Name the person to forget");

export const RadarRuleChange = z
  .object({ add: RadarRuleInput.optional(), removeId: z.string().min(1).max(100).optional() })
  .refine((value) => Boolean(value.add) !== Boolean(value.removeId), "Add or remove one rule");

/* --------------------------------- status -------------------------------- */

export const RadarTodaySchema = z.object({
  seen: z.number().int().nonnegative(),
  interrupted: z.number().int().nonnegative(),
  briefed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
});
export type RadarToday = z.infer<typeof RadarTodaySchema>;

export const RadarStatusSchema = z.object({
  settings: RadarSettingsSchema,
  sources: z.array(RadarSourceStatusSchema),
  today: RadarTodaySchema,
  lastCycleAt: IsoDate.optional(),
  nextCycleAt: IsoDate.optional(),
  lastBriefAt: IsoDate.optional(),
  /** The message that carried the latest brief. */
  lastBriefMessageId: Id.optional(),
  nextBriefAt: IsoDate.optional(),
  error: z.string().optional(),
  /** Short synthesized description of the owner Radar works from. */
  summary: z.string().optional(),
  rules: z.array(RadarRuleSchema),
  people: z.array(RadarPersonSchema),
});
export type RadarStatus = z.infer<typeof RadarStatusSchema>;
