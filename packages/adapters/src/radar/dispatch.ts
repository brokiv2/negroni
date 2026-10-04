import { RadarTraceSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { runJsonPass } from "../background-triage.js";
import type { PolicyMoment } from "./assess.js";
import { policyContext, policyMoment, screened } from "./assess.js";
import { localDate, localWhen, startOfLocalDay } from "./clock.js";
import type { RadarCycle } from "./context.js";
import type { DeliverableSignal } from "./deliver.js";
import { deliverInterrupts } from "./deliver.js";
import { observerCall } from "./observe.js";
import { asRecord } from "./observers/envelope.js";
import { radarObserverFor } from "./observers/index.js";
import type { RadarJudgement } from "./policy.js";
import { decide, RADAR_POLICY_VERSION } from "./policy.js";
import { matchRules } from "./prefilter.js";
import { PREP_DAILY_CAP, PREP_INSTRUCTIONS, prepCandidates } from "./prep.js";
import { briefSlots, quietHoursEnd } from "./schedule.js";
import { isRadarPaused } from "./settings.js";
import { plainDashes } from "./text.js";

type SignalRow = Awaited<ReturnType<PrismaClient["radarSignal"]["findFirstOrThrow"]>>;
const HOUR = 3_600_000;

/** The judgement a stored trace carries, to decide a deferred interrupt again. */
function storedJudgement(trace: unknown): RadarJudgement | undefined {
  const parsed = RadarTraceSchema.safeParse(trace);
  if (!parsed.success) return undefined;
  const value = parsed.data;
  if (!value.scores || !value.costOfDelay || !value.verdict || !value.whoMustAct) return undefined;
  return {
    scores: value.scores,
    costOfDelay: value.costOfDelay,
    verdict: value.verdict,
    whoMustAct: value.whoMustAct,
    confidence: value.confidence ?? 0,
  };
}

/**
 * Right before an interrupt goes out, look at the source again: already handled there,
 * opened, gone, or a newer version that cancels it.
 */
async function reread(
  cycle: RadarCycle,
  signal: SignalRow,
): Promise<"keep" | "opened" | "handled" | "gone"> {
  const { prisma } = cycle.deps;
  if (signal.storyKey) {
    const newer = await prisma.radarSignal.findFirst({
      where: { ...cycle.owner, storyKey: signal.storyKey, occurredAt: { gt: signal.occurredAt } },
      orderBy: { occurredAt: "desc" },
      select: { kind: true },
    });
    if (newer?.kind === "event_cancelled") return "gone";
    if (newer?.kind === "email_sent") return "handled";
  }
  const observer = radarObserverFor(signal.source);
  if (!observer?.reread || !signal.threadKey) return "keep";
  const connection = await prisma.connection.findFirst({
    where: { ...cycle.owner, id: signal.connectionId, status: "connected" },
  });
  const managed = connection && cycle.deps.registry?.managed(connection.connectorId);
  if (!connection || !managed) return "keep";
  try {
    return await observer.reread({
      call: observerCall(managed, connection, cycle.adapter),
      externalId: signal.externalId,
      threadKey: signal.threadKey,
      occurredAt: signal.occurredAt,
      ownerAddresses: cycle.ownerAddresses,
    });
  } catch {
    // An unreadable source does not hold back what was already decided.
    return "keep";
  }
}

const cardInclude = { connection: { select: { displayName: true, metadata: true } } } as const;
const deliverable = (signal: DeliverableSignal): DeliverableSignal => signal;

/**
 * Delivers what is due: fresh and deferred interrupts (decided again with the current
 * context, then re-read at the source) and snoozes whose time has come.
 */
export async function dispatchDue(cycle: RadarCycle): Promise<void> {
  const { deps, owner, now, settings } = cycle;
  const prisma = deps.prisma;
  const paused = isRadarPaused(settings, now);
  const returning = await prisma.radarSignal.findMany({
    where: { ...owner, state: "snoozed", snoozedUntil: { lte: now } },
    include: cardInclude,
    take: 50,
  });
  const batch: Array<{ signal: DeliverableSignal; key: string }> = [];
  for (const signal of returning) {
    if (signal.disposition === "interrupt" && !paused)
      batch.push({
        signal: deliverable(signal),
        key: `return:${signal.snoozedUntil?.toISOString()}:${signal.id}`,
      });
    // Anything else comes back in the next brief.
    else
      await prisma.radarSignal.update({
        where: { id: signal.id },
        data: {
          state: "open",
          snoozedUntil: null,
          deliveredAt: null,
          held: signal.disposition === "interrupt",
        },
      });
  }
  const due = await prisma.radarSignal.findMany({
    where: {
      ...owner,
      status: "decided",
      disposition: "interrupt",
      state: "open",
      deliveredAt: null,
      OR: [{ deliverAt: null }, { deliverAt: { lte: now } }],
    },
    orderBy: [{ importance: { sort: "desc", nulls: "last" } }],
    include: cardInclude,
    take: 20,
  });
  let moment: PolicyMoment | undefined;
  const planned = { interrupts: 0, stories: new Set<string>() };
  const sent = await prisma.radarBrief.findMany({
    where: { ...owner, localDate: localDate(now, settings.timeZone) },
    select: { period: true },
  });
  const briefSoon = briefSlots(settings, localDate(now, settings.timeZone)).some(
    (slot) =>
      !sent.some((row) => row.period === slot.period) &&
      slot.at.getTime() <= now.getTime() + HOUR &&
      now.getTime() < slot.until.getTime(),
  );
  for (const signal of due) {
    const judgement = storedJudgement(signal.trace);
    if (signal.deliverAt && judgement) {
      moment ??= await policyMoment(cycle);
      const hits = matchRules(cycle.learned.rules, screened(signal));
      const decision = decide(judgement, policyContext(moment, signal, hits, planned));
      const heldByQuiet = asRecord(signal.trace).gates;
      const wasQuiet = Array.isArray(heldByQuiet) && heldByQuiet.includes("quiet_hours");
      const fold =
        decision.disposition === "interrupt" && !decision.deliverAt && wasQuiet && briefSoon;
      if (decision.disposition !== "interrupt" || decision.deliverAt || fold) {
        // Still held, now a brief item, or folded into the brief that is about to go out.
        await prisma.radarSignal.update({
          where: { id: signal.id },
          data: {
            disposition: fold ? "brief" : decision.disposition,
            held: fold || decision.held,
            deliverAt: fold ? null : (decision.deliverAt ?? null),
            reason: fold ? "Held for your morning brief." : decision.reason || null,
            trace: {
              ...asRecord(signal.trace),
              gates: [...decision.gates, ...(fold ? ["folded_into_brief"] : [])],
              result: fold ? "brief" : decision.disposition,
              policyVersion: RADAR_POLICY_VERSION,
            },
          },
        });
        continue;
      }
    }
    const outcome = await reread(cycle, signal);
    if (outcome === "handled" || outcome === "gone") {
      await prisma.radarSignal.update({
        where: { id: signal.id },
        data: {
          state: outcome === "handled" ? "done" : "expired",
          reason: outcome === "handled" ? "You already handled this." : "No longer in the source.",
          trace: {
            ...asRecord(signal.trace),
            gates: [
              ...((asRecord(signal.trace).gates as string[] | undefined) ?? []),
              "handled_in_source",
            ],
          },
        },
      });
      continue;
    }
    if (outcome === "opened") {
      await prisma.radarSignal.update({
        where: { id: signal.id },
        data: {
          disposition: "brief",
          deliverAt: null,
          held: false,
          reason: "You already opened it.",
          trace: {
            ...asRecord(signal.trace),
            gates: [
              ...((asRecord(signal.trace).gates as string[] | undefined) ?? []),
              "seen_in_source",
            ],
            result: "brief",
          },
        },
      });
      continue;
    }
    planned.interrupts += 1;
    if (signal.storyKey) planned.stories.add(signal.storyKey);
    batch.push({ signal: deliverable(signal), key: `interrupt:${signal.id}` });
  }
  if (batch.length) await deliverInterrupts(deps, owner, cycle.conversation, batch, now);
}

/**
 * Twenty to fifteen minutes before a meeting that involves someone who matters, someone
 * outside, or an important story: one short prep, only when there is something concrete.
 */
export async function prepareMeetings(cycle: RadarCycle): Promise<void> {
  const { deps, owner, now, settings, learned } = cycle;
  const prisma = deps.prisma;
  if (!settings.meetingPrep || isRadarPaused(settings, now) || quietHoursEnd(settings, now)) return;
  const dayStart = startOfLocalDay(now, settings.timeZone);
  const prepared = await prisma.radarSignal.count({
    where: { ...owner, kind: "prep", deliveredAt: { gte: dayStart } },
  });
  if (prepared >= PREP_DAILY_CAP) return;
  const stories = await prisma.radarSignal.findMany({
    where: {
      ...owner,
      storyKey: { in: cycle.agenda.map((event) => `gcal:${event.id}`) },
      importance: { gte: 60 },
    },
    select: { storyKey: true },
  });
  const candidates = prepCandidates(cycle.agenda, {
    now,
    people: learned.people,
    ownerDomains: [...new Set(cycle.ownerAddresses.map((address) => address.split("@")[1] ?? ""))],
    importantStories: new Set(stories.map((row) => row.storyKey ?? "")),
  }).slice(0, PREP_DAILY_CAP - prepared);
  for (const event of candidates) {
    const externalId = `prep:${event.id}:${event.start}`;
    if (await prisma.radarSignal.findFirst({ where: { ...owner, externalId } })) continue;
    if (!cycle.spendPass()) return;
    const [mail, notes, open] = await Promise.all([
      prisma.radarSignal.findMany({
        where: {
          ...owner,
          kind: { in: ["email", "message", "comment"] },
          occurredAt: { gte: new Date(now.getTime() - 30 * 24 * HOUR) },
          OR: event.attendees
            .slice(0, 20)
            .map((address) => ({ actor: { path: ["address"], equals: address } })),
        },
        orderBy: { occurredAt: "desc" },
        take: 8,
        select: { title: true, excerpt: true, occurredAt: true, actor: true },
      }),
      prisma.radarSignal.findMany({
        where: {
          ...owner,
          kind: "meeting_notes",
          occurredAt: { gte: new Date(now.getTime() - 30 * 24 * HOUR) },
        },
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: { title: true, excerpt: true, occurredAt: true },
      }),
      prisma.radarSignal.findMany({
        where: {
          ...owner,
          state: "open",
          status: "decided",
          disposition: { in: ["interrupt", "brief"] },
        },
        orderBy: { importance: { sort: "desc", nulls: "last" } },
        take: 5,
        select: { headline: true, title: true, why: true },
      }),
    ]);
    const data = (value: unknown) =>
      JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
    // Local labels: models misconvert UTC timestamps.
    const when = (at: Date | string) => localWhen(at, settings.timeZone, now);
    const answer = await runJsonPass({
      runtime: deps.runtime,
      request: cycle.request,
      suffix: "prep",
      model: await cycle.models.conversation(),
      instructions: PREP_INSTRUCTIONS.replace("LANGUAGE", cycle.language),
      prompt: [
        `<meeting>${data({ title: event.title, start: when(event.start), ...(event.end ? { end: when(event.end) } : {}), attendees: event.attendees, location: event.location })}</meeting>`,
        `<notes>${data(notes.map((row) => ({ title: row.title, at: when(row.occurredAt), excerpt: row.excerpt.slice(0, 800) })))}</notes>`,
        `<mail>${data(mail.map((row) => ({ title: row.title, at: when(row.occurredAt), from: asRecord(row.actor).address, excerpt: row.excerpt.slice(0, 600) })))}</mail>`,
        `<open>${data(open.map((row) => ({ title: row.headline || row.title, why: row.why })))}</open>`,
      ].join("\n"),
      context: cycle.adapter,
      onUsage: cycle.usage,
      timeoutMs: 90_000,
    }).catch(() => null);
    const points = Array.isArray(answer?.points)
      ? (answer.points as unknown[])
          .filter((point): point is string => typeof point === "string" && point.trim().length > 0)
          .map(plainDashes)
          .slice(0, 5)
      : [];
    // Everything the model writes for the owner is free of long dashes.
    const text = (value: unknown, max: number) =>
      typeof value === "string" ? plainDashes(value).replace(/\s+/g, " ").trim().slice(0, max) : "";
    if (answer?.useful !== true || points.length < 2 || !text(answer.title, 60)) {
      // Record the look so the same meeting is not prepared twice.
      await prisma.radarSignal.createMany({
        data: [
          {
            ...owner,
            connectionId: event.connectionId,
            source: "googlecalendar",
            externalId,
            threadKey: event.id,
            storyKey: `gcal:${event.id}`,
            kind: "prep",
            occurredAt: now,
            createdAt: now,
            title: event.title.slice(0, 300),
            contentHash: "none",
            status: "decided",
            disposition: "silent",
            reason: "Nothing concrete to bring.",
            trace: {
              gates: ["meeting_prep"],
              result: "silent",
              policyVersion: RADAR_POLICY_VERSION,
            },
          },
        ],
        skipDuplicates: true,
      });
      continue;
    }
    const start = new Date(event.start);
    const created = await prisma.radarSignal.create({
      data: {
        ...owner,
        connectionId: event.connectionId,
        source: "googlecalendar",
        externalId,
        threadKey: event.id,
        storyKey: `gcal:${event.id}`,
        kind: "prep",
        occurredAt: now,
        createdAt: now,
        direct: true,
        title: event.title.slice(0, 300),
        excerpt: points
          .map((point) => `• ${point.slice(0, 300)}`)
          .join("\n")
          .slice(0, 2000),
        ...(event.url ? { url: event.url } : {}),
        ...(Number.isFinite(start.getTime()) ? { deadline: start } : {}),
        meta: { lead: text(answer.lead, 160) || text(answer.title, 60) },
        contentHash: "prep",
        status: "decided",
        importance: 70,
        urgency: "now",
        action: "review",
        headline: text(answer.title, 60),
        why: text(answer.why, 240) || null,
        offer: text(answer.offer, 80) || null,
        disposition: "interrupt",
        reason: null,
        trace: {
          gates: ["meeting_prep"],
          result: "interrupt",
          policyVersion: RADAR_POLICY_VERSION,
        },
      },
      include: cardInclude,
    });
    await deliverInterrupts(
      deps,
      owner,
      cycle.conversation,
      [{ signal: created, key: `prep:${created.id}` }],
      now,
    );
    getLogger().info("radar meeting prep delivered");
  }
}
