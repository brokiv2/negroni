import { runContinueJob } from "@rakazo/adapter-kit";
import type { BotMessageIntent, MessageBlock } from "@rakazo/contracts";
import {
  BOT_MESSAGE_MAX_LENGTH,
  botMessageContext,
  botMessageHopExhausted,
  buildBotMessageWakePrompt,
  chargeDelegationRun,
  clampBotMessage,
  createDelegationRecord,
  type DelegationRecord,
  type DelegationStopReason,
  delegationResultChecks,
  delegationStopReason,
  isDelegationActive,
  nextBotMessageHop,
  normalizeSources,
  resolveBotAddress,
  runInteractionModeFor,
  transitionDelegation,
} from "@rakazo/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  type Prisma,
  type PrismaClient,
  teamThreadOnly,
  teamThreadRows,
  withTransactionRetry,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import {
  childReadCount,
  createReviewRun,
  lockDelegation,
  postDelegationNotice,
  runDelegation,
  saveDelegation,
} from "./delegations.js";
import type { ExecutorDeps } from "./executor.js";

/**
 * What a delivery does to the delegated task it belongs to. A request opens one; the
 * child's status, result or blocker moves it; anything for a closed task is dropped so
 * a late or duplicate return cannot reopen or complete it.
 */
type DelegationPlan =
  | { kind: "none" }
  | { kind: "ignore"; reason: string }
  | { kind: "dispatch"; record: DelegationRecord; parentTaskId?: string; parent?: DelegationRecord }
  | {
      kind: "return";
      taskId: string;
      record: DelegationRecord;
      wake: boolean;
      stop?: DelegationStopReason;
    };

/**
 * The hop the current run sits at, read back from the message that woke this
 * bot. A run a person started carries no bot message, so it starts at 0.
 */
export async function currentBotMessageHop(
  prisma: PrismaClient,
  sourceMessageId: string | null | undefined,
): Promise<number> {
  if (!sourceMessageId) return 0;
  const source = await prisma.message.findUnique({
    where: { id: sourceMessageId },
    select: { blocks: true },
  });
  const blocks = Array.isArray(source?.blocks) ? (source.blocks as MessageBlock[]) : [];
  return botMessageContext(blocks)?.hop ?? 0;
}

export async function loadBotMessageContext(
  prisma: PrismaClient,
  sourceMessageId: string | null | undefined,
) {
  if (!sourceMessageId) return undefined;
  const source = await prisma.message.findUnique({
    where: { id: sourceMessageId },
    select: { blocks: true, replyTo: { select: { blocks: true } } },
  });
  const context = botMessageContext(
    Array.isArray(source?.blocks) ? (source.blocks as MessageBlock[]) : [],
  );
  if (!context) return undefined;
  const replyBlocks = Array.isArray(source?.replyTo?.blocks)
    ? (source.replyTo.blocks as MessageBlock[])
    : [];
  const repliesToRequest = replyBlocks.some(
    (block) =>
      block.kind === "bot_message_sent" &&
      (block.intent === undefined || block.intent === "request" || block.intent === "question"),
  );
  return { ...context, repliesToRequest };
}

