import type { Actor } from "@rakazo/contracts";
import { ResponseUiBlock, UpdateResponseUiStateInput, validateUiState } from "@rakazo/contracts";
import { appendEventInTransaction } from "./events.js";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { IsolationError } from "./scope.js";

export class ResponseUiStateError extends Error {
  constructor(
    public readonly reason: "conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

/** Local response interaction updates the existing message; it never starts an agent or effect. */
export async function updateResponseUiState(prisma: PrismaClient, actor: Actor, input: unknown) {
  const value = UpdateResponseUiStateInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const source = await tx.message.findFirst({
      where: {
        id: value.messageId,
        role: "bot",
        thread: { spaceId: actor.spaceId, userId: actor.userId },
      },
      select: { threadId: true },
    });
    if (!source) throw new IsolationError();
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${source.threadId} FOR UPDATE`;
    const membership = await tx.spaceMember.findFirst({
      where: { spaceId: actor.spaceId, userId: actor.userId },
    });
    const row = await tx.message.findFirst({
      where: {
        id: value.messageId,
        role: "bot",
        thread: { id: source.threadId, spaceId: actor.spaceId, userId: actor.userId },
      },
    });
    if (!membership || !row?.botId || !Array.isArray(row.blocks)) throw new IsolationError();
    const blocks = row.blocks;
    const index = blocks.findIndex(
      (b) =>
        b &&
        typeof b === "object" &&
        !Array.isArray(b) &&
        b.kind === "response_ui" &&
        b.id === value.blockId,
    );
    const parsed = ResponseUiBlock.safeParse(blocks[index]);
    if (!parsed.success || !parsed.data.complete)
      throw new ResponseUiStateError("invalid", "This response cannot be edited.");
    const current = parsed.data;
    if (!validateUiState(current.spec, value.state))
      throw new ResponseUiStateError("invalid", "These values do not match the response fields.");
    if (current.revision !== value.revision) {
      const state = current.state ?? current.spec.state;
      if (
        current.revision === value.revision + 1 &&
        Object.keys(value.state).every((k) => value.state[k] === state[k])
      )
        return { block: current, threadId: source.threadId, eventSeq: null };
      throw new ResponseUiStateError(
        "conflict",
        "This response changed on another device. Refresh before saving.",
      );
    }
    const block = ResponseUiBlock.parse({
      ...current,
      state: value.state,
      revision: current.revision + 1,
    });
    const updated = blocks.map((b, i) => (i === index ? block : b)) as Prisma.InputJsonValue;
    await tx.message.update({ where: { id: row.id }, data: { blocks: updated } });
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId,
      threadId: source.threadId,
      botId: row.botId,
      type: "thread.message.updated",
      // The source run can be terminal. This is a user's state write, not new run output.
      payload: {
        messageId: row.id,
        role: row.role,
        blocks: updated,
        messageRunId: row.runId,
        messageCreatedAt: row.createdAt.toISOString(),
        replyToMessageId: row.replyToMessageId,
      },
    });
    return { block, threadId: source.threadId, eventSeq: event.seq };
  });
}
