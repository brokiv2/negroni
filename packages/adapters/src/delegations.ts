import { runContinueJob } from "@rakazo/adapter-kit";
import {
  buildBotMessageWakePrompt,
  chargeDelegationRun,
  DELEGATION_ACTIVE_STATES,
  DELEGATION_READ_TOOLS,
  DELEGATION_REVIEW_RETRIES,
  type DelegationRecord,
  type DelegationReviewPointer,
  type DelegationStopReason,
  delegationRecord,
  delegationReview,
  delegationReviewPointer,
  delegationStopNotice,
  delegationStopReason,
  stateAfterReview,
  transitionDelegation,
} from "@rakazo/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  type Prisma,
  type PrismaClient,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

type Tx = Prisma.TransactionClient;

export interface LockedDelegation {
  taskId: string;
  record: DelegationRecord;
}

/** Read a delegated task under a row lock. Callers that also lock threads take them first. */
export async function lockDelegation(tx: Tx, taskId: string): Promise<LockedDelegation | null> {
  const rows = await tx.$queryRaw<Array<{ delegation: unknown }>>`
    SELECT delegation FROM tasks WHERE id = ${taskId} FOR UPDATE`;
  const record = delegationRecord(rows[0]?.delegation);
  return record ? { taskId, record } : null;
}

export async function saveDelegation(tx: Tx, taskId: string, record: DelegationRecord) {
  await tx.task.update({
    where: { id: taskId },
    data: { delegation: record as unknown as Prisma.InputJsonValue },
  });
}

/** The delegated task a run works on (child side) or reviews (requester side). */
export async function runDelegation(
  prisma: Pick<PrismaClient, "run" | "task"> | Tx,
  runId: string,
): Promise<
  | { kind: "child"; taskId: string; record: DelegationRecord }
  | { kind: "review"; taskId: string; pointer: DelegationReviewPointer }
  | null
> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { task: { select: { id: true, delegation: true } } },
  });
  if (!run?.task) return null;
  const record = delegationRecord(run.task.delegation);
  if (record) return { kind: "child", taskId: run.task.id, record };
  const pointer = delegationReviewPointer(run.task.delegation);
  return pointer ? { kind: "review", taskId: run.task.id, pointer } : null;
}

/** Successful read tool calls in a run, from its tool audit. Arguments are not stored. */
export async function childReadCount(tx: Tx, runId: string): Promise<number> {
  const events = await tx.event.findMany({
    where: { runId, type: "agent.tool.completed" },
    select: { payload: true },
  });
  return events.filter((event) => {
    const payload = event.payload as { name?: unknown; outcome?: unknown } | null;
    return (
      typeof payload?.name === "string" &&
      DELEGATION_READ_TOOLS.has(payload.name) &&
      payload.outcome === "succeeded"
    );
  }).length;
}

/** A short bot line in the requester's chat; returns the event seq to notify. */
export async function postDelegationNotice(
  tx: Tx,
  record: DelegationRecord,
  spaceId: string,
  reason: DelegationStopReason,
): Promise<{ threadId: string; seq: number }> {
  const blocks = [{ kind: "text" as const, text: delegationStopNotice(record, reason) }];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: record.requester.threadId,
    role: "bot",
    blocks,
    botId: record.requester.botId,
  });
  const event = await appendEventInTransaction(tx, {
    spaceId,
    threadId: record.requester.threadId,
    botId: record.requester.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "bot", blocks },
  });
  return { threadId: record.requester.threadId, seq: event.seq };
}