export async function messageBot(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    sourceMessageId?: string | null;
  },
  sender: { id: string; name: string },
  input: {
    bot_id?: string;
    confirm_name?: string;
    message: string;
    intent?: BotMessageIntent;
    deliveryKey?: string;
    /** For a request: exact files or URLs the result must use and cite. */
    sources?: readonly unknown[];
    /** The child run ended in failure, so this blocker is final. */
    failed?: boolean;
  },
  options?: { allowTerminalSource?: boolean },
) {
  const message = String(input.message ?? "").trim();
  if (!message) return { ok: false as const, error: "message is required" };
  if (message.length > BOT_MESSAGE_MAX_LENGTH) {
    return {
      ok: false as const,
      error: `message exceeds the ${BOT_MESSAGE_MAX_LENGTH} character limit`,
    };
  }

  const sourceContext = await loadBotMessageContext(deps.prisma, run.sourceMessageId);
  const intent = input.intent ?? "request";
  const hop = nextBotMessageHop(sourceContext?.hop);

  const candidates = await teamThreadRows(
    deps.prisma.bot.findMany({
      where: { spaceId: run.spaceId, userId: run.userId, archivedAt: null },
      select: {
        id: true,
        name: true,
        title: true,
        threads: { ...teamThreadOnly, select: { id: true } },
      },
    }),
  );
  const target = resolveBotAddress(candidates, {
    botId: input.bot_id,
    name: input.confirm_name,
  });
  if (!target) return { ok: false as const, error: "no bot found with that id or name" };
  if (target.id === sender.id) return { ok: false as const, error: "a bot cannot message itself" };
  if (!target.thread)
    return { ok: false as const, error: `${target.name} has no chat to deliver to` };
  const returnsToSender =
    options?.allowTerminalSource === true &&
    (intent === "result" || intent === "status" || intent === "blocker") &&
    (sourceContext?.intent === undefined ||
      sourceContext.intent === "request" ||
      sourceContext.intent === "question") &&
    sourceContext?.fromBotId === target.id;
  if (botMessageHopExhausted(hop) && !returnsToSender) {
    return {
      ok: false as const,
      error:
        "bot-to-bot message limit reached for this chain; report back to the user instead of messaging another bot",
    };
  }

  // A reply to the bot that asked goes back to the thread the request came
  // from, so a result for the Personal conversation lands there, not in Team.
  const returnThread =
    sourceContext?.fromBotId === target.id && sourceContext.returnToMessageId
      ? await originThreadOf(deps.prisma, target.id, sourceContext.returnToMessageId)
      : null;
  const targetThreadId = returnThread?.id ?? target.thread.id;
  const targetInteractionMode = runInteractionModeFor({ threadKind: returnThread?.kind });

  // A tool call can be re-executed after a lease expiry, so a delivery has to be
  // replayable: without this the recipient is messaged twice and woken twice.
  const deliveryKey = input.deliveryKey ? `bot-message:${input.deliveryKey}` : undefined;
  const replayed = () =>
    ({
      ok: true as const,
      botId: target.id,
      name: target.name,
      delivered: message,
      replayed: true as const,
      note: `Already sent to ${target.name} in this turn; it was not sent again.`,
    }) as const;

  const sources = intent === "request" ? normalizeSources(input.sources ?? []) : [];
  const outboundBlock: MessageBlock = {
    kind: "bot_message_sent",
    toBotId: target.id,
    toBotName: target.name,
    text: message,
    intent,
  };

  let committed:
    | {
        ok: true;
        runId: string | null;
        targetEventSeq: number;
        senderEventSeq: number;
      }
    | {
        ok: true;
        ignored: string;
      }
    | {
        ok: false;
        error: string;
      }
    | {
        ok: true;
        replayed: true;
      };
  try {
    committed = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx) => {
        for (const threadId of [run.threadId, targetThreadId].sort()) {
          await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
        }
        // Claim the delivery key inside the transaction so a concurrent retry
        // either sees the winner or loses on the unique (threadId, clientNonce).
        if (deliveryKey) {
          const already = await tx.message.findUnique({
            where: { threadId_clientNonce: { threadId: targetThreadId, clientNonce: deliveryKey } },
            select: { id: true },
          });
          if (already) return { ok: true as const, replayed: true as const };
        }

        const senderStillRunning = await tx.run.findFirst({
          where: {
            id: run.id,
            spaceId: run.spaceId,
            threadId: run.threadId,
            botId: run.botId,
            userId: run.userId,
            status: options?.allowTerminalSource ? { in: ["completed", "failed"] } : "running",
          },
          select: { id: true },
        });
        if (!senderStillRunning)
          return { ok: false as const, error: "source run is no longer active" };

        // Re-read the target inside the transaction: it can be archived between
        // resolving it above and committing here.
        const stillAddressable = await tx.bot.findFirst({
          where: {
            id: target.id,
            spaceId: run.spaceId,
            userId: run.userId,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!stillAddressable)
          return { ok: false as const, error: `${target.name} is no longer available` };

        const now = new Date();
        const plan = await planDelegation(tx, {
          run,
          targetId: target.id,
          intent,
          message,
          sources,
          failed: input.failed === true,
          returnsToRequester: sourceContext?.fromBotId === target.id,
          now,
        });
        if (plan.kind === "ignore") return { ok: true as const, ignored: plan.reason };
        if (plan.kind === "dispatch" && plan.parent) {
          const blocked = delegationStopReason(plan.parent, now);
          if (blocked)
            return {
              ok: false as const,
              error:
                blocked === "deadline_passed"
                  ? "This task passed its deadline; tell the user what was found instead of delegating again."
                  : "This task reached its run limit; tell the user what was found instead of delegating again.",
            };
        }

        // Echo into the sender's chat in the same transaction so a failed notify
        // cannot leave one side delivered and the other blank.
        const outbound = await createThreadMessageInTransaction(tx, {
          threadId: run.threadId,
          role: "bot",
          blocks: [outboundBlock],
          botId: run.botId,
          runId: run.id,
        });
        const inboundBlock: MessageBlock = {
          kind: "bot_message_received",
          fromBotId: sender.id,
          fromBotName: sender.name,
          text: message,
          hop,
          intent,
          returnToMessageId: outbound.id,
        };
        // This is the recipient's prompt, but it is still unread peer activity.
        const inbound = await createThreadMessageInTransaction(tx, {
          threadId: targetThreadId,
          role: "user",
          blocks: [inboundBlock],
          replyToMessageId:
            sourceContext?.fromBotId === target.id && intent !== "fyi"
              ? sourceContext.returnToMessageId
              : undefined,
          clientNonce: deliveryKey,
          markUnread: true,
        });
        let nextRunId: string | null = null;
        let noticeEventSeq: number | undefined;
        if (plan.kind === "return") {
          const outcomeIntent = intent === "status" ? null : (intent as "result" | "blocker");
          let record = plan.record;
          if (outcomeIntent && record.outcome) {
            record = { ...record, outcome: { ...record.outcome, messageId: inbound.id } };
          }
          if (plan.wake && outcomeIntent) {
            const review = await createReviewRun(tx, {
              spaceId: run.spaceId,
              userId: run.userId,
              taskRef: plan.taskId,
              record,
              assignee: sender,
              resultText: message,
              intent: outcomeIntent,
              sourceMessageId: inbound.id,
              interactionMode: targetInteractionMode,
              attempt: 0,
            });
            nextRunId = review.runId;
            record = {
              ...chargeDelegationRun(record, now),
              reviewTaskIds: [...(record.reviewTaskIds ?? []), review.taskId],
            };
          } else if (plan.wake) {
            nextRunId = await createWakeRun(tx, {
              run,
              targetId: target.id,
              targetThreadId,
              interactionMode: targetInteractionMode,
              sourceMessageId: inbound.id,
              prompt: buildBotMessageWakePrompt({
                from: sender,
                text: message,
                intent,
                delegation: { assignment: record.assignment, sources: record.sources },
              }),
            });
            record = chargeDelegationRun(record, now);
          }
          await saveDelegation(tx, plan.taskId, record);
          if (plan.stop) {
            noticeEventSeq = (await postDelegationNotice(tx, record, run.spaceId, plan.stop)).seq;
          }
        } else {
          const dispatched =
            plan.kind === "dispatch"
              ? {
                  ...plan.record,
                  requester: { ...plan.record.requester, requestMessageId: outbound.id },
                }
              : undefined;
          nextRunId = await createWakeRun(tx, {
            run,
            targetId: target.id,
            targetThreadId,
            interactionMode: targetInteractionMode,
            sourceMessageId: inbound.id,
            prompt: buildBotMessageWakePrompt({
              from: sender,
              text: message,
              intent,
              sources: dispatched?.sources,
            }),
            delegation: dispatched,
          });
          if (plan.kind === "dispatch" && plan.parent && plan.parentTaskId) {
            const child = await tx.run.findUniqueOrThrow({
              where: { id: nextRunId },
              select: { taskId: true },
            });
            await saveDelegation(tx, plan.parentTaskId, {
              ...transitionDelegation(plan.parent, "superseded", now, "rework_requested"),
              supersededBy: child.taskId,
            });
          }
        }
        if (nextRunId) {
          await tx.message.update({ where: { id: inbound.id }, data: { runId: nextRunId } });
        }
        const inboundEvent = await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: targetThreadId,
          botId: target.id,
          type: "thread.message.created",
          runId: nextRunId ?? undefined,
          payload: { messageId: inbound.id, role: "user", blocks: [inboundBlock] },
        });
        const outboundEvent = await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: run.threadId,
          botId: run.botId,
          type: "thread.message.created",
          runId: run.id,
          payload: { messageId: outbound.id, role: "bot", blocks: [outboundBlock] },
        });
        return {
          ok: true as const,
          runId: nextRunId,
          targetEventSeq: noticeEventSeq ?? inboundEvent.seq,
          senderEventSeq: outboundEvent.seq,
        };
      }),
    );
  } catch (error) {
    // Two concurrent retries can both miss the in-transaction lookup; the
    // loser hits the unique key. Treat that as a successful replay.
    if (deliveryKey && isUniqueConstraintError(error)) {
      const winner = await deps.prisma.message.findUnique({
        where: { threadId_clientNonce: { threadId: targetThreadId, clientNonce: deliveryKey } },
        select: { id: true },
      });
      if (winner) return replayed();
    }
    throw error;
  }
  if ("replayed" in committed) return replayed();
  if (!committed.ok) return committed;
  if ("ignored" in committed) {
    // A late or duplicate return for a task that already moved on: nothing is delivered.
    return {
      ok: true as const,
      botId: target.id,
      name: target.name,
      delivered: message,
      ignored: true as const,
      note: `Not delivered: ${committed.ignored}`,
    };
  }

  await deps.events.notify(targetThreadId, committed.targetEventSeq).catch((error) => {
    getLogger().error("bot message realtime notification", error);
  });
  await deps.events.notify(run.threadId, committed.senderEventSeq).catch((error) => {
    getLogger().error("bot message sender echo notification", error);
  });
  if (committed.runId) {
    await deps.jobs.enqueue(runContinueJob(committed.runId)).catch((error) => {
      // The queued run is durable; the job reconciler repairs a missed wake.
      getLogger().error("bot message enqueue", error);
    });
  }
  return {
    ok: true as const,
    botId: target.id,
    name: target.name,
    delivered: message,
    note: `Sent to ${target.name}. Delivery is async; a reply wakes you later as a new message. Continue independent work; send another update later only if it adds something new.`,
  };
}

