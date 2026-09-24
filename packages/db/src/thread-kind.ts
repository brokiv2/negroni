import type { PrismaClient } from "./client.js";

/**
 * A bot owns one Team thread; the main assistant may also own one Personal
 * thread. Bot-to-thread lookups that mean "the bot's chat" select the Team one.
 */
export const teamThreadOnly = { where: { kind: "team" as const }, take: 1 };

/** Flatten a `threads: teamThreadOnly` include back to the bot's single Team thread. */
export function withTeamThread<T extends { threads: readonly unknown[] }>(
  bot: T,
): Omit<T, "threads"> & { thread: T["threads"][number] | null } {
  const { threads, ...rest } = bot;
  return { ...rest, thread: threads[0] ?? null };
}

/** The bot's Personal thread, created on first use. Safe under concurrent first calls. */
export async function ensurePersonalThread(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; botId: string },
) {
  const where = { botId_kind: { botId: input.botId, kind: "personal" as const } };
  const existing = await prisma.thread.findUnique({ where });
  if (existing) return existing;
  try {
    return await prisma.thread.create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        botId: input.botId,
        kind: "personal",
      },
    });
  } catch (error) {
    // A concurrent first call won the (botId, kind) unique key; use its row.
    const winner = await prisma.thread.findUnique({ where });
    if (winner) return winner;
    throw error;
  }
}

/** `withTeamThread` for a query that may find nothing. */
export async function teamThreadRow<T extends { threads: readonly unknown[] }>(
  query: PromiseLike<T | null> | T | null,
) {
  const row = await query;
  return row ? withTeamThread(row) : null;
}

/** `withTeamThread` for every row of a list query. */
export async function teamThreadRows<T extends { threads: readonly unknown[] }>(
  query: PromiseLike<T[]> | T[],
) {
  return (await query).map(withTeamThread);
}
