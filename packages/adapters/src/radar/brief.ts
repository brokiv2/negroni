import type { MessageBlock, RadarSettings } from "@rakazo/contracts";
import { MAX_BRIEF_AGENDA } from "@rakazo/contracts";
import { appendEventInTransaction, createThreadMessageInTransaction } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { localDate, localMinutes, localWhen, nextLocalDate, zonedInstant } from "./clock.js";
import type { RadarDeliveryDeps } from "./deliver.js";
import { blockActor, PRESENCE_WINDOW_MS, sendPush } from "./deliver.js";
import type { AgendaEvent } from "./observers/types.js";
import { RADAR_LEVELS } from "./policy.js";
import type { RadarOwner } from "./profile.js";
import { radarOwner } from "./profile.js";
import { radarPushExpiry } from "./schedule.js";
import { plainDashes } from "./text.js";

export type BriefPeriod = "morning" | "evening" | "now";
type BriefItem = Extract<MessageBlock, { kind: "brief" }>["items"][number];
type BriefAgenda = NonNullable<Extract<MessageBlock, { kind: "brief" }>["agenda"]>[number];

const PRIMARY_CAP = 7;
const NEEDS_YOU_CAP = 3;
const CALENDAR = ["invite", "event_changed", "event_cancelled", "prep"];
/**
 * An opening greeting adds nothing to a brief and would become the push text. Only the greeting,
 * at most a two-word name and the end of the sentence go: "Hello again, the budget is due." stays.
 */
