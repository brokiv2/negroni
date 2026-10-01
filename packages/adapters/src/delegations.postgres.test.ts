import { randomUUID } from "node:crypto";
import {
  createDelegationRecord,
  type DelegationRecord,
  delegationRecord,
  delegationResultChecks,
  transitionDelegation,
} from "@rakazo/core";
import { createDb, finalizeRun, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acquireComputerExecutionLease,
  ComputerBusyError,
  releaseComputerExecutionLease,
} from "./computer-lifecycle.js";
import { delegationRunGate, reconcileDelegations, settleDelegationReview } from "./delegations.js";

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