/** Create the requester run that reviews a returned result; the caller charges the budget. */
export async function createReviewRun(
  tx: Tx,
  input: {
    spaceId: string;
    userId: string;
    taskRef: string;
    record: DelegationRecord;
    assignee: { id: string; name: string };
    resultText: string;
    intent: "result" | "blocker";
    sourceMessageId: string;
    interactionMode: string;
    attempt: number;
  },
): Promise<{ taskId: string; runId: string }> {
  const pointer: DelegationReviewPointer = {
    kind: "review",
    taskRef: input.taskRef,
    attempt: input.attempt,
  };
  const task = await tx.task.create({
    data: {
      spaceId: input.spaceId,
      botId: input.record.requester.botId,
      threadId: input.record.requester.threadId,
      userId: input.userId,
      prompt: buildBotMessageWakePrompt({
        from: input.assignee,
        text: input.resultText,
        intent: input.intent,
        delegation: {
          assignment: input.record.assignment,
          sources: input.record.sources,
          checks: input.record.checks,
          retry: input.attempt > 0,
        },
      }),
      status: "queued",
      delegation: pointer as unknown as Prisma.InputJsonValue,
    },
  });
  const run = await tx.run.create({
    data: {
      spaceId: input.spaceId,
      botId: input.record.requester.botId,
      threadId: input.record.requester.threadId,
      taskId: task.id,
      userId: input.userId,
      status: "queued",
      trigger: "bot_message",
      interactionMode: input.interactionMode,
      sourceMessageId: input.sourceMessageId,
    },
    select: { id: true },
  });
  return { taskId: task.id, runId: run.id };
}

/**
 * Settle a review run inside its finalize transaction, so the stored review, the
 * user-facing answer and the run's terminal state commit together. An empty or failed
 * review stores an incomplete outcome and schedules one bounded retry; it never
 * completes the task.
 */
export async function settleDelegationReview(
  tx: Tx,
  input: {
    reviewRun: { id: string; spaceId: string; userId: string; interactionMode: string };
    pointer: DelegationReviewPointer;
    /** The reviewer's own written answer, or null when the run failed. */
    reviewText: string | null;
    now?: Date;
  },
): Promise<{ retryRunId?: string }> {
  const now = input.now ?? new Date();
  const locked = await lockDelegation(tx, input.pointer.taskRef);
  if (!locked || locked.record.state !== "reviewing") return {};
  const { record } = locked;
  const review = delegationReview({
    taskRef: locked.taskId,
    record,
    summary: input.reviewText ?? "",
    reviewRunId: input.reviewRun.id,
    now,
  });
  if (review.outcome !== "incomplete") {
    const reviewed: DelegationRecord = { ...record, review };
    await saveDelegation(
      tx,
      locked.taskId,
      transitionDelegation(reviewed, stateAfterReview(reviewed), now, `review_${review.outcome}`),
    );
    return {};
  }
  const attempts = record.reviewAttempts + 1;
  const withIncomplete: DelegationRecord = { ...record, review, reviewAttempts: attempts };
  const blocked = delegationStopReason(withIncomplete, now);
  if (attempts <= DELEGATION_REVIEW_RETRIES && !blocked && record.outcome) {
    const assignee = await tx.bot.findUnique({
      where: { id: record.assigneeBotId },
      select: { id: true, name: true },
    });
    const retry = await createReviewRun(tx, {
      spaceId: input.reviewRun.spaceId,
      userId: input.reviewRun.userId,
      taskRef: locked.taskId,
      record: withIncomplete,
      assignee: assignee ?? { id: record.assigneeBotId, name: "specialist" },
      resultText: record.outcome.text,
      intent: record.outcome.intent,
      sourceMessageId: record.outcome.messageId,
      interactionMode: input.reviewRun.interactionMode,
      attempt: attempts,
    });
    const charged = chargeDelegationRun(withIncomplete, now);
    await saveDelegation(tx, locked.taskId, {
      ...charged,
      reviewTaskIds: [...(charged.reviewTaskIds ?? []), retry.taskId],
    });
    return { retryRunId: retry.runId };
  }
  const reason: DelegationStopReason =
    blocked === "budget_exhausted" || blocked === "deadline_passed" ? blocked : "review_incomplete";
  await saveDelegation(
    tx,
    locked.taskId,
    transitionDelegation(withIncomplete, "failed", now, reason),
  );
  await postDelegationNotice(tx, withIncomplete, input.reviewRun.spaceId, reason);
  return {};
}

