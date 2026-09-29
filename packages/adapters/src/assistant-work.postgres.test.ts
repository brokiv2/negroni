import { randomUUID } from "node:crypto";
import type { BackgroundJob, JobPublisher } from "@rakazo/adapter-kit";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assistantWorkRunAllowed,
  controlAssistantWork,
  createAssistantWork,
  listAssistantWork,
  reconcileAssistantWork,
  updateAssistantWork,
} from "./assistant-work.js";
import { createJobReconciler } from "./job-reconciler.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
suite("assistant work lifecycle (PostgreSQL, no model or external services)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  const users: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
    await db.pool.end();
  });
  async function setup() {
    const id = randomUUID();
    users.push(id);
    await prisma.user.create({
      data: { id, name: "Work test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Work test", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id, organizationId: id, name: "Work test", isDefault: true },
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
    const bot = await prisma.bot.create({
      data: { spaceId: id, userId: id, name: "Assistant", color: "test" },
    });
    const thread = await prisma.thread.create({
      data: { spaceId: id, userId: id, botId: bot.id, kind: "personal" },
    });
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        role: "user",
        seq: 0,
        blocks: [{ kind: "text", text: "Watch the demo build until it is ready, then report." }],
      },
    });
    const task = await prisma.task.create({
      data: {
        spaceId: id,
        userId: id,
        botId: bot.id,
        threadId: thread.id,
        prompt: "Demo",
        status: "completed",
      },
    });
    const run = await prisma.run.create({
      data: {
        spaceId: id,
        userId: id,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        sourceMessageId: message.id,
        status: "completed",
        trigger: "user",
        modelProvider: "demo",
        modelId: "fast",
      },
    });
    const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
    const jobs: JobPublisher = {
      enqueue,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const input = {
      title: "Demo build",
      objective: "Check the demo build and report once ready.",
      nextWakeAt: new Date(Date.now() + 120_000).toISOString(),
      wakeReason: "Expected completion",
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
      maxRuns: 3,
    };
    const create = () => createAssistantWork(prisma, run, input);
    const due = (workId: string) =>
      prisma.assistantWork.update({
        where: { id: workId },
        data: { nextWakeAt: new Date(Date.now() - 1000) },
      });
    const reconcile = () => reconcileAssistantWork({ prisma, jobs });
    const row = (workId: string) =>
      prisma.assistantWork.findUniqueOrThrow({ where: { id: workId } });
    const wakeRun = async (workId: string) =>
      prisma.run.findUniqueOrThrow({ where: { id: (await row(workId)).activeRunId! } });
    const settle = async (runId: string, status = "completed") =>
      prisma.run.update({ where: { id: runId }, data: { status, completedAt: new Date() } });
    return {
      id,
      run,
      input,
      create,
      due,
      reconcile,
      row,
      wakeRun,
      settle,
      enqueue,
      jobs,
      thread,
      message,
    };
  }
  it("saves explicit work idempotently with original scope and model; never wakes early", async () => {
    const h = await setup();
    const [a, b] = await Promise.all([h.create(), h.create()]);
    expect(a.id).toBe(b.id);
    await h.reconcile();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect((await h.row(a.id)).authorization).toContain("Watch the demo build");
    expect(await listAssistantWork(prisma, h.run, h.thread.id)).toHaveLength(1);
    expect(
      await listAssistantWork(prisma, { spaceId: h.id, userId: "another-owner" }, h.thread.id),
    ).toEqual([]);
  });
  it("rejects background creation and a deleted originating message", async () => {
    const h = await setup();
    await expect(
      createAssistantWork(prisma, { ...h.run, trigger: "work" }, h.input),
    ).rejects.toThrow("explicit request");
    await prisma.message.delete({ where: { id: h.message.id } });
    await expect(h.create()).rejects.toThrow("no longer available");
  });
  it("claims exactly once under concurrent reconcilers and preserves origin and model", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await Promise.all([h.reconcile(), h.reconcile()]);
    const run = await h.wakeRun(w.id);
    expect(run).toMatchObject({
      threadId: h.thread.id,
      trigger: "work",
      modelProvider: "demo",
      modelId: "fast",
      interactionMode: "personal",
    });
    expect((await h.row(w.id)).runCount).toBe(1);
    expect(await assistantWorkRunAllowed(prisma, run.id, w.id)).toBe(true);
    expect(await prisma.run.count({ where: { workId: w.id } })).toBe(1);
  });
  it("recovers a lost queue publication from the same persisted run", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    h.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(h.reconcile()).rejects.toThrow("queue unavailable");
    const run = await h.wakeRun(w.id);
    await createJobReconciler({ prisma, jobs: h.jobs }).reconcileOnce();
    expect(h.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: run.id } }),
    );
    expect(await prisma.run.count({ where: { workId: w.id } })).toBe(1);
  });
  it("persists a later check, waits for this run to end, and catches up only once", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    await updateAssistantWork(prisma, run, {
      workId: w.id,
      version: 1,
      status: "waiting",
      nextWakeAt: new Date(Date.now() + 120_000).toISOString(),
      wakeReason: "No change",
      result: "Still processing",
    });
    await h.due(w.id);
    await h.reconcile();
    expect((await h.row(w.id)).runCount).toBe(1);
    await h.settle(run.id);
    await h.reconcile();
    await h.reconcile();
    expect((await h.row(w.id)).runCount).toBe(2);
    expect((await h.wakeRun(w.id)).id).not.toBe(run.id);
  });
  it("cancellation fences a running worker, rejects late writes and never resumes", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    await controlAssistantWork(prisma, h.run, { workId: w.id, version: 1, action: "cancel" });
    expect(await assistantWorkRunAllowed(prisma, run.id, w.id)).toBe(false);
    await expect(
      updateAssistantWork(prisma, run, {
        workId: w.id,
        version: 1,
        status: "completed",
        wakeReason: "done",
        result: "Late result",
      }),
    ).rejects.toThrow("changed");
    await expect(
      controlAssistantWork(prisma, h.run, { workId: w.id, version: 2, action: "resume" }),
    ).rejects.toThrow();
    await expect(
      controlAssistantWork(prisma, h.run, { workId: w.id, version: 2, action: "pause" }),
    ).rejects.toThrow();
    await h.reconcile();
    expect((await h.row(w.id)).status).toBe("cancelled");
  });
  it("requires current version and owner; pause and explicit resume use a new fence", async () => {
    const h = await setup();
    const w = await h.create();
    await expect(
      controlAssistantWork(
        prisma,
        { spaceId: h.id, userId: "other" },
        { workId: w.id, version: 1, action: "pause" },
      ),
    ).rejects.toThrow("not found");
    await controlAssistantWork(prisma, h.run, { workId: w.id, version: 1, action: "pause" });
    await expect(
      controlAssistantWork(prisma, h.run, { workId: w.id, version: 1, action: "resume" }),
    ).rejects.toThrow("changed");
    await h.reconcile();
    expect((await h.row(w.id)).runCount).toBe(0);
    await controlAssistantWork(prisma, h.run, { workId: w.id, version: 2, action: "resume" });
    await h.reconcile();
    expect((await h.wakeRun(w.id)).workVersion).toBe(3);
  });
  it("never equates run completion with achieving the objective", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    await h.settle((await h.wakeRun(w.id)).id);
    await h.reconcile();
    expect((await h.row(w.id)).status).toBe("needs_input");
    expect((await h.row(w.id)).nextWakeAt).toBeNull();
  });
  it.each(["completed", "expired"])("rejects late updates from a %s attempt", async (reason) => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    if (reason === "completed") await h.settle(run.id);
    else
      await prisma.assistantWork.update({ where: { id: w.id }, data: { deadline: new Date(0) } });
    await expect(
      updateAssistantWork(prisma, run, {
        workId: w.id,
        version: 1,
        status: "completed",
        wakeReason: "Late reply",
        result: "Stale result",
      }),
    ).rejects.toThrow();
    expect((await h.row(w.id)).lastResult).toBe("");
  });
  it("verified completion stays terminal and does not schedule another check", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    await expect(
      updateAssistantWork(prisma, run, {
        workId: w.id,
        version: 1,
        status: "completed",
        wakeReason: "done",
      }),
    ).rejects.toThrow();
    await updateAssistantWork(prisma, run, {
      workId: w.id,
      version: 1,
      status: "completed",
      wakeReason: "Verified build",
      result: "Demo API reports ready; artifact returned.",
    });
    await h.settle(run.id);
    await h.reconcile();
    expect((await h.row(w.id)).status).toBe("completed");
    await expect(
      controlAssistantWork(prisma, h.run, { workId: w.id, version: 1, action: "pause" }),
    ).rejects.toThrow();
    expect((await h.row(w.id)).runCount).toBe(1);
  });
  it.each(["deadline", "allowance"])(
    "pauses %s exhaustion before calling a model",
    async (reason) => {
      const h = await setup();
      const w = await h.create();
      await h.due(w.id);
      await prisma.assistantWork.update({
        where: { id: w.id },
        data: reason === "deadline" ? { deadline: new Date(0) } : { runCount: 3 },
      });
      await h.reconcile();
      expect((await h.row(w.id)).status).toBe("paused");
      expect(h.enqueue).not.toHaveBeenCalled();
    },
  );
  it("clearing the originating messages removes queued work and fences the old run", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    await prisma.message.deleteMany({ where: { threadId: h.thread.id } });
    expect(await prisma.assistantWork.findUnique({ where: { id: w.id } })).toBeNull();
    expect(await assistantWorkRunAllowed(prisma, run.id, w.id)).toBe(false);
  });
  it("defers a due check while the original chat is busy", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await prisma.run.update({ where: { id: h.run.id }, data: { status: "running" } });
    await h.reconcile();
    expect((await h.row(w.id)).runCount).toBe(0);
    await h.settle(h.run.id);
    await h.reconcile();
    expect((await h.row(w.id)).runCount).toBe(1);
  });
  it("revoking space membership fences an in-flight run and pauses future work", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    await prisma.spaceMember.deleteMany({ where: { spaceId: h.id } });
    expect(await assistantWorkRunAllowed(prisma, run.id, w.id)).toBe(false);
    await h.reconcile();
    expect((await h.row(w.id)).status).toBe("paused");
    expect((await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "cancelled",
    );
  });
  it("expires an active run rather than letting it continue after its deadline", async () => {
    const h = await setup();
    const w = await h.create();
    await h.due(w.id);
    await h.reconcile();
    const run = await h.wakeRun(w.id);
    await prisma.assistantWork.update({ where: { id: w.id }, data: { deadline: new Date(0) } });
    expect(await assistantWorkRunAllowed(prisma, run.id, w.id)).toBe(false);
    await h.reconcile();
    expect((await h.row(w.id)).status).toBe("paused");
  });
});
