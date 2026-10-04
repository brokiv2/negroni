import type { RadarDisposition, RadarGate, RadarLevel, RadarScores } from "@rakazo/contracts";
import type { RuleHits } from "./prefilter.js";

/**
 * The delivery decision is code, not a model answer (docs/proactive-layer.md, section 4).
 * Bump the version whenever thresholds, weights or gate order change; it is stored in every
 * decision trace.
 */
export const RADAR_POLICY_VERSION = 1;

export const RADAR_LEVELS: Record<RadarLevel, { interrupt: number; brief: number }> = {
  urgent: { interrupt: 80, brief: 50 },
  important: { interrupt: 70, brief: 45 },
  more: { interrupt: 60, brief: 35 },
};

export const RADAR_DIMENSIONS = [
  "addressed",
  "actionRequired",
  "timePressure",
  "stakes",
  "relationship",
  "novelty",
  "linkage",
  "seen",
] as const;

export type CostOfDelay = "none" | "low" | "high" | "critical";
export type RadarJudgement = {
  scores: RadarScores;
  costOfDelay: CostOfDelay;
  verdict: "scored" | "unclear";
  whoMustAct: "owner" | "someone_else" | "nobody" | "unclear";
  confidence: number;
};

/** 0–100. Something already handled in the source keeps 30% of its weight. */
export function radarImportance(scores: RadarScores): number {
  const weighted =
    0.2 * scores.actionRequired +
    0.18 * scores.stakes +
    0.14 * scores.addressed +
    0.14 * scores.linkage +
    0.12 * scores.relationship +
    0.12 * scores.novelty +
    0.1 * scores.timePressure;
  return Math.round(((100 * weighted) / 3) * (scores.seen === 0 ? 0.3 : 1));
}

/** The update view's urgency, from the judged time pressure and cost of delay. */
export function radarUrgency(judgement: RadarJudgement): "now" | "today" | "week" | "none" {
  if (
    judgement.costOfDelay === "critical" ||
    (judgement.costOfDelay === "high" && judgement.scores.timePressure === 3)
  )
    return "now";
  if (judgement.scores.timePressure >= 2) return "today";
  return judgement.scores.timePressure === 1 ? "week" : "none";
}

export type PolicyContext = {
  now: Date;
  level: RadarLevel;
  dailyCap: number;
  /** The owner's learned shift, [−8, +10]. */
  ownerOffset: number;
  /** This sender's learned shift, [−10, +10]. */
  senderShift: number;
  rules: RuleHits;
  paused: boolean;
  /** Set while quiet hours last: when they end. */
  quietUntil?: Date;
  /** Set while a meeting is in progress: when it ends. */
  meetingUntil?: Date;
  interruptsToday: number;
  lastInterruptAt?: Date;
  /** An interrupt about the same story in the last 24 hours. */
  storyInterrupt?: { critical: boolean };
};

export type PolicyDecision = {
  disposition: RadarDisposition;
  /** A deferred interrupt goes out (after a fresh decision) no earlier than this. */
  deliverAt?: Date;
  /** Postponed by pause, quiet hours, a meeting or the budget. */
  held: boolean;
  critical: boolean;
  /** Owner-readable reason for anything but an immediate interrupt. */
  reason: string;
  gates: RadarGate[];
  thresholds: { interrupt: number; brief: number };
  /** Total shift applied to the interrupt threshold. */
  offset: number;
  importance: number;
};