async function createWakeRun(
  tx: Prisma.TransactionClient,
  input: {
    run: { spaceId: string; userId: string };
    targetId: string;
    targetThreadId: string;
    interactionMode: string;
    sourceMessageId: string;
    prompt: string;
    delegation?: DelegationRecord;
  },
): Promise<string> {
  const task = await tx.task.create({
    data: {
      spaceId: input.run.spaceId,
      botId: input.targetId,
      threadId: input.targetThreadId,
      userId: input.run.userId,
      prompt: input.prompt,
      status: "queued",
      ...(input.delegation
        ? { delegation: input.delegation as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  const nextRun = await tx.run.create({
    data: {
      spaceId: input.run.spaceId,
      botId: input.targetId,
      threadId: input.targetThreadId,
      taskId: task.id,
      userId: input.run.userId,
      status: "queued",
      trigger: "bot_message",
      interactionMode: input.interactionMode,
      sourceMessageId: input.sourceMessageId,
    },
    select: { id: true },
  });
  return nextRun.id;
}

async function planDelegation(
  tx: Prisma.TransactionClient,
  input: {
    run: { id: string; botId: string; threadId: string; sourceMessageId?: string | null };
    targetId: string;
    intent: BotMessageIntent;
    message: string;
    sources: string[];
    failed: boolean;
    returnsToRequester: boolean;
    now: Date;
  },
): Promise<DelegationPlan> {
  const { intent, now } = input;
  const own = await runDelegation(tx, input.run.id);
  if (intent === "request") {
    const parent = own?.kind === "review" ? await lockDelegation(tx, own.pointer.taskRef) : null;
    const activeParent = parent && isDelegationActive(parent.record) ? parent : null;
    return {
      kind: "dispatch",
      record: createDelegationRecord({
        assignment: input.message,
        sources: input.sources,
        requester: {
          botId: input.run.botId,
          threadId: input.run.threadId,
          runId: input.run.id,
          requestMessageId: "",
          sourceMessageId: input.run.sourceMessageId ?? null,
        },
        assigneeBotId: input.targetId,
        now,
        parent: activeParent ? { ...activeParent.record, taskRef: activeParent.taskId } : undefined,
      }),
      ...(activeParent ? { parentTaskId: activeParent.taskId, parent: activeParent.record } : {}),
    };
  }
  if (intent !== "result" && intent !== "blocker" && intent !== "status") return { kind: "none" };
  if (own?.kind !== "child" || !input.returnsToRequester) return { kind: "none" };
  if (own.record.requester.botId !== input.targetId) return { kind: "none" };
  const locked = await lockDelegation(tx, own.taskId);
  if (!locked) return { kind: "none" };
  const record = locked.record;
  const open =
    record.state === "queued" || record.state === "working" || record.state === "needs_input";
  if (!open) return { kind: "ignore", reason: `the task is already ${record.state}` };
  if (intent === "status") {
    const updated: DelegationRecord = {
      ...transitionDelegation(record, "working", now),
      lastStatus: { text: input.message.slice(0, 2_000), at: now.toISOString() },
    };
    // Progress beyond the allowance is kept on the task without waking anyone.
    return {
      kind: "return",
      taskId: locked.taskId,
      record: updated,
      wake: !delegationStopReason(updated, now),
    };
  }
  const readCount = await childReadCount(tx, input.run.id);
  const outcome = {
    intent,
    ...(intent === "blocker" && input.failed ? { failed: true } : {}),
    text: input.message,
    messageId: "",
    childRunId: input.run.id,
    readCount,
    receivedAt: now.toISOString(),
  } as const;
  const reviewing: DelegationRecord = {
    ...transitionDelegation(record, "reviewing", now),
    outcome,
    checks: delegationResultChecks({
      intent,
      text: input.message,
      sources: record.sources,
      readCount,
    }),
  };
  const stop = delegationStopReason(reviewing, now);
  if (stop === "budget_exhausted" || stop === "deadline_passed") {
    return {
      kind: "return",
      taskId: locked.taskId,
      record: transitionDelegation(reviewing, "failed", now, stop),
      wake: false,
      stop,
    };
  }
  return { kind: "return", taskId: locked.taskId, record: reviewing, wake: true };
}

/** The requester's own thread that holds the message a reply should return to. */
export async function originThreadOf(
  prisma: PrismaClient,
  botId: string,
  messageId: string,
): Promise<{ id: string; kind: "team" | "personal" } | null> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { thread: { select: { id: true, botId: true, kind: true } } },
  });
  const thread = message?.thread;
  return thread && thread.botId === botId && thread.kind !== "research"
    ? { id: thread.id, kind: thread.kind }
    : null;
}

/** Return a delegated run's terminal outcome unless it already sent one explicitly. */
export async function returnBotMessageOutcome(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    sourceMessageId?: string | null;
  },
  sender: { id: string; name: string },
  text: string,
  intent: "result" | "blocker" = "result",
  options?: { failed?: boolean },
) {
  const source = await loadBotMessageContext(deps.prisma, run.sourceMessageId);
  if (!source) {
    await markBotOutcomeReturned(deps.prisma, run.id);
    // Handled: nothing to deliver. Return true so callers do not release a reservation.
    return true;
  }
  const sourceIntent = source.intent ?? "request";
  // An unanswered question has nothing to return: a blocker would read as a failed task.
  if (
    (sourceIntent !== "request" && sourceIntent !== "question") ||
    (sourceIntent === "question" && intent === "blocker")
  ) {
    await markBotOutcomeReturned(deps.prisma, run.id);
    return true;
  }
  const sent = await deps.prisma.message.findMany({
    where: { threadId: run.threadId, runId: run.id },
    select: { blocks: true },
  });
  // Only an explicit result or blocker counts as a terminal outcome. Interim
  // message_bot status updates must not suppress the automatic final return.
  const alreadyReturned = sent.some((message) =>
    (Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : []).some(
      (block) =>
        block.kind === "bot_message_sent" &&
        block.toBotId === source.fromBotId &&
        (block.intent === "result" || block.intent === "blocker"),
    ),
  );
  if (alreadyReturned) {
    await markBotOutcomeReturned(deps.prisma, run.id);
    return true;
  }
  const outcome = await messageBot(
    deps,
    run,
    sender,
    {
      bot_id: source.fromBotId,
      message: clampBotMessage(text),
      intent,
      failed: options?.failed,
      // One key per run so a result vs blocker (executor vs reconciler) cannot double-deliver.
      deliveryKey: `auto-outcome:${run.id}`,
    },
    { allowTerminalSource: true },
  );
  if (outcome.ok) await markBotOutcomeReturned(deps.prisma, run.id);
  return outcome.ok;
}

async function markBotOutcomeReturned(prisma: PrismaClient, runId: string) {
  await prisma.run.updateMany({
    where: {
      id: runId,
      status: { in: ["completed", "failed"] },
      botOutcomeReturnedAt: null,
    },
    data: { botOutcomeReturnedAt: new Date() },
  });
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
