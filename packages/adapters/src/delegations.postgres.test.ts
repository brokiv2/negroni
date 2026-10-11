import { randomUUID } from "node:crypto";
import type { BackgroundJob } from "@rakazo/adapter-kit";
import {
  createDelegationRecord,
  type DelegationRecord,
  delegationRecord,
  delegationResultChecks,
  transitionDelegation,
} from "@rakazo/core";
import {
  appendEventInTransaction,
  createDb,
  createThreadMessage,
  finalizeRun,
  type PrismaClient,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messageBot } from "./bot-messages.js";
import {
  acquireComputerExecutionLease,
  ComputerBusyError,
  releaseComputerExecutionLease,
} from "./computer-lifecycle.js";
import {
  delegationRunGate,
  delegationRunStillAllowed,
  reconcileDelegations,
  settleDelegationReview,
} from "./delegations.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

suite("delegated task state (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  const owners: string[] = [];

  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: owners } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
    await prisma.$disconnect();
    await db.pool.end();
  });

  async function setup() {
    const id = randomUUID();
    owners.push(id);
    await prisma.user.create({
      data: { id, name: "Delegation", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Delegation", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id, organizationId: id, name: "Delegation", isDefault: true },
    });
    await prisma.member.create({
      data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
    });
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: id, userId: id } },
      update: {},
      create: {
        id,
        spaceId: id,
        organizationId: id,
        userId: id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const computer = await prisma.computer.create({
      data: { spaceId: id, userId: id, scopeKey: `c-${id}`, homeKey: `h-${id}`, kind: "fake" },
    });
    const bot = (name: string, parentBotId?: string) =>
      prisma.bot.create({
        data: {
          spaceId: id,
          userId: id,
          name,
          color: "test",
          computerId: computer.id,
          parentBotId,
        },
      });
    const main = await bot("Assistant");
    const analyst = await bot("Analyst", main.id);
    const personal = await prisma.thread.create({
      data: { spaceId: id, userId: id, botId: main.id, kind: "personal" },
    });
    await prisma.thread.create({ data: { spaceId: id, userId: id, botId: main.id, kind: "team" } });
    const analystThread = await prisma.thread.create({
      data: { spaceId: id, userId: id, botId: analyst.id, kind: "team" },
    });
    return { id, computer, main, analyst, personal, analystThread };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function run(
    s: Setup,
    input: { botId: string; threadId: string; status: string; delegation?: unknown },
  ) {
    const task = await prisma.task.create({
      data: {
        spaceId: s.id,
        userId: s.id,
        botId: input.botId,
        threadId: input.threadId,
        prompt: "fixture",
        status: "queued",
        delegation: input.delegation as never,
      },
    });
    const row = await prisma.run.create({
      data: {
        spaceId: s.id,
        userId: s.id,
        botId: input.botId,
        threadId: input.threadId,
        taskId: task.id,
        status: input.status,
        trigger: "bot_message",
        ...(input.status === "running"
          ? { leaseOwner: "worker-1", leaseFence: 1, leaseExpiresAt: new Date(Date.now() + 60_000) }
          : {}),
      },
    });
    return { task, run: row };
  }

  function record(s: Setup, now = new Date()): DelegationRecord {
    return createDelegationRecord({
      assignment: "Compare docs/a.md and docs/b.md.",
      sources: ["docs/a.md", "docs/b.md"],
      requester: {
        botId: s.main.id,
        threadId: s.personal.id,
        runId: "dispatch",
        requestMessageId: "request",
        sourceMessageId: null,
      },
      assigneeBotId: s.analyst.id,
      now,
    });
  }

  async function stored(taskId: string) {
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    return delegationRecord(row.delegation)!;
  }

  async function phaseAssignment(withWork = false) {
    const s = await setup();
    const source = await createThreadMessage(prisma, {
      threadId: s.personal.id,
      role: "user",
      blocks: [{ kind: "text", text: "Compare both documents and recommend one, with evidence." }],
    });
    const dispatch = await run(s, { botId: s.main.id, threadId: s.personal.id, status: "running" });
    let root = await prisma.run.update({
      where: { id: dispatch.run.id },
      data: { trigger: "user", sourceMessageId: source.id },
    });
    if (withWork) {
      const work = await prisma.assistantWork.create({
        data: {
          spaceId: s.id,
          userId: s.id,
          botId: s.main.id,
          threadId: s.personal.id,
          sourceMessageId: source.id,
          creationKey: `work-${s.id}`,
          title: "Document comparison",
          objective: "Recommend one option with evidence.",
          authorization: JSON.stringify(source.blocks),
          deadline: new Date(Date.now() + 24 * 3600_000),
          wakeReason: "Review the sources.",
        },
      });
      root = await prisma.run.update({
        where: { id: root.id },
        data: {
          workId: work.id,
          workVersion: work.version,
          trigger: "work",
          sourceMessageId: null,
        },
      });
    }
    const enqueued: string[] = [];
    const deps = {
      prisma,
      events: { notify: async () => undefined },
      jobs: {
        enqueue: async (job: BackgroundJob) => {
          if (job.name === "run.continue") enqueued.push(job.payload.runId);
        },
      },
    };
    const sent = await messageBot(deps, root, s.main, {
      bot_id: s.analyst.id,
      message: "Compare docs/a.md and docs/b.md; recommend one, with evidence. No external writes.",
      sources: ["docs/a.md", "docs/b.md"],
      phases: [
        "Read and compare both documents.",
        "Check costs and limitations.",
        "Write the recommendation using both sources.",
      ],
      deliveryKey: "phase-fixture",
    });
    expect(sent.ok).toBe(true);
    const child = await prisma.run.findFirstOrThrow({
      where: { botId: s.analyst.id, spaceId: s.id },
    });
    await prisma.run.update({ where: { id: root.id }, data: { status: "completed" } });
    return { s, root, source, deps, enqueued, taskId: child.taskId, childId: child.id };
  }
  type Phased = Awaited<ReturnType<typeof phaseAssignment>>;
  async function returnPhase(
    f: Phased,
    childId: string,
    text = "Option A has lower cost per docs/a.md; docs/b.md shows the rollout limitation.",
    reads = 2,
    intent: "result" | "blocker" = "result",
  ) {
    expect((await delegationRunGate(prisma, childId)).allowed).toBe(true);
    await prisma.run.update({ where: { id: childId }, data: { status: "completed" } });
    for (let i = 0; i < reads; i++)
      await prisma.$transaction((tx) =>
        appendEventInTransaction(tx, {
          spaceId: f.s.id,
          threadId: f.s.analystThread.id,
          botId: f.s.analyst.id,
          runId: childId,
          type: "agent.tool.completed",
          payload: { name: "read_file", outcome: "succeeded" },
        }),
      );
    const child = await prisma.run.findUniqueOrThrow({ where: { id: childId } });
    expect(
      (
        await messageBot(
          f.deps,
          child,
          f.s.analyst,
          {
            bot_id: f.s.main.id,
            intent,
            message: text,
            deliveryKey: `result:${childId}`,
          },
          { allowTerminalSource: true },
        )
      ).ok,
    ).toBe(true);
    const review = await prisma.run.findFirstOrThrow({
      where: { spaceId: f.s.id, botId: f.s.main.id, trigger: "bot_message", status: "queued" },
      include: { task: true },
      orderBy: { createdAt: "desc" },
    });
    await prisma.run.update({ where: { id: review.id }, data: { status: "running" } });
    return review;
  }
  async function reviewPhase(
    _f: Phased,
    review: Awaited<ReturnType<typeof returnPhase>>,
    summary = "The comparison follows from both requested documents; the rollout limitation is preserved.",
  ) {
    const result = await prisma.$transaction((tx) =>
      settleDelegationReview(tx, {
        reviewRun: review,
        pointer: review.task.delegation as never,
        reviewText: summary,
      }),
    );
    await prisma.run.update({ where: { id: review.id }, data: { status: "completed" } });
    return result;
  }

  it("reviews three stages across durable runs, preserves evidence and rejects stale returns", async () => {
    const f = await phaseAssignment();
    const original = await stored(f.taskId);
    const firstReview = await returnPhase(f, f.childId);
    const count = await prisma.run.count({ where: { spaceId: f.s.id } });
    expect(
      await prisma.$transaction((tx) =>
        settleDelegationReview(tx, {
          reviewRun: { ...firstReview, userId: "another-fixture-owner" },
          pointer: firstReview.task.delegation as never,
          reviewText: "A different owner cannot accept this phase.",
        }),
      ),
    ).toEqual({});
    expect(
      await prisma.$transaction((tx) =>
        settleDelegationReview(tx, {
          reviewRun: firstReview,
          pointer: { kind: "review", taskRef: f.taskId, attempt: 0 },
          reviewText: "A review without its phase identity cannot advance the assignment.",
        }),
      ),
    ).toEqual({});
    await expect(
      prisma.$transaction(async (tx) => {
        await settleDelegationReview(tx, {
          reviewRun: firstReview,
          pointer: firstReview.task.delegation as never,
          reviewText: "The first comparison is supported by both sources.",
        });
        throw new Error("interrupt before phase commit");
      }),
    ).rejects.toThrow("interrupt before phase commit");
    expect((await stored(f.taskId)).phases?.index).toBe(0);
    expect(await prisma.run.count({ where: { spaceId: f.s.id } })).toBe(count);
    const first = await reviewPhase(f, firstReview);
    expect(first.retryRunId).toBeTruthy();
    expect(await stored(f.taskId)).toMatchObject({
      state: "queued",
      assignment: original.assignment,
      budget: { maxRuns: 8, usedRuns: 4 },
      phases: { index: 1 },
    });
    const secondTask = await prisma.task.findUniqueOrThrow({ where: { id: f.taskId } });
    expect(secondTask.prompt).toContain("reviewed_phase_evidence");
    expect(secondTask.prompt).toContain("lower cost");
    expect((await stored(f.taskId)).deadline).toBe(original.deadline);
    expect(await delegationRunStillAllowed(prisma, f.childId)).toBe(false);
    const old = await prisma.run.findUniqueOrThrow({ where: { id: f.childId } });
    expect(
      await messageBot(
        f.deps,
        old,
        f.s.analyst,
        {
          bot_id: f.s.main.id,
          intent: "result",
          message: "A second old result.",
          deliveryKey: "late-old-result",
        },
        { allowTerminalSource: true },
      ),
    ).toMatchObject({ ok: true, ignored: true });
    const secondReview = await returnPhase(f, first.retryRunId!);
    // An old review may arrive while the next phase is reviewing: its phase identity must fence it out.
    expect(
      await prisma.$transaction((tx) =>
        settleDelegationReview(tx, {
          reviewRun: firstReview,
          pointer: firstReview.task.delegation as never,
          reviewText: "A late review cannot skip a phase.",
        }),
      ),
    ).toEqual({});
    expect((await stored(f.taskId)).phases?.index).toBe(1);
    const second = await reviewPhase(f, secondReview);
    const finalReview = await returnPhase(f, second.retryRunId!);
    expect(await reviewPhase(f, finalReview)).toEqual({});
    const final = await stored(f.taskId);
    expect(final).toMatchObject({
      state: "completed",
      budget: { maxRuns: 8, usedRuns: 7 },
      review: { outcome: "verified" },
      phases: { index: 2 },
    });
    expect(final.phases?.completed).toHaveLength(2);
    expect(final.deadline).toBe(original.deadline);
    expect(await prisma.run.count({ where: { taskId: f.taskId } })).toBe(3);
  });

  it("keeps a partial phase open and does not mistake the reviewer's claim for evidence", async () => {
    const f = await phaseAssignment();
    const review = await returnPhase(
      f,
      f.childId,
      "Recommend A from docs/a.md; the other document was unavailable.",
      1,
    );
    expect(
      await reviewPhase(f, review, "The task is complete based on the available document."),
    ).toEqual({});
    expect(await stored(f.taskId)).toMatchObject({
      state: "needs_input",
      review: { outcome: "partial" },
      phases: { index: 0 },
    });
    expect(await prisma.run.count({ where: { taskId: f.taskId } })).toBe(1);
  });

  it.each(["instructions", "cancelled-source", "deleted-source", "membership"])(
    "stops an already queued phase after %s changes",
    async (change) => {
      const f = await phaseAssignment();
      const next = await reviewPhase(f, await returnPhase(f, f.childId));
      if (change === "instructions")
        await prisma.bot.update({
          where: { id: f.s.main.id },
          data: { instructions: "Only check costs; do not proceed with the recommendation." },
        });
      if (change === "cancelled-source")
        await prisma.run.update({ where: { id: f.root.id }, data: { status: "cancelled" } });
      if (change === "deleted-source") await prisma.message.delete({ where: { id: f.source.id } });
      if (change === "membership")
        await prisma.spaceMember.delete({
          where: { spaceId_userId: { spaceId: f.s.id, userId: f.s.id } },
        });
      expect(await delegationRunStillAllowed(prisma, next.retryRunId!)).toBe(false);
      expect((await delegationRunGate(prisma, next.retryRunId!)).allowed).toBe(false);
      expect(await stored(f.taskId)).toMatchObject({
        state: "cancelled",
        stopReason: "authorization_changed",
      });
    },
  );

  it("recognizes cancellation of the current phase despite completed earlier phase runs", async () => {
    const f = await phaseAssignment();
    const next = await reviewPhase(f, await returnPhase(f, f.childId));
    await prisma.run.update({ where: { id: next.retryRunId! }, data: { status: "cancelled" } });
    await reconcileDelegations({ prisma });
    expect(await stored(f.taskId)).toMatchObject({
      state: "cancelled",
      stopReason: "child_cancelled",
    });
    expect(await delegationRunStillAllowed(prisma, next.retryRunId!)).toBe(false);
  });

  it.each(["budget_exhausted", "deadline_passed"])(
    "retains the reviewed result but never resets %s to start another phase",
    async (reason) => {
      const f = await phaseAssignment();
      const review = await returnPhase(f, f.childId);
      const current = await stored(f.taskId);
      await prisma.task.update({
        where: { id: f.taskId },
        data: {
          delegation: {
            ...current,
            ...(reason === "budget_exhausted"
              ? { budget: { ...current.budget, usedRuns: current.budget.maxRuns } }
              : { deadline: new Date(Date.now() - 1000).toISOString() }),
          } as never,
        },
      });
      expect(await reviewPhase(f, review)).toEqual({});
      expect(await stored(f.taskId)).toMatchObject({
        state: "failed",
        stopReason: reason,
        phases: { index: 0 },
        review: { outcome: "verified" },
      });
      expect(await prisma.run.count({ where: { taskId: f.taskId } })).toBe(1);
    },
  );

  it("keeps a genuine missing-input blocker open without advancing or retrying", async () => {
    const f = await phaseAssignment();
    const review = await returnPhase(
      f,
      f.childId,
      "The second source requires access that is unavailable; I cannot verify its costs.",
      1,
      "blocker",
    );
    expect(
      await reviewPhase(
        f,
        review,
        "Access to the second source is needed to finish this comparison.",
      ),
    ).toEqual({});
    expect(await stored(f.taskId)).toMatchObject({
      state: "needs_input",
      review: { outcome: "blocked" },
      phases: { index: 0 },
    });
    expect(await prisma.run.count({ where: { taskId: f.taskId } })).toBe(1);
  });

  it("starts phases from a background work run using the saved user authorization", async () => {
    const f = await phaseAssignment(true);
    expect(f.root).toMatchObject({ trigger: "work", sourceMessageId: null });
    expect((await stored(f.taskId)).origin).toMatchObject({
      sourceMessageId: f.source.id,
      workId: f.root.workId,
      workVersion: f.root.workVersion,
    });
    const next = await reviewPhase(f, await returnPhase(f, f.childId));
    expect(next.retryRunId).toBeTruthy();
    expect(await delegationRunStillAllowed(prisma, next.retryRunId!)).toBe(true);
  });

  it.each(["paused", "cancelled", "version"])(
    "fences phased helpers after their originating work is %s",
    async (change) => {
      const f = await phaseAssignment(true);
      const next = await reviewPhase(f, await returnPhase(f, f.childId));
      const current = await stored(f.taskId);
      await prisma.assistantWork.update({
        where: { id: current.origin!.workId! },
        data: change === "version" ? { version: { increment: 1 } } : { status: change },
      });
      expect(await delegationRunStillAllowed(prisma, next.retryRunId!)).toBe(false);
      await reconcileDelegations({ prisma });
      expect(await stored(f.taskId)).toMatchObject({
        state: "cancelled",
        stopReason: "authorization_changed",
      });
    },
  );

  it("gives different bots separate leases on one Team computer and serializes one bot", async () => {
    const s = await setup();
    const a1 = await acquireComputerExecutionLease(prisma, {
      computerId: s.computer.id,
      botId: s.main.id,
      runId: "main-1",
    });
    const b1 = await acquireComputerExecutionLease(prisma, {
      computerId: s.computer.id,
      botId: s.analyst.id,
      runId: "analyst-1",
    });
    expect(a1).not.toBeNull();
    expect(b1).not.toBeNull();
    await expect(
      acquireComputerExecutionLease(prisma, {
        computerId: s.computer.id,
        botId: s.main.id,
        runId: "main-2",
      }),
    ).rejects.toBeInstanceOf(ComputerBusyError);
    await releaseComputerExecutionLease(prisma, a1);
    const a2 = await acquireComputerExecutionLease(prisma, {
      computerId: s.computer.id,
      botId: s.main.id,
      runId: "main-2",
    });
    expect(a2?.fence).toBeGreaterThan(a1!.fence);
    expect(
      await prisma.computerExecutionLease.count({
        where: { computerId: s.computer.id, expiresAt: { gt: new Date() } },
      }),
    ).toBe(2);
  });

  it("commits the stored review and the answer together or not at all", async () => {
    const s = await setup();
    const now = new Date();
    const child = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "completed",
    });
    const reviewingRecord: DelegationRecord = {
      ...transitionDelegation(
        transitionDelegation(record(s, now), "working", now),
        "reviewing",
        now,
      ),
      outcome: {
        intent: "result",
        text: "A per docs/a.md, docs/b.md.",
        messageId: "result",
        childRunId: child.run.id,
        readCount: 2,
        receivedAt: now.toISOString(),
      },
      checks: delegationResultChecks({
        intent: "result",
        text: "A per docs/a.md, docs/b.md.",
        sources: ["docs/a.md", "docs/b.md"],
        readCount: 2,
      }),
    };
    await prisma.task.update({
      where: { id: child.task.id },
      data: { delegation: reviewingRecord as never },
    });
    const review = await run(s, {
      botId: s.main.id,
      threadId: s.personal.id,
      status: "running",
      delegation: { kind: "review", taskRef: child.task.id, attempt: 0 },
    });
    const attempt = await prisma.attempt.create({
      data: { runId: review.run.id, fence: 1, status: "running" },
    });
    const input = {
      spaceId: s.id,
      threadId: s.personal.id,
      botId: s.main.id,
      runId: review.run.id,
      taskId: review.task.id,
      attemptId: attempt.id,
      leaseOwner: "worker-1",
      leaseFence: 1,
      outcome: "completed" as const,
      blocks: [{ kind: "text" as const, text: "Go with A." }],
    };
    const pointer = { kind: "review" as const, taskRef: child.task.id, attempt: 0 };
    const reviewRun = {
      id: review.run.id,
      spaceId: s.id,
      userId: s.id,
      interactionMode: "personal",
    };
    await expect(
      finalizeRun(prisma, {
        ...input,
        withinTransaction: async (tx) => {
          await settleDelegationReview(tx, { reviewRun, pointer, reviewText: "Go with A." });
          throw new Error("crash after review, before delivery");
        },
      }),
    ).rejects.toThrow("crash after review");
    expect((await stored(child.task.id)).state).toBe("reviewing");
    expect(await prisma.message.count({ where: { threadId: s.personal.id } })).toBe(0);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: review.run.id } })).status).toBe(
      "running",
    );

    const done = await finalizeRun(prisma, {
      ...input,
      withinTransaction: async (tx) => {
        await settleDelegationReview(tx, { reviewRun, pointer, reviewText: "Go with A." });
      },
    });
    expect(done).not.toBe(false);
    const settled = await stored(child.task.id);
    expect(settled.state).toBe("completed");
    expect(settled.review).toMatchObject({ outcome: "verified", summary: "Go with A." });
    expect(await prisma.message.count({ where: { threadId: s.personal.id } })).toBe(1);
    // A repeated finalize (stale worker) changes nothing.
    expect(await finalizeRun(prisma, input)).toBe(false);
    expect(await prisma.message.count({ where: { threadId: s.personal.id } })).toBe(1);
  });

  it("closes tasks whose child or review runs were cancelled and leaves live ones alone", async () => {
    const s = await setup();
    const cancelledChild = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "cancelled",
      delegation: record(s),
    });
    const liveChild = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "running",
      delegation: transitionDelegation(record(s), "working", new Date()),
    });
    const reviewed = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "completed",
    });
    const cancelledReview = await run(s, {
      botId: s.main.id,
      threadId: s.personal.id,
      status: "cancelled",
      delegation: { kind: "review", taskRef: reviewed.task.id, attempt: 0 },
    });
    await prisma.task.update({
      where: { id: reviewed.task.id },
      data: {
        delegation: {
          ...transitionDelegation(record(s), "reviewing", new Date()),
          reviewTaskIds: [cancelledReview.task.id],
        } as never,
      },
    });
    await reconcileDelegations({ prisma });
    expect(await stored(cancelledChild.task.id)).toMatchObject({
      state: "cancelled",
      stopReason: "child_cancelled",
    });
    expect((await stored(liveChild.task.id)).state).toBe("working");
    expect(await stored(reviewed.task.id)).toMatchObject({
      state: "cancelled",
      stopReason: "review_cancelled",
    });
  });

  it("checks the deadline and closed state before a delegated run reaches the model", async () => {
    const s = await setup();
    const queued = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "queued",
      delegation: record(s),
    });
    await expect(delegationRunGate(prisma, queued.run.id)).resolves.toEqual({ allowed: true });
    expect((await stored(queued.task.id)).state).toBe("working");

    const expired = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "queued",
      delegation: record(s, new Date(Date.now() - 25 * 3600_000)),
    });
    expect((await delegationRunGate(prisma, expired.run.id)).allowed).toBe(false);
    expect(await stored(expired.task.id)).toMatchObject({
      state: "failed",
      stopReason: "deadline_passed",
    });

    const superseded = await run(s, {
      botId: s.analyst.id,
      threadId: s.analystThread.id,
      status: "queued",
      delegation: transitionDelegation(record(s), "superseded", new Date(), "rework_requested"),
    });
    expect((await delegationRunGate(prisma, superseded.run.id)).allowed).toBe(false);
    const staleReview = await run(s, {
      botId: s.main.id,
      threadId: s.personal.id,
      status: "queued",
      delegation: { kind: "review", taskRef: superseded.task.id, attempt: 0 },
    });
    expect((await delegationRunGate(prisma, staleReview.run.id)).allowed).toBe(false);
  });
});
