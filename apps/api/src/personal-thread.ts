import { ORPCError } from "@orpc/server";
import type { Actor, PersonalThread } from "@rakazo/contracts";
import { mainAssistantBot } from "@rakazo/core";
import { ensurePersonalThread, type PrismaClient } from "@rakazo/db";

/** The main assistant's Personal thread for this Space, created on first use. */
export async function resolvePersonalThread(
  prisma: PrismaClient,
  actor: Actor,
): Promise<PersonalThread> {
  const bots = await prisma.bot.findMany({
    where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
    select: { id: true, pinned: true, parentBotId: true, createdAt: true },
  });
  const root = mainAssistantBot(
    bots.map((bot) => ({ ...bot, createdAt: bot.createdAt.toISOString() })),
  );
  if (!root) throw new ORPCError("NOT_FOUND", { message: "Create a bot first" });
  const thread = await ensurePersonalThread(prisma, {
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId: root.id,
  });
  return { botId: root.id, threadId: thread.id, unread: thread.unread };
}
