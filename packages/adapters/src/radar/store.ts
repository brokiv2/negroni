import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { localDate } from "./clock.js";
import type { ObservedSignal, ObserveResult } from "./observers/types.js";
import type { RadarOwner } from "./profile.js";

/** Signals stored per check at most; observers cap their own reads below this. */
const STORE_CAP = 100;

export function signalHash(signal: Pick<ObservedSignal, "kind" | "title" | "excerpt" | "version">) {
  return createHash("sha256")
    .update(JSON.stringify([signal.kind, signal.version ?? `${signal.title}\n${signal.excerpt}`]))
    .digest("hex")
    .slice(0, 40);
}

/**
 * Stores one check's signals. Identity is (connection, external id, content hash): a repeat
 * is a no-op and a changed item is a new version of the same story. A newer version replaces
 * an older one nobody has judged yet.
 */
export async function storeObservation(
  prisma: PrismaClient,
  source: RadarOwner & { connectionId: string; slug: string },
  result: ObserveResult,
  now: Date,
  timeZone: string,
): Promise<{ stored: number }> {
  const owner = { spaceId: source.spaceId, userId: source.userId };
  const rows = result.signals.slice(0, STORE_CAP).map((signal) => ({
    ...owner,
    connectionId: source.connectionId,
    source: source.slug,
    externalId: signal.externalId.slice(0, 400),
    threadKey: (signal.threadKey ?? "").slice(0, 400),
    storyKey: signal.storyKey.slice(0, 400),
    kind: signal.kind,
    occurredAt: signal.occurredAt,
    ...(signal.actor ? { actor: signal.actor } : {}),
    direct: signal.direct ?? false,
    ...(signal.unread === undefined ? {} : { unread: signal.unread }),
    title: signal.title.slice(0, 300),
    excerpt: signal.excerpt.slice(0, 2000),
    ...(signal.url ? { url: signal.url } : {}),
    ...(signal.deadline ? { deadline: signal.deadline } : {}),
    meta: (signal.meta ?? {}) as Prisma.InputJsonValue,
    contentHash: signalHash(signal),
    // The cycle's clock, so "today" and retention agree with the decisions made in it.
    createdAt: now,
  }));
  const today = localDate(now, timeZone);
  return prisma.$transaction(async (tx) => {
    const existing = rows.length
      ? await tx.radarSignal.findMany({
          where: {
            connectionId: source.connectionId,
            externalId: { in: [...new Set(rows.map((row) => row.externalId))] },
          },
          select: { id: true, externalId: true, contentHash: true, status: true },
        })
      : [];
    const known = new Set(existing.map((row) => `${row.externalId}\n${row.contentHash}`));
    const fresh = rows.filter((row) => !known.has(`${row.externalId}\n${row.contentHash}`));
    if (fresh.length) await tx.radarSignal.createMany({ data: fresh, skipDuplicates: true });
    const replaced = existing.filter(
      (row) =>
        row.status === "pending" &&
        fresh.some(
          (item) => item.externalId === row.externalId && item.contentHash !== row.contentHash,
        ),
    );
    if (replaced.length)
      await tx.radarSignal.updateMany({
        where: { id: { in: replaced.map((row) => row.id) } },
        data: { status: "superseded", reason: "Replaced by a newer version." },
      });
    const current = await tx.radarSource.findUnique({
      where: { connectionId: source.connectionId },
      select: { seenDate: true, seenCount: true },
    });
    await tx.radarSource.update({
      where: { connectionId: source.connectionId },
      data: {
        cursor: { ...result.cursor, overflow: result.overflow } as Prisma.InputJsonValue,
        lastCheckAt: now,
        failures: 0,
        lastError: null,
        seenDate: today,
        seenCount: (current?.seenDate === today ? current.seenCount : 0) + fresh.length,
      },
    });
    return { stored: fresh.length };
  });
}