/** A queued child or review run whose task was stopped must not reach the model. */
export async function delegationRunGate(
  prisma: PrismaClient,
  runId: string,
  now = new Date(),
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const found = await runDelegation(prisma, runId);
  if (!found) return { allowed: true };
  if (found.kind === "review") {
    const target = await prisma.task.findUnique({
      where: { id: found.pointer.taskRef },
      select: { delegation: true },
    });
    const record = delegationRecord(target?.delegation);
    return record?.state === "reviewing"
      ? { allowed: true }
      : { allowed: false, reason: "This review is no longer needed." };
  }
  const { record } = found;
  if (record.state === "queued" || record.state === "needs_input") {
    if (new Date(record.deadline).getTime() <= now.getTime()) {
      await prisma.$transaction(async (tx) => {
        const locked = await lockDelegation(tx, found.taskId);
        if (locked && (locked.record.state === "queued" || locked.record.state === "needs_input"))
          await saveDelegation(
            tx,
            found.taskId,
            transitionDelegation(locked.record, "failed", now, "deadline_passed"),
          );
      });
      return { allowed: false, reason: "This delegated task passed its deadline." };
    }
    await prisma.$transaction(async (tx) => {
      const locked = await lockDelegation(tx, found.taskId);
      if (locked && (locked.record.state === "queued" || locked.record.state === "needs_input"))
        await saveDelegation(tx, found.taskId, transitionDelegation(locked.record, "working", now));
    });
    return { allowed: true };
  }
  if (record.state === "working") return { allowed: true };
  return { allowed: false, reason: "This delegated task was stopped." };
}

/**
 * Close delegated tasks whose runs were cancelled by any path (clear, archive, stop).
 * Completed and failed runs are settled by their own finalize or outcome return.
 */
export async function reconcileDelegations(deps: { prisma: PrismaClient; now?: () => Date }) {
  const now = deps.now?.() ?? new Date();
  const candidates = await deps.prisma.task.findMany({
    where: {
      OR: DELEGATION_ACTIVE_STATES.map((state) => ({
        delegation: { path: ["state"], equals: state },
      })),
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: { id: true, spaceId: true, runs: { select: { status: true } } },
  });
  for (const candidate of candidates) {
    try {
      await deps.prisma.$transaction(async (tx) => {
        const locked = await lockDelegation(tx, candidate.id);
        if (!locked) return;
        const { record } = locked;
        if (record.state === "reviewing") {
          const reviewRuns = await tx.run.findMany({
            where: { taskId: { in: record.reviewTaskIds ?? [] } },
            select: { status: true },
          });
          const live = reviewRuns.some((run) =>
            ["queued", "leased", "running", "waiting_input", "waiting_takeover"].includes(
              run.status,
            ),
          );
          if (!live && reviewRuns.length > 0 && reviewRuns.every((r) => r.status === "cancelled")) {
            await saveDelegation(
              tx,
              locked.taskId,
              transitionDelegation(record, "cancelled", now, "review_cancelled"),
            );
          }
          return;
        }
        const runs = candidate.runs;
        if (runs.length > 0 && runs.every((run) => run.status === "cancelled")) {
          await saveDelegation(
            tx,
            locked.taskId,
            transitionDelegation(record, "cancelled", now, "child_cancelled"),
          );
        }
      });
    } catch (error) {
      getLogger().error("delegation reconciliation", error);
    }
  }
}

export function enqueueDelegationRun(
  jobs: { enqueue: (job: ReturnType<typeof runContinueJob>) => Promise<void> },
  runId: string | undefined,
) {
  if (!runId) return Promise.resolve();
  // The queued run is durable; the job reconciler repairs a missed wake.
  return jobs
    .enqueue(runContinueJob(runId))
    .catch((error) => getLogger().error("delegation run enqueue", error));
}
