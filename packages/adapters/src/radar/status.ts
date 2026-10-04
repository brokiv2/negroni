import type { RadarStatus } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { localDate, nextLocalDate, startOfLocalDay } from "./clock.js";
import { parseLearned } from "./learned.js";
import type { RadarOwner } from "./profile.js";
import { radarOwner, readRadarSettings } from "./profile.js";
import { nextBriefAt } from "./schedule.js";
import { isRadarPaused } from "./settings.js";
import type { RadarRegistry } from "./sources.js";
import { radarSourceStatuses } from "./sources.js";

/**
 * What Radar watches and what it did today. Reading never creates the profile: an owner
 * who has not touched Radar sees the defaults and their accounts.
 */
export async function getRadarStatus(
  prisma: PrismaClient,
  registry: RadarRegistry,
  scope: RadarOwner,
  now = new Date(),
): Promise<RadarStatus> {
  const key = radarOwner(scope);
  const row = await prisma.radarProfile.findUnique({ where: { spaceId_userId: key } });
  const settings = readRadarSettings(row?.settings);
  const learned = parseLearned(row?.learned);
  const dayStart = startOfLocalDay(now, settings.timeZone);
  const today = localDate(now, settings.timeZone);
  const signals = prisma.radarSignal;
  const [sources, seen, interrupted, briefed, skipped, deferred, lastBrief, briefs] =
    await Promise.all([
      radarSourceStatuses(prisma, registry, key, settings.timeZone, now),
      signals.count({ where: { ...key, createdAt: { gte: dayStart } } }),
      signals.count({
        where: { ...key, disposition: "interrupt", deliveredAt: { gte: dayStart } },
      }),
      signals.count({ where: { ...key, disposition: "brief", createdAt: { gte: dayStart } } }),
      signals.count({ where: { ...key, disposition: "silent", createdAt: { gte: dayStart } } }),
      // Interrupts held back by a meeting or the spacing between interrupts.
      signals.count({
        where: {
          ...key,
          disposition: "interrupt",
          state: "open",
          deliveredAt: null,
          deliverAt: { gt: now },
        },
      }),
      prisma.radarBrief.findFirst({
        where: key,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.radarBrief.findMany({
        where: { ...key, localDate: { in: [today, nextLocalDate(today)] } },
        select: { period: true, localDate: true },
      }),
    ]);
  const sent = new Set(briefs.map((brief) => `${brief.period}:${brief.localDate}`));
  const scheduled = settings.enabled
    ? nextBriefAt(settings, (slot) => sent.has(`${slot.period}:${slot.localDate}`), now)
    : null;
  const requested = settings.enabled ? (row?.briefRequestedAt ?? null) : null;
  const nextBrief = [scheduled, requested]
    .filter((at): at is Date => at !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    // A pause that has run out reads as running.
    settings: {
      ...settings,
      pausedUntil: isRadarPaused(settings, now) ? settings.pausedUntil : null,
    },
    sources,
    today: { seen, interrupted, briefed, skipped, deferred },
    lastCycleAt: row?.lastCycleAt?.toISOString(),
    nextCycleAt: settings.enabled ? row?.nextCycleAt?.toISOString() : undefined,
    lastBriefAt: lastBrief?.createdAt.toISOString(),
    nextBriefAt: nextBrief?.toISOString(),
    error: row?.error || undefined,
    summary: row?.summary || undefined,
    rules: learned.rules,
    people: learned.people,
  };
}
