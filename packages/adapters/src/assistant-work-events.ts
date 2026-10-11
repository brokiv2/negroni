import { createHash } from "node:crypto";
import type { AssistantWorkEventWatch } from "@rakazo/contracts";
import { AssistantWorkEventWatches, isRadarSource } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";

type Owner = { spaceId: string; userId: string };
type Signal = {
  connectionId: string;
  externalId: string;
  threadKey: string;
  kind: string;
  actor: unknown;
  title: string;
  excerpt: string;
};

export function workEventWatches(value: unknown): AssistantWorkEventWatch[] {
  const parsed = AssistantWorkEventWatches.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function workWatchesEqual(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown) =>
    workEventWatches(value)
      .map((w) => JSON.stringify(w))
      .sort();
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function workWatchMatches(watch: AssistantWorkEventWatch, signal: Signal): boolean {
  const actor = signal.actor as { address?: unknown } | null;
  return (
    watch.connectionId === signal.connectionId &&
    (!watch.threadKey || watch.threadKey === signal.threadKey) &&
    (!watch.externalId || watch.externalId === signal.externalId) &&
    (!watch.kind || watch.kind === signal.kind) &&
    (!watch.actorAddress ||
      (typeof actor?.address === "string" && actor.address.toLowerCase() === watch.actorAddress)) &&
    (!watch.textIncludes ||
      `${signal.title}\n${signal.excerpt}`.toLowerCase().includes(watch.textIncludes.toLowerCase()))
  );
}

export async function validateWorkEventWatches(
  tx: Prisma.TransactionClient,
  owner: Owner,
  watches: AssistantWorkEventWatch[],
) {
  if (!watches.length) return;
  const ids = [...new Set(watches.map((watch) => watch.connectionId))];
  const connections = await tx.connection.findMany({
    where: { spaceId: owner.spaceId, userId: owner.userId, id: { in: ids }, status: "connected" },
    select: { id: true, provider: true },
  });
  if (connections.length !== ids.length || connections.some((c) => !isRadarSource(c.provider))) {
    throw new Error("Event watches require an owned, connected account supported by Radar.");
  }
}

/** Reconciliation reads committed observations, so an observer crash cannot lose a wake. */
export async function reconcileAssistantWorkEvents(prisma: PrismaClient, now = new Date()) {
  const works = await prisma.assistantWork.findMany({
    where: {
      status: { in: ["waiting", "active"] },
      deadline: { gt: now },
      watchSince: { not: null },
    },
    orderBy: [{ watchScannedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: 100,
  });
  for (const candidate of works) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${candidate.threadId} FOR UPDATE`;
      const work = await tx.assistantWork.findUnique({ where: { id: candidate.id } });
      if (
        !work ||
        !["waiting", "active"].includes(work.status) ||
        !work.watchSince ||
        work.deadline <= now
      )
        return;
      // Advance every checked work, including quiet accounts, so a bounded batch stays fair.
      await tx.assistantWork.update({
        where: { id: work.id },
        data: { watchScannedAt: now, updatedAt: work.updatedAt },
      });
      const watches = workEventWatches(work.eventWatches);
      if (!watches.length) return;
      const owner = { spaceId: work.spaceId, userId: work.userId };
      if (!(await tx.spaceMember.findFirst({ where: owner }))) return;
      const connections = await tx.connection.findMany({
        where: { ...owner, id: { in: watches.map((w) => w.connectionId) }, status: "connected" },
        select: { id: true },
      });
      const available = new Set(connections.map((c) => c.id));
      const usable = watches.filter((w) => available.has(w.connectionId));
      if (!usable.length) return;
      const pending = await tx.assistantWorkEvent.count({
        where: {
          workId: work.id,
          workVersion: work.version,
          watchGeneration: work.watchGeneration,
          consumedAt: null,
        },
      });
      const signals =
        pending >= 100
          ? []
          : await tx.radarSignal.findMany({
              where: {
                ...owner,
                observedAt: { gte: work.watchSince },
                status: { not: "superseded" },
                workEvents: { none: { workId: work.id } },
                OR: usable.map((watch) => ({
                  connectionId: watch.connectionId,
                  ...(watch.threadKey ? { threadKey: watch.threadKey } : {}),
                  ...(watch.externalId ? { externalId: watch.externalId } : {}),
                  ...(watch.kind ? { kind: watch.kind } : {}),
                })),
              },
              orderBy: [{ observedAt: "asc" }, { id: "asc" }],
              take: 100 - pending,
            });
      for (const signal of signals) {
        // Record non-matches too: an unchanged observation must not starve later matches.
        const matched = usable.some((watch) => workWatchMatches(watch, signal));
        const eventKey = createHash("sha256")
          .update(JSON.stringify([signal.connectionId, signal.externalId, signal.contentHash]))
          .digest("hex");
        await tx.assistantWorkEvent.upsert({
          where: { workId_eventKey: { workId: work.id, eventKey } },
          update: { signalId: signal.id },
          create: {
            workId: work.id,
            workVersion: work.version,
            watchGeneration: work.watchGeneration,
            signalId: signal.id,
            eventKey,
            consumedAt: matched ? null : now,
            snapshot: matched
              ? {
                  source: signal.source,
                  connectionId: signal.connectionId,
                  externalId: signal.externalId,
                  threadKey: signal.threadKey,
                  kind: signal.kind,
                  actor: signal.actor,
                  title: signal.title.slice(0, 300),
                  excerpt: signal.excerpt.slice(0, 2000),
                  url: signal.url,
                  occurredAt: signal.occurredAt.toISOString(),
                }
              : {},
          },
        });
      }
      if (
        work.status === "waiting" &&
        !work.recoveryAt &&
        (await tx.assistantWorkEvent.count({
          where: {
            workId: work.id,
            workVersion: work.version,
            watchGeneration: work.watchGeneration,
            consumedAt: null,
          },
        }))
      ) {
        await tx.assistantWork.update({
          where: { id: work.id },
          data: { nextWakeAt: now, wakeReason: "A subscribed source event arrived." },
        });
      }
    });
  }
}