const GREETING =
  /^(?:good (?:morning|afternoon|evening)|hi|hello|hey|доброе утро|добрый (?:день|вечер)|привет|guten (?:morgen|tag|abend)|bonjour|bonsoir|buenos días|buenas (?:tardes|noches))(?=[\s,.!?])(?:[\s,]+[\p{L}'’-]+){0,2}[.!?]+\s+/iu;
export const withoutGreeting = (text: string) => text.replace(GREETING, "").trim();

const WEEKDAY = `(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|понедельник|вторник|сред[ауыеой]|четверг|пятниц[ауыеой]|суббот[ауыеой]|воскресень[еяю]|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|miércoles|jueves|viernes|sábado|domingo)`;
const DAY_PART = `(?:morning|afternoon|evening|night|утро|утром|день|днём|вечер|вечером|ночь|ночью|vormittag|nachmittag|abend|matin|après-midi|soir|mañana|tarde|noche)`;
const TODAY_IS = `(?:today is|it(?:'|’)?s|it is|today|now|сегодня|сейчас|на часах|heute ist|heute|jetzt|aujourd(?:'|’)hui(?: c(?:'|’)est)?|hoy es|hoy|ahora)`;
/** "Sunday" or "Sunday morning". */
const DAY = `${WEEKDAY}(?:\\s+${DAY_PART})?`;
const SEPARATOR = String.raw`[\s,;:-]`;
/** "Today is Sunday, 10:29," and its translations: the weekday and the clock time as an opener. */
const CLOCK_OPENER = new RegExp(
  String.raw`^(?:${TODAY_IS}\s+)?(?:${DAY}${SEPARATOR}+)?(?<hour>\d{1,2})[:.](?<minute>\d{2})(?:${SEPARATOR}+(?:(?:в|on|am|le|el)\s+)?${DAY})?\s*[,;.!?:-]+\s*`,
  "iu",
);
/** "Today is Sunday." (or "Today is Sunday - ...") as an opener of its own. */
const DAY_OPENER = new RegExp(String.raw`^${TODAY_IS}\s+${DAY}(?:\s*[.!:]+|\s+-)\s*`, "iu");
const CONJUNCTION = /^(?:and|but|so|и|а|но|und|aber|et|mais|y|pero)\s+/iu;

/**
 * A brief does not open with the weekday or the time it is being written at: the agenda already
 * carries times, and the owner knows what day it is. Only an opener that is exactly that (the
 * weekday, or the current clock time) is dropped, so "11:00, standup" is never touched.
 */
export function withoutTimeOpener(text: string, clock: { hour: number; minute: number }): string {
  const found = CLOCK_OPENER.exec(text);
  const match =
    found &&
    Number(found.groups?.hour) === clock.hour &&
    Number(found.groups?.minute) === clock.minute
      ? found
      : DAY_OPENER.exec(text);
  if (!match) return text;
  const rest = text.slice(match[0].length).replace(CONJUNCTION, "");
  return rest.charAt(0).toLocaleUpperCase() + rest.slice(1);
}

/** What the narrator wrote, cleaned the same way every time. */
export const briefNarrative = (text: string, clock: { hour: number; minute: number }) =>
  withoutTimeOpener(withoutGreeting(plainDashes(text.trim())), clock);

const short = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

export type BriefNarration = {
  period: BriefPeriod;
  localTime: string;
  items: Array<{ section: string; title: string; why?: string; offer?: string; deadline?: string }>;
  agenda: Array<{ title: string; start: string }>;
  more: number;
  quiet: { skipped: number; borderline: number };
};

/** The day's events a brief lists: the rest of today, or tomorrow for the evening wrap. */
export function briefAgenda(
  agenda: AgendaEvent[],
  period: BriefPeriod,
  timeZone: string,
  now: Date,
): BriefAgenda[] {
  const today = localDate(now, timeZone);
  const day = period === "evening" ? nextLocalDate(today) : today;
  const iso = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? zonedInstant(value, "00:00", timeZone).toISOString()
      : new Date(value).toISOString();
  return agenda
    .filter((event) => {
      const start = Date.parse(event.start);
      const end = Date.parse(event.end ?? event.start);
      if (!Number.isFinite(start)) return false;
      const startsOn = event.allDay ? event.start : localDate(new Date(start), timeZone);
      return (
        startsOn === day && (period === "evening" || !Number.isFinite(end) || end > now.getTime())
      );
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, MAX_BRIEF_AGENDA)
    .flatMap((event) => {
      try {
        return [
          {
            title: short(event.title, 280),
            start: iso(event.start),
            ...(event.end ? { end: iso(event.end) } : {}),
            ...(event.allDay ? { allDay: true } : {}),
            ...(event.location ? { location: short(event.location, 280) } : {}),
          },
        ];
      } catch {
        return [];
      }
    });
}

/**
 * Composes and sends one brief: Needs you, Your day, Held, and a line on what stayed quiet.
 * Exactly one per period and local day (the `RadarBrief` row is the claim); an ad-hoc brief
 * uses its own timestamp and consumes no period.
 */
export async function deliverRadarBrief(
  deps: RadarDeliveryDeps & {
    narrate: (input: BriefNarration) => Promise<{ title?: string; narrative?: string } | null>;
  },
  scope: RadarOwner,
  conversation: { botId: string; threadId: string },
  input: {
    period: BriefPeriod;
    settings: RadarSettings;
    agenda: AgendaEvent[];
    now: Date;
    localTime: string;
    lastBriefAt?: Date;
    presenceAt?: Date | null;
    /** The owner asked for it: answer even when nothing needs them. */
    requested?: boolean;
  },
): Promise<"sent" | "empty" | "exists"> {
  const owner = radarOwner(scope);
  const { prisma } = deps;
  const { now, period, settings } = input;
  const day = localDate(now, settings.timeZone);
  const periodKey = period === "now" ? now.toISOString() : day;
  if (
    period !== "now" &&
    (await prisma.radarBrief.findUnique({
      where: {
        spaceId_userId_period_localDate: { ...owner, period, localDate: periodKey },
      },
    }))
  )
    return "exists";
  const since = input.lastBriefAt ?? new Date(now.getTime() - 86_400_000);
  const open = await prisma.radarSignal.findMany({
    where: {
      ...owner,
      state: "open",
      status: "decided",
      OR: [{ disposition: { in: ["interrupt", "brief"] } }, { feedback: "important" }],
    },
    orderBy: [{ importance: { sort: "desc", nulls: "last" } }, { occurredAt: "desc" }],
    take: 200,
  });
  const held = open.filter((signal) => signal.held && !signal.deliveredAt);
  const heldIds = new Set(held.map((signal) => signal.id));
  const calendar = open.filter(
    (signal) => CALENDAR.includes(signal.kind) && !heldIds.has(signal.id) && !signal.deliveredAt,
  );
  const calendarIds = new Set(calendar.map((signal) => signal.id));
  // Someone else's task or nobody's never sits under "Needs you"; it is counted in "more".
  const ownersTurn = (signal: (typeof open)[number]) =>
    signal.feedback === "important" ||
    !["someone_else", "nobody"].includes(
      String((signal.trace as Record<string, unknown> | null)?.whoMustAct ?? ""),
    );
  const needsYou = open
    .filter(
      (signal) => !heldIds.has(signal.id) && !calendarIds.has(signal.id) && ownersTurn(signal),
    )
    .sort(
      (a, b) =>
        (a.deadline?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.deadline?.getTime() ?? Number.POSITIVE_INFINITY) ||
        (b.importance ?? 0) - (a.importance ?? 0),
    );
  const primary = [
    ...needsYou
      .slice(0, NEEDS_YOU_CAP)
      .map((signal) => ({ signal, section: "needs_you" as const })),
    ...calendar.map((signal) => ({ signal, section: "your_day" as const })),
    ...held.map((signal) => ({ signal, section: "held" as const })),
  ].slice(0, PRIMARY_CAP);
  const chosen = new Set(primary.map((item) => item.signal.id));
  const undelivered = open.filter((signal) => !signal.deliveredAt);
  const more = open.filter(
    (signal) => !chosen.has(signal.id) && (!signal.deliveredAt || signal.feedback === "important"),
  ).length;
  const briefAt = RADAR_LEVELS[settings.level].brief;
  const [skipped, borderline] = await Promise.all([
    prisma.radarSignal.count({
      where: { ...owner, disposition: "silent", createdAt: { gte: since } },
    }),
    prisma.radarSignal.count({
      where: {
        ...owner,
        disposition: "silent",
        createdAt: { gte: since },
        importance: { gte: briefAt - 10 },
      },
    }),
  ]);
  const agenda = briefAgenda(input.agenda, period, settings.timeZone, now);
  if (!input.requested && !primary.length && (period === "evening" || !agenda.length)) {
    if (period !== "now")
      await prisma.radarBrief.createMany({
        data: [{ ...owner, period, localDate: periodKey, signalIds: [] }],
        skipDuplicates: true,
      });
    return "empty";
  }
  const items: BriefItem[] = primary.map(({ signal, section }) => ({
    updateId: signal.id,
    title: short(signal.headline || signal.title, 280),
    ...(signal.why ? { why: short(signal.why, 280) } : {}),
    source: short(signal.source, 64),
    ...(signal.url && /^https?:\/\/\S+$/i.test(signal.url) ? { url: signal.url } : {}),
    ...(signal.action &&
    ["reply", "decide", "attend", "review", "pay", "read", "none"].includes(signal.action)
      ? { action: signal.action as BriefItem["action"] }
      : {}),
    section,
    ...(signal.offer ? { offer: short(signal.offer, 80) } : {}),
    ...(blockActor(signal.actor) ? { actor: blockActor(signal.actor) } : {}),
  }));
  const narration = await deps
    .narrate({
      period,
      localTime: input.localTime,
      items: primary.map(({ signal, section }) => ({
        section,
        title: signal.headline || signal.title,
        ...(signal.why ? { why: signal.why } : {}),
        ...(signal.offer ? { offer: signal.offer } : {}),
        ...(signal.deadline
          ? { deadline: localWhen(signal.deadline, settings.timeZone, now) }
          : {}),
      })),
      // Local labels: models misconvert UTC timestamps.
      agenda: agenda.map((event) => ({
        title: event.title,
        start: localWhen(event.start, settings.timeZone, now, event.allDay),
      })),
      more,
      quiet: { skipped, borderline },
    })
    .catch(() => null);
  const fallbackTitle =
    period === "morning" ? "Morning brief" : period === "evening" ? "Evening wrap" : "Brief";
  const title = short(plainDashes(narration?.title?.trim() ?? "") || fallbackTitle, 280);
  const minutes = localMinutes(now, settings.timeZone);
  const narrative =
    briefNarrative(narration?.narrative ?? "", {
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
    }) ||
    [...items.map((item) => item.title), ...agenda.map((event) => event.title)].join(" · ") ||
    "Nothing needs you right now.";
  const summary = short(narrative.split(/(?<=[.!?])\s/)[0] || title, 280);
  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.radarBrief.createMany({
      data: [{ ...owner, period, localDate: periodKey, signalIds: [] }],
      skipDuplicates: true,
    });
    if (!claimed.count) return null;
    const brief = await tx.radarBrief.findUniqueOrThrow({
      where: { spaceId_userId_period_localDate: { ...owner, period, localDate: periodKey } },
    });
    const block: Extract<MessageBlock, { kind: "brief" }> = {
      kind: "brief",
      summary,
      briefId: brief.id,
      period,
      title,
      items,
      ...(agenda.length ? { agenda } : {}),
      ...(more ? { more } : {}),
      ...(skipped ? { quiet: { skipped, borderline } } : {}),
    };
    const blocks: MessageBlock[] = [{ kind: "text", text: narrative }, block];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: conversation.threadId,
      botId: conversation.botId,
      role: "bot",
      blocks,
      clientNonce: `radar-brief:${brief.id}`,
    });
    const event = await appendEventInTransaction(tx, {
      spaceId: owner.spaceId,
      threadId: conversation.threadId,
      botId: conversation.botId,
      type: "thread.message.created",
      payload: { messageId: message.id, role: "bot", blocks },
    });
    const included = [...primary.map((item) => item.signal), ...undelivered].filter(
      (signal, index, all) =>
        !signal.deliveredAt && all.findIndex((other) => other.id === signal.id) === index,
    );
    for (const signal of included)
      await tx.radarSignal.update({
        where: { id: signal.id },
        data: {
          deliveredAt: now,
          held: false,
          deliverAt: null,
          ...(signal.messageId ? {} : { messageId: message.id }),
        },
      });
    await tx.radarBrief.update({
      where: { id: brief.id },
      data: { messageId: message.id, signalIds: primary.map((item) => item.signal.id) },
    });
    return { message, seq: event.seq };
  });
  if (!outcome) return "exists";
  await deps.events?.notify(conversation.threadId, outcome.seq).catch((error) => {
    getLogger().error("radar brief realtime notification", error);
  });
  const watching =
    input.presenceAt && now.getTime() - input.presenceAt.getTime() < PRESENCE_WINDOW_MS;
  if (deps.notifications && !watching)
    await sendPush(
      deps.notifications,
      {
        kind: "radar",
        threadKind: "personal",
        spaceId: owner.spaceId,
        botId: conversation.botId,
        threadId: conversation.threadId,
        title,
        body: summary,
        category: "RADAR_BRIEF",
        interruptionLevel: "passive",
        priority: 5,
        groupKey: "radar-brief",
        messageId: outcome.message.id,
        expiresAt: radarPushExpiry("brief", now),
      },
      owner,
      "radar-brief",
    );
  getLogger().info("radar brief delivered", { period, items: items.length, agenda: agenda.length });
  return "sent";
}