const SPACING_MS = 30 * 60_000;
const AFTER_MEETING_MS = 2 * 60_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function decide(judgement: RadarJudgement, context: PolicyContext): PolicyDecision {
  const importance = radarImportance(judgement.scores);
  const base = RADAR_LEVELS[context.level];
  const offset = clamp(context.ownerOffset, -8, 10) + clamp(context.senderShift, -10, 10);
  const thresholds = { interrupt: clamp(base.interrupt + offset, 0, 100), brief: base.brief };
  const gates: RadarGate[] = [];
  const result = (
    disposition: RadarDisposition,
    reason: string,
    extra: Partial<Pick<PolicyDecision, "deliverAt" | "held" | "critical">> = {},
  ): PolicyDecision => ({
    disposition,
    reason,
    gates,
    thresholds,
    offset,
    importance,
    held: extra.held ?? false,
    critical: extra.critical ?? false,
    ...(extra.deliverAt ? { deliverAt: extra.deliverAt } : {}),
  });

  // 1. Explicit rules: never, then digest, then always.
  if (context.rules.never.length) {
    gates.push("rule_never");
    return result("silent", "Muted by your rule.");
  }
  let briefOnly = false;
  if (context.rules.digest.length) {
    gates.push("rule_digest");
    briefOnly = true;
  }
  const always = !briefOnly && context.rules.always.length > 0;
  if (always) gates.push("rule_always");
  // 2. Someone else's task, or unclear who must act.
  if (judgement.verdict === "unclear") {
    gates.push("unclear");
    briefOnly = true;
  } else if (judgement.whoMustAct !== "owner") {
    gates.push("not_owner");
    briefOnly = true;
  }
  // 3. Scores.
  const pressing =
    importance >= thresholds.interrupt &&
    (judgement.costOfDelay === "high" || judgement.costOfDelay === "critical");
  const sure = judgement.confidence >= 0.85;
  const unseen = judgement.scores.seen >= 2;
  const worthInterrupt = always || (pressing && sure && unseen);
  const worthBrief = importance >= thresholds.brief || judgement.scores.actionRequired >= 2;
  if (!worthInterrupt && !worthBrief) {
    gates.push("below_threshold");
    return result("silent", "Below your threshold.");
  }
  if (!worthInterrupt || briefOnly) {
    if (!worthInterrupt && pressing) gates.push(sure ? "already_seen" : "low_confidence");
    return result(
      "brief",
      briefOnly && worthInterrupt
        ? "Kept for your brief by your settings."
        : !worthInterrupt && pressing
          ? sure
            ? "Kept for your brief: you have seen it."
            : "Kept for your brief: not sure enough to interrupt."
          : "Kept for your brief.",
    );
  }
  // 4. Critical skips quiet hours, meetings and spacing, never the daily cap.
  const critical = judgement.costOfDelay === "critical" && importance >= 85;
  if (critical) gates.push("critical");
  // 5. Pause.
  if (context.paused) {
    gates.push("paused");
    return result("brief", "Held while Radar is paused.", { held: true, critical });
  }
  // 6. Quiet hours.
  if (!critical && context.quietUntil) {
    gates.push("quiet_hours");
    return result("interrupt", "Held for quiet hours.", {
      deliverAt: context.quietUntil,
      held: true,
    });
  }
  // 7. Meetings.
  if (!critical && context.meetingUntil) {
    gates.push("in_meeting");
    return result("interrupt", "Held until your meeting ends.", {
      deliverAt: new Date(context.meetingUntil.getTime() + AFTER_MEETING_MS),
      held: true,
    });
  }
  // 8. Budget: daily cap, one interrupt per story a day, then spacing.
  if (context.interruptsToday >= context.dailyCap) {
    gates.push("daily_cap");
    return result("brief", "Held: today's interrupts are used up.", { held: true, critical });
  }
  if (context.storyInterrupt && !(critical && !context.storyInterrupt.critical)) {
    gates.push("story_limit");
    return result("brief", "Already told you about this today.", { critical });
  }
  if (
    !critical &&
    context.lastInterruptAt &&
    context.now.getTime() - context.lastInterruptAt.getTime() < SPACING_MS
  ) {
    gates.push("spacing");
    return result("interrupt", "Held to keep interrupts apart.", {
      deliverAt: new Date(context.lastInterruptAt.getTime() + SPACING_MS),
      held: true,
    });
  }
  return result("interrupt", "", { critical });
}

/** Within 5 points of the interrupt threshold, or critical from someone barely known. */
export function needsSecondOpinion(judgement: RadarJudgement, decision: PolicyDecision): boolean {
  if (decision.disposition !== "interrupt" || decision.gates.includes("rule_always")) return false;
  return (
    Math.abs(decision.importance - decision.thresholds.interrupt) <= 5 ||
    (judgement.costOfDelay === "critical" && judgement.scores.relationship < 2)
  );
}
