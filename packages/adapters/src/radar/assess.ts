import type { Prisma, PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { localDate, localTimeLabel, localWhen, nextLocalDate, startOfLocalDay } from "./clock.js";
import type { RadarCycle } from "./context.js";
import type { JudgeItem, JudgeResult } from "./judge.js";
import { judgeItems } from "./judge.js";
import { LEARNING_WINDOW_MS, senderOf } from "./learned.js";
import { asRecord } from "./observers/envelope.js";
import type { PolicyContext, PolicyDecision } from "./policy.js";
import {
  decide,
  needsSecondOpinion,
  RADAR_POLICY_VERSION,
  radarImportance,
  radarUrgency,
} from "./policy.js";
import type { RuleHits, ScreenedSignal } from "./prefilter.js";
import { matchRules, prefilter } from "./prefilter.js";
import type { FeedbackEvent } from "./priors.js";
import { backoffUntil, senderShift, thresholdOffset } from "./priors.js";
import { meetingEnd, nextBriefAt, quietHoursEnd } from "./schedule.js";
import { isRadarPaused } from "./settings.js";

type SignalRow = Awaited<ReturnType<PrismaClient["radarSignal"]["findFirstOrThrow"]>>;
const DAY = 86_400_000;
const MAX_ATTEMPTS = 3;
/** A backlog older than this is logged, not judged. */
const STALE_MS = 3 * DAY;
const LABELS: Record<string, string> = {
  important: "tell me sooner",
  not_important: "not important",
  mute_sender: "never about this",
  always_sender: "always tell me",
  done: "handled, useful",
};
const CALENDAR = new Set(["invite", "event_changed", "event_cancelled"]);
const FACT_KEYS = [
  "previous",
  "start",
  "end",
  "response",
  "labels",
  "overdue",
  "priority",
  "channel",
  "resolved",
];

export function screened(signal: SignalRow): ScreenedSignal {
  return {
    source: signal.source,
    kind: signal.kind,
    title: signal.title,
    excerpt: signal.excerpt,
    actor: asRecord(signal.actor),
    meta: asRecord(signal.meta),
    occurredAt: signal.occurredAt,
    deadline: signal.deadline,
  };
}

const ruleIds = (hits: RuleHits) => [...hits.never, ...hits.digest, ...hits.always];

function from(actor: unknown): string | undefined {
  const row = asRecord(actor);
  const name = typeof row.name === "string" ? row.name : "";
  const address = typeof row.address === "string" ? row.address : "";
  return name && address ? `${name} <${address}>` : name || address || undefined;
}

/** Interrupts already delivered: today's count, the latest, and stories told in 24 hours. */
async function interruptHistory(cycle: RadarCycle) {
  const { deps, owner, now, settings } = cycle;
  const rows = await deps.prisma.radarSignal.findMany({
    where: {
      ...owner,
      disposition: "interrupt",
      kind: { not: "prep" },
      deliveredAt: { gte: new Date(now.getTime() - DAY) },
    },
    select: { deliveredAt: true, storyKey: true, trace: true },
  });
  const dayStart = startOfLocalDay(now, settings.timeZone);
  const stories = new Map<string, boolean>();
  for (const row of rows)
    if (row.storyKey) {
      const gates = asRecord(row.trace).gates;
      stories.set(
        row.storyKey,
        (stories.get(row.storyKey) ?? false) ||
          (Array.isArray(gates) && gates.includes("critical")),
      );
    }
  return {
    today: rows.filter((row) => row.deliveredAt && row.deliveredAt >= dayStart).length,
    lastAt: rows.reduce<Date | undefined>(
      (latest, row) =>
        row.deliveredAt && (!latest || row.deliveredAt > latest) ? row.deliveredAt : latest,
      undefined,
    ),
    stories,
  };
}

/** The owner's feedback inside the learning window, newest first, with its sender. */
async function feedbackHistory(cycle: RadarCycle) {
  const rows = await cycle.deps.prisma.radarSignal.findMany({
    where: {
      ...cycle.owner,
      feedback: { not: null },
      feedbackAt: { gte: new Date(cycle.now.getTime() - LEARNING_WINDOW_MS) },
    },
    orderBy: { feedbackAt: "desc" },
    take: 500,
    select: { feedback: true, feedbackAt: true, disposition: true, actor: true },
  });
  return rows.map((row) => ({
    feedback: row.feedback ?? "",
    at: row.feedbackAt ?? cycle.now,
    disposition: row.disposition,
    sender: senderOf(row.actor)?.address,
  }));
}

/** The policy's view of the moment; the same for a fresh decision and a deferred one. */
export async function policyMoment(cycle: RadarCycle) {
  const [history, feedback] = await Promise.all([interruptHistory(cycle), feedbackHistory(cycle)]);
  const { settings, now } = cycle;
  return {
    history,
    feedback,
    base: {
      now,
      level: settings.level,
      dailyCap: settings.maxInterruptsPerDay,
      ownerOffset: thresholdOffset(feedback as FeedbackEvent[], now),
      paused: isRadarPaused(settings, now),
      quietUntil: quietHoursEnd(settings, now),
      meetingUntil: meetingEnd(cycle.agenda, now),
      interruptsToday: history.today,
      lastInterruptAt: history.lastAt,
    } satisfies Omit<PolicyContext, "senderShift" | "rules" | "storyInterrupt">,
  };
}

export type PolicyMoment = Awaited<ReturnType<typeof policyMoment>>;

export function policyContext(
  moment: PolicyMoment,
  signal: Pick<SignalRow, "actor" | "storyKey">,
  rules: RuleHits,
  planned: { interrupts: number; stories: Set<string> },
): PolicyContext {
  const sender = senderOf(signal.actor)?.address;
  const mine = sender ? moment.feedback.filter((event) => event.sender === sender) : [];
  const told = signal.storyKey ? moment.history.stories.get(signal.storyKey) : undefined;
  return {
    ...moment.base,
    senderShift: senderShift({
      important: mine.filter((event) => event.feedback === "important").length,
      notImportant: mine.filter((event) => event.feedback === "not_important").length,
    }),
    rules,
    interruptsToday: moment.base.interruptsToday + planned.interrupts,
    ...(told !== undefined || (signal.storyKey && planned.stories.has(signal.storyKey))
      ? { storyInterrupt: { critical: told ?? false } }
      : {}),
  };
}

export function decisionTrace(
  cycle: RadarCycle,
  result: JudgeResult,
  decision: PolicyDecision,
  rules: RuleHits,
) {
  return {
    level: cycle.settings.level,
    importance: decision.importance,
    urgency: radarUrgency(result),
    confidence: result.confidence,
    scores: result.scores,
    costOfDelay: result.costOfDelay,
    verdict: result.verdict,
    whoMustAct: result.whoMustAct,
    thresholdOffset: decision.offset,
    thresholds: decision.thresholds,
    rules: ruleIds(rules),
    gates: decision.gates,
    result: decision.disposition,
    policyVersion: RADAR_POLICY_VERSION,
  };
}

async function decideSilent(
  prisma: PrismaClient,
  signal: SignalRow,
  reason: string,
  gates: string[],
  rules: RuleHits,
) {
  await prisma.radarSignal.update({
    where: { id: signal.id },
    data: {
      status: "decided",
      disposition: "silent",
      reason,
      trace: {
        gates,
        rules: ruleIds(rules),
        result: "silent",
        policyVersion: RADAR_POLICY_VERSION,
      },
    },
  });
}

/** Acting in the source closes the updates it answers. */
async function closeAnswered(prisma: PrismaClient, cycle: RadarCycle, signal: SignalRow) {
  if (signal.kind === "email_sent" && signal.threadKey)
    await prisma.radarSignal.updateMany({
      where: {
        ...cycle.owner,
        connectionId: signal.connectionId,
        threadKey: signal.threadKey,
        id: { not: signal.id },
        kind: { not: "email_sent" },
        state: { in: ["open", "snoozed"] },
        occurredAt: { lte: signal.occurredAt },
      },
      data: { state: "done", reason: "You replied.", feedback: "done", feedbackAt: cycle.now },
    });
  const response = asRecord(signal.meta).response;
  if (CALENDAR.has(signal.kind) && ["accepted", "declined", "tentative"].includes(String(response)))
    await prisma.radarSignal.updateMany({
      where: {
        ...cycle.owner,
        storyKey: signal.storyKey,
        id: { not: signal.id },
        kind: "invite",
        state: { in: ["open", "snoozed"] },
      },
      data: { state: "done", reason: "You answered the invite." },
    });
}

function examplesFor(
  signal: SignalRow,
  labeled: Array<{
    id: string;
    title: string;
    headline: string | null;
    actor: unknown;
    feedback: string | null;
    storyKey: string | null;
    source: string;
  }>,
) {
  const sender = senderOf(signal.actor)?.address;
  return labeled
    .filter((row) => row.id !== signal.id)
    .map((row) => ({
      row,
      rank:
        (sender && senderOf(row.actor)?.address === sender ? 3 : 0) +
        (signal.storyKey && row.storyKey === signal.storyKey ? 2 : 0) +
        (row.source === signal.source ? 1 : 0),
    }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5)
    .map(({ row }) => ({
      title: row.headline || row.title,
      ...(from(row.actor) ? { from: from(row.actor) } : {}),
      label: LABELS[row.feedback ?? ""] ?? "",
    }));
}

/**
 * Prefilters every pending signal, judges up to the cycle's cap, and records one decision
 * each. Returns how many signals still wait.
 */
export async function assessPending(cycle: RadarCycle): Promise<number> {
  const { deps, owner, now, settings, learned } = cycle;
  const prisma = deps.prisma;
  await prisma.radarSignal.updateMany({
    where: { ...owner, status: "pending", createdAt: { lt: new Date(now.getTime() - STALE_MS) } },
    data: {
      status: "decided",
      disposition: "silent",
      reason: "Too old to judge.",
      trace: { gates: ["stale"], result: "silent", policyVersion: RADAR_POLICY_VERSION },
    },
  });
  const pending = await prisma.radarSignal.findMany({
    where: { ...owner, status: "pending" },
    orderBy: { occurredAt: "asc" },
    take: 200,
  });
  if (!pending.length) return 0;
  const storyKeys = [
    ...new Set(
      pending.map((signal) => signal.storyKey).filter((key): key is string => Boolean(key)),
    ),
  ];
  const [declines, recent] = await Promise.all([
    prisma.radarSignal.findMany({
      where: { ...owner, storyKey: { in: storyKeys }, feedback: "not_important" },
      orderBy: { feedbackAt: "desc" },
      select: { storyKey: true, feedbackAt: true },
    }),
    prisma.radarSignal.findMany({
      where: { ...owner, status: "decided", createdAt: { gte: new Date(now.getTime() - 7 * DAY) } },
      select: { meta: true },
      take: 2000,
    }),
  ]);
  const seen = new Set(
    recent
      .map((row) => asRecord(row.meta).dupKey)
      .filter((key): key is string => typeof key === "string"),
  );
  const toJudge: SignalRow[] = [];
  for (const signal of pending) {
    const view = screened(signal);
    const hits = matchRules(learned.rules, view);
    const dupKey = asRecord(signal.meta).dupKey;
    const verdict = prefilter(view, {
      ownerAddresses: cycle.ownerAddresses,
      rules: hits,
      people: learned.people,
      backoffUntil: backoffUntil(
        declines
          .filter((row) => row.storyKey === signal.storyKey && row.feedbackAt)
          .map((row) => row.feedbackAt as Date),
      ),
      duplicate: typeof dupKey === "string" && seen.has(dupKey),
      now,
    });
    if (typeof dupKey === "string") seen.add(dupKey);
    await closeAnswered(prisma, cycle, signal);
    if (verdict) await decideSilent(prisma, signal, verdict.reason, [verdict.gate], hits);
    else toJudge.push(signal);
  }
  const batch = toJudge.slice(0, deps.judgeCap ?? 25);
  if (!batch.length) return 0;
  // While the model waits out an outage, screening is all that can be done: nothing here is
  // judged, counted as an attempt or dropped, and the signals keep their place in the queue.
  if (cycle.health.holding()) return toJudge.length;

  const today = localDate(now, settings.timeZone);
  const [labeled, stories, briefs] = await Promise.all([
    prisma.radarSignal.findMany({
      where: {
        ...owner,
        feedback: { in: Object.keys(LABELS) },
        feedbackAt: { gte: new Date(now.getTime() - 90 * DAY) },
      },
      orderBy: { feedbackAt: "desc" },
      take: 300,
      select: {
        id: true,
        title: true,
        headline: true,
        actor: true,
        feedback: true,
        storyKey: true,
        source: true,
      },
    }),
    prisma.radarSignal.findMany({
      where: {
        ...owner,
        storyKey: {
          in: [
            ...new Set(
              batch.map((signal) => signal.storyKey).filter((key): key is string => Boolean(key)),
            ),
          ],
        },
        id: { notIn: batch.map((signal) => signal.id) },
        occurredAt: { gte: new Date(now.getTime() - 30 * DAY) },
      },
      orderBy: { occurredAt: "desc" },
      take: 300,
      select: {
        storyKey: true,
        title: true,
        headline: true,
        kind: true,
        occurredAt: true,
        disposition: true,
        reason: true,
      },
    }),
    prisma.radarBrief.findMany({
      where: { ...owner, localDate: { in: [today, nextLocalDate(today)] } },
      select: { period: true, localDate: true },
    }),
  ]);
  const sent = new Set(briefs.map((brief) => `${brief.period}:${brief.localDate}`));
  const nextBrief = nextBriefAt(
    settings,
    (slot) => sent.has(`${slot.period}:${slot.localDate}`),
    now,
  );
  // Times reach the model as local labels; it misconverts UTC timestamps.
  const when = (at: Date | string) => localWhen(at, settings.timeZone, now);
  const items: JudgeItem[] = batch.map((signal) => {
    const meta = asRecord(signal.meta);
    const allDay = meta.allDay === true;
    const local = (value: unknown) =>
      typeof value === "string" ? localWhen(value, settings.timeZone, now, allDay) : value;
    const facts = Object.fromEntries(
      FACT_KEYS.filter((key) => meta[key] !== undefined).map((key) => [
        key,
        key === "start" || key === "end"
          ? local(meta[key])
          : key === "previous"
            ? { ...asRecord(meta[key]), start: local(asRecord(meta[key]).start) }
            : meta[key],
      ]),
    );
    const hits = matchRules(learned.rules, screened(signal));
    const matched = new Set(ruleIds(hits));
    return {
      id: signal.id,
      source: signal.source,
      kind: signal.kind,
      ...(from(signal.actor) ? { from: from(signal.actor) } : {}),
      direct: signal.direct,
      unread: signal.unread,
      occurredAt: when(signal.occurredAt),
      title: signal.title,
      excerpt: signal.excerpt,
      ...(signal.deadline ? { deadline: when(signal.deadline) } : {}),
      facts,
      story: stories
        .filter((row) => row.storyKey === signal.storyKey)
        .slice(0, 5)
        .map((row) => ({
          title: row.headline || row.title,
          kind: row.kind,
          at: when(row.occurredAt),
          ...(row.disposition
            ? { decision: row.reason ? `${row.disposition}: ${row.reason}` : row.disposition }
            : {}),
        })),
      examples: examplesFor(signal, labeled),
      rules: learned.rules
        .filter((rule) => matched.has(rule.id))
        .map((rule) => ({ kind: rule.kind, match: rule.match as Record<string, string> })),
    };
  });
  const judgeContext = {
    now: now.toISOString(),
    localTime: localTimeLabel(now, settings.timeZone),
    timeZone: settings.timeZone,
    ...(nextBrief ? { nextBrief: when(nextBrief) } : {}),
    language: cycle.language,
    owner: {
      ...(cycle.summary ? { summary: cycle.summary } : {}),
      ...(learned.synthesis?.priorities.length ? { priorities: learned.synthesis.priorities } : {}),
      people: learned.people.slice(0, 40).map((person) => ({
        name: person.name,
        ...(person.relation ? { relation: person.relation } : {}),
        weight: person.weight,
      })),
    },
    agenda: cycle.agenda
      .filter((event) => event.start.slice(0, 10) <= nextLocalDate(today))
      .slice(0, 12)
      .map((event) => ({
        title: event.title,
        start: localWhen(event.start, settings.timeZone, now, event.allDay),
        ...(event.end && !event.allDay ? { end: when(event.end) } : {}),
      })),
  };
  let results: Map<string, JudgeResult | null>;
  try {
    results = await judgeItems({
      runtime: deps.runtime,
      model: await cycle.models.background(),
      request: cycle.request,
      context: cycle.adapter,
      judge: judgeContext,
      items,
      batchSize: toJudge.length > 20 ? 5 : 1,
      spendPass: cycle.spendPass,
      onUsage: cycle.usage,
      pass: cycle.pass,
    });
  } catch (error) {
    if (cycle.adapter.signal.aborted) throw error;
    getLogger().warn("radar judge unavailable", {
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    // No usable model at all (for example no credential): wait like for any other outage.
    cycle.health.failed(error);
    return toJudge.length;
  }

  const moment = await policyMoment(cycle);
  const planned = { interrupts: 0, stories: new Set<string>() };
  const answered = batch
    .map((signal) => ({
      signal,
      result: results.get(signal.id),
      item: items.find((item) => item.id === signal.id)!,
    }))
    .filter((entry) => results.has(entry.signal.id));
  for (const { signal } of answered.filter((entry) => entry.result === null)) {
    const attempts = signal.attempts + 1;
    if (attempts >= MAX_ATTEMPTS)
      await prisma.radarSignal.update({
        where: { id: signal.id },
        data: {
          attempts,
          status: "decided",
          disposition: "silent",
          reason: "Could not evaluate.",
          trace: { gates: ["unevaluated"], result: "silent", policyVersion: RADAR_POLICY_VERSION },
        },
      });
    else await prisma.radarSignal.update({ where: { id: signal.id }, data: { attempts } });
  }
  const scored = answered
    .filter((entry): entry is typeof entry & { result: JudgeResult } => Boolean(entry.result))
    .map((entry) => ({ ...entry, hits: matchRules(learned.rules, screened(entry.signal)) }))
    .sort((a, b) => radarImportance(b.result.scores) - radarImportance(a.result.scores));
  for (const { signal, result, item, hits } of scored) {
    const context = policyContext(moment, signal, hits, planned);
    let decision = decide(result, context);
    if (needsSecondOpinion(result, decision)) {
      let agree = false;
      // Whether a second look was had at all: a model that could not give one cannot disagree.
      let looked = false;
      if (cycle.spendPass()) {
        try {
          const asked = await judgeItems({
            runtime: deps.runtime,
            model: await cycle.models.conversation(),
            request: cycle.request,
            context: cycle.adapter,
            judge: judgeContext,
            items: [item],
            batchSize: 1,
            spendPass: () => true,
            onUsage: cycle.usage,
            suffix: "second",
            pass: cycle.pass,
          });
          looked = asked.has(signal.id);
          const second = asked.get(signal.id);
          agree = Boolean(second && decide(second, context).disposition === "interrupt");
        } catch (error) {
          if (cycle.adapter.signal.aborted) throw error;
        }
      }
      if (!agree)
        decision = {
          ...decision,
          disposition: "brief",
          held: false,
          reason: looked
            ? "Kept for your brief: a second look disagreed."
            : "Kept for your brief: no second look was available.",
          gates: [...decision.gates, "second_opinion"],
        };
      decision = {
        ...decision,
        ...(decision.disposition === "brief" ? { deliverAt: undefined } : {}),
      };
    }
    if (decision.disposition === "interrupt" && !decision.deliverAt) {
      planned.interrupts += 1;
      if (signal.storyKey) planned.stories.add(signal.storyKey);
    }
    await saveDecision(prisma, cycle, signal, result, decision, hits);
  }
  // What failed but will be tried again still counts as waiting; what was given up does not.
  const givenUp = answered.filter(
    (entry) => entry.result === null && entry.signal.attempts + 1 >= MAX_ATTEMPTS,
  ).length;
  return Math.max(0, toJudge.length - scored.length - givenUp);
}

async function saveDecision(
  prisma: PrismaClient,
  cycle: RadarCycle,
  signal: SignalRow,
  result: JudgeResult,
  decision: PolicyDecision,
  hits: RuleHits,
) {
  const meta = asRecord(signal.meta);
  await prisma.$transaction(async (tx) => {
    await tx.radarSignal.update({
      where: { id: signal.id },
      data: {
        status: "decided",
        importance: decision.importance,
        urgency: radarUrgency(result),
        action: result.action,
        headline: result.title,
        why: result.why,
        offer: result.offer ?? null,
        evidence: result.evidence ?? null,
        confidence: result.confidence,
        disposition: decision.disposition,
        reason: decision.reason || null,
        held: decision.held,
        deliverAt: decision.deliverAt ?? null,
        trace: decisionTrace(cycle, result, decision, hits),
        meta: { ...meta, ...(result.lead ? { lead: result.lead } : {}) } as Prisma.InputJsonValue,
      },
    });
    // One story keeps one open update: a newer version that matters replaces the older one.
    if (decision.disposition !== "silent" && signal.storyKey)
      await tx.radarSignal.updateMany({
        where: {
          ...cycle.owner,
          storyKey: signal.storyKey,
          id: { not: signal.id },
          status: "decided",
          state: "open",
          occurredAt: { lte: signal.occurredAt },
        },
        data: { state: "expired", reason: "Updated." },
      });
  });
}
