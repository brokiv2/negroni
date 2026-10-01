import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import {
  ComposioEmulator,
  createJobReconciler,
  EmailEmulator,
  FakeSandboxProvider,
  normalizeWorkspacePath,
  reconcileDelegations,
  resolveBotWorkspacePath,
} from "@rakazo/adapters";
import { type DelegationRecord, delegationRecord, transitionDelegation } from "@rakazo/core";
import { createThreadEvents, type PrismaClient, sendUserMessage } from "@rakazo/db";
import { afterAll, beforeAll, describe, it } from "vitest";
import { type AppHandles, createApp } from "./app.js";

/**
 * Async specialist delegation through the real executor, queue and Postgres state, with
 * a fake runtime. Covers the first MVP scenario and the recovery seams around it.
 */
const scenario =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

type Handler = (request: AgentRunRequest, call: number) => AsyncIterable<unknown>;
type Fixture = Awaited<ReturnType<typeof seed>>;

let h: AppHandles;
let p: PrismaClient;
let dataDir: string;
let priorEnv: NodeJS.ProcessEnv;
const handlers = new Map<string, Handler>();
const calls = new Map<string, number>();
const prompts: Array<{ botId: string; runId: string; prompt: string }> = [];

function barrier() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

async function waitFor<T>(
  label: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function seed() {
  const id = randomUUID();
  await p.user.create({
    data: { id, name: "Delegation", email: `${id}@example.test`, emailVerified: true },
  });
  await p.organization.create({
    data: { id, name: "Delegation", slug: id, createdAt: new Date() },
  });
  await p.space.create({ data: { id, organizationId: id, name: "Delegation", isDefault: true } });
  await p.member.create({
    data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
  });
  await p.spaceMember.upsert({
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
  // One shared Team computer: the main assistant and the specialist hold separate leases.
  const computer = await p.computer.create({
    data: {
      spaceId: id,
      userId: id,
      scopeKey: `delegation-${id}`,
      homeKey: `delegation-${id}`,
      kind: "fake",
      state: "stopped",
    },
  });
  const main = await p.bot.create({
    data: { spaceId: id, userId: id, name: "Assistant", color: "test", computerId: computer.id },
  });
  const analyst = await p.bot.create({
    data: {
      spaceId: id,
      userId: id,
      name: "Analyst",
      title: "Document analyst",
      color: "test",
      computerId: computer.id,
      parentBotId: main.id,
    },
  });
  await p.thread.create({ data: { spaceId: id, userId: id, botId: main.id, kind: "team" } });
  await p.thread.create({ data: { spaceId: id, userId: id, botId: analyst.id, kind: "team" } });
  const personal = await p.thread.create({
    data: { spaceId: id, userId: id, botId: main.id, kind: "personal" },
  });
  return { id, computerId: computer.id, mainId: main.id, analystId: analyst.id, personal };
}

async function cleanup(fixture: Fixture) {
  await p.organization.deleteMany({ where: { id: fixture.id } });
  await p.user.deleteMany({ where: { id: fixture.id } });
}

/** Put the two fixture documents where the specialist's read_file resolves them. */
function seedDocuments(analystId: string) {
  const sandbox = h.sandbox as FakeSandboxProvider;
  assert.ok(sandbox instanceof FakeSandboxProvider);
  for (const box of sandbox.boxes.values()) {
    for (const [file, text] of [
      ["docs/a.md", "Plan A: costs 10, ships in May."],
      ["docs/b.md", "Plan B: costs 14, ships in March."],
    ] as const) {
      box.files.set(normalizeWorkspacePath(resolveBotWorkspacePath("team", analystId, file)), {
        content: new TextEncoder().encode(text),
        executable: false,
      });
    }
  }
}

async function say(fixture: Fixture, text: string) {
  const sent = await sendUserMessage(p, {
    spaceId: fixture.id,
    threadId: fixture.personal.id,
    botId: fixture.mainId,
    userId: fixture.id,
    blocks: [{ kind: "text", text }],
    prompt: text,
    trigger: "user",
  });
  assert.ok(sent.runId);
  return sent.runId;
}

async function delegations(fixture: Fixture) {
  const rows = await p.task.findMany({
    where: { spaceId: fixture.id, botId: fixture.analystId },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((row) => {
    const record = delegationRecord(row.delegation);
    return record ? [{ taskId: row.id, record }] : [];
  });
}

async function personalBotTexts(fixture: Fixture) {
  const messages = await p.message.findMany({
    where: { threadId: fixture.personal.id, role: "bot" },
    orderBy: { seq: "asc" },
    select: { blocks: true },
  });
  return messages.flatMap((message) =>
    (message.blocks as Array<{ kind: string; text?: string }>)
      .filter((block) => block.kind === "text" && block.text)
      .map((block) => block.text!),
  );
}

function reconciler() {
  return createJobReconciler({
    prisma: p,
    jobs: h.jobs,
    events: createThreadEvents(p),
    reconcileDelegations: () => reconcileDelegations({ prisma: p }),
  });
}

async function updateDelegation(
  taskId: string,
  change: (record: DelegationRecord) => DelegationRecord,
) {
  const row = await p.task.findUniqueOrThrow({ where: { id: taskId } });
  const record = delegationRecord(row.delegation);
  assert.ok(record);
  await p.task.update({ where: { id: taskId }, data: { delegation: change(record) as never } });
}

const REQUEST =
  "Compare docs/a.md and docs/b.md and recommend one plan with sources. Read only; reply with the recommendation, the evidence per source and what you could not verify.";
const RESULT =
  "Recommend Plan A: docs/a.md shows cost 10 vs 14 in docs/b.md; B ships two months earlier. Not verified: delivery risk.";

function* delegate(request: AgentRunRequest, analystId: string, message = REQUEST) {
  yield {
    type: "tool",
    name: "message_bot",
    args: { bot_id: analystId, message, sources: ["docs/a.md", "docs/b.md"] },
    executionId: `${request.runId}:delegate`,
  };
  yield { type: "done", text: "I asked Analyst to compare the two plans." };
}

async function* readAndAnswer(request: AgentRunRequest, analystId: string, text = RESULT) {
  seedDocuments(analystId);
  for (const file of ["docs/a.md", "docs/b.md"]) {
    yield {
      type: "tool",
      name: "read_file",
      args: { path: file },
      executionId: `${request.runId}:${file}`,
    };
  }
  yield { type: "done", text };
}

scenario("async specialist delegation (PostgreSQL, fake runtime)", () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "delegation-executor-"));
    priorEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: priorEnv.DATABASE_URL,
      WAKEUP_DRIVER: "memory",
      SANDBOX_PROVIDER: "fake",
      AGENT_RUNTIME: "scripted",
      COMPOSIO_API_KEY: "",
      BETTER_AUTH_SECRET: "isolated-delegation-secret-32chars!",
      ENCRYPTION_KEY: "isolated-delegation-encryption-32ch",
      SCREEN_PROXY_SECRET: "isolated-delegation-screen-32chars!",
      BETTER_AUTH_URL: "http://127.0.0.1:3198",
      WEB_ORIGIN: "http://127.0.0.1:5198",
      API_HOST: "127.0.0.1",
      API_PORT: "3198",
      API_URL: "http://127.0.0.1:3198",
      DATA_DIR: dataDir,
      SIGNUPS_ENABLED: "true",
      CI: "1",
    });
    h = await createApp({ composio: new ComposioEmulator(), email: new EmailEmulator() });
    p = h.prisma;
    const run: AgentRuntime["run"] = async function* (request) {
      const call = (calls.get(request.botId) ?? 0) + 1;
      calls.set(request.botId, call);
      prompts.push({ botId: request.botId, runId: request.runId, prompt: request.prompt });
      const handler = handlers.get(request.botId);
      if (!handler) throw new Error(`no fake handler for ${request.botId}`);
      yield* handler(request, call) as AsyncIterable<never>;
    };
    h.runtime.run = run;
  }, 60_000);

  afterAll(async () => {
    await h?.stop();
    for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
    Object.assign(process.env, priorEnv);
    await rm(dataDir, { recursive: true, force: true });
  });

  it("delegates two documents, stays available while the child runs, and lands one reviewed answer", async () => {
    const fixture = await seed();
    const hold = barrier();
    let childStarted = false;
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        assert.ok(request.prompt.includes(REQUEST), "review sees the original assignment");
        assert.ok(request.prompt.includes("Recommend Plan A"), "review sees the child evidence");
        assert.ok(!request.prompt.includes("FAILED"), "deterministic checks passed");
        yield { type: "done", text: "Go with Plan A: it is cheaper (10 vs 14); B ships sooner." };
        return;
      }
      if (request.prompt.startsWith("Compare")) {
        yield* delegate(request, fixture.analystId);
        return;
      }
      yield { type: "done", text: "Lisbon is two hours behind Moscow." };
    });
    handlers.set(fixture.analystId, async function* (request) {
      childStarted = true;
      await hold.opened;
      yield* readAndAnswer(request, fixture.analystId);
    });
    try {
      const first = await say(fixture, "Compare the two plans in docs/a.md and docs/b.md.");
      await h.executor.continueRun(first, "test-worker");
      // The root turn is terminal right after the async dispatch.
      assert.equal((await p.run.findUniqueOrThrow({ where: { id: first } })).status, "completed");
      const [task] = await delegations(fixture);
      assert.ok(task);
      assert.equal(task.record.assignment, REQUEST);
      assert.deepEqual(task.record.sources, ["docs/a.md", "docs/b.md"]);
      assert.equal(task.record.requester.threadId, fixture.personal.id);
      await waitFor("child running", async () => childStarted);
      const child = await p.run.findFirstOrThrow({ where: { taskId: task.taskId } });
      assert.equal(child.status, "running");

      // A new, unrelated question is answered before the specialist is released.
      const second = await say(fixture, "What time is it in Lisbon vs Moscow?");
      await h.executor.continueRun(second, "test-worker");
      assert.equal((await p.run.findUniqueOrThrow({ where: { id: second } })).status, "completed");
      assert.equal((await p.run.findUniqueOrThrow({ where: { id: child.id } })).status, "running");
      assert.ok((await personalBotTexts(fixture)).includes("Lisbon is two hours behind Moscow."));
      const leases = await p.computerExecutionLease.findMany({
        where: { computerId: fixture.computerId },
      });
      assert.ok(leases.some((lease) => lease.botId === fixture.analystId));

      hold.release();
      const done = await waitFor("reviewed completion", async () => {
        const [current] = await delegations(fixture);
        return current?.record.state === "completed" ? current : null;
      });
      const review = done.record.review;
      assert.ok(review);
      assert.equal(review.outcome, "verified");
      assert.equal(review.taskRef, done.taskId);
      assert.equal(review.summary, "Go with Plan A: it is cheaper (10 vs 14); B ships sooner.");
      assert.ok(review.evidenceRefs.includes(`run:${child.id}`));
      assert.ok(review.evidenceRefs.includes("source:docs/b.md"));
      assert.ok(review.checks.length >= 5 && review.checks.every((check) => check.passed));
      assert.ok(review.reviewedAt && review.reviewRunId);
      assert.equal(done.record.outcome?.readCount, 2);
      assert.deepEqual(
        done.record.history.map((step) => step.state),
        ["queued", "working", "reviewing", "completed"],
      );

      // The reviewed answer lands once in Personal; the raw result is never posted by the bot.
      const texts = await personalBotTexts(fixture);
      assert.equal(texts.filter((text) => text.startsWith("Go with Plan A")).length, 1);
      assert.ok(!texts.some((text) => text.includes("Recommend Plan A")));
      assert.ok(!texts.some((text) => text.startsWith("Update from")));

      // Recovery sweeps after the fact deliver nothing twice.
      const sweeper = reconciler();
      await sweeper.reconcileOnce();
      await sweeper.reconcileOnce();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = await personalBotTexts(fixture);
      assert.equal(after.filter((text) => text.startsWith("Go with Plan A")).length, 1);
      assert.equal(
        await p.task.count({
          where: {
            threadId: fixture.personal.id,
            delegation: { path: ["kind"], equals: "review" },
          },
        }),
        1,
      );
    } finally {
      hold.release();
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("keeps two concurrent requests on separate task correlations", async () => {
    const fixture = await seed();
    const hold = barrier();
    const reviews: string[] = [];
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        const which = request.prompt.includes("pricing") ? "pricing" : "timeline";
        reviews.push(which);
        assert.ok(request.prompt.includes(`Recommend on ${which}`));
        yield { type: "done", text: `Reviewed ${which}.` };
        return;
      }
      const which = request.prompt.includes("pricing") ? "pricing" : "timeline";
      yield* delegate(request, fixture.analystId, `${REQUEST} Focus: ${which}.`);
    });
    handlers.set(fixture.analystId, async function* (request) {
      await hold.opened;
      const which = request.prompt.includes("Focus: pricing") ? "pricing" : "timeline";
      yield* readAndAnswer(
        request,
        fixture.analystId,
        `Recommend on ${which}: see docs/a.md and docs/b.md.`,
      );
    });
    try {
      const pricing = await say(fixture, "Compare pricing in the two plans.");
      await h.executor.continueRun(pricing, "test-worker");
      const timeline = await say(fixture, "Compare timeline in the two plans.");
      await h.executor.continueRun(timeline, "test-worker");
      const open = await delegations(fixture);
      assert.equal(open.length, 2);
      assert.notEqual(open[0]!.taskId, open[1]!.taskId);
      assert.notEqual(open[0]!.record.requester.runId, open[1]!.record.requester.runId);
      hold.release();
      const settled = await waitFor("both reviewed", async () => {
        const rows = await delegations(fixture);
        return rows.every((row) => row.record.state === "completed") ? rows : null;
      });
      assert.deepEqual(reviews.sort(), ["pricing", "timeline"]);
      for (const row of settled) {
        const which = row.record.assignment.includes("pricing") ? "pricing" : "timeline";
        assert.equal(row.record.review?.summary, `Reviewed ${which}.`);
        assert.ok(row.record.outcome?.text.includes(`Recommend on ${which}`));
      }
    } finally {
      hold.release();
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("stores an incomplete review for an empty answer, retries once, then stops without saying done", async () => {
    const fixture = await seed();
    let reviewCalls = 0;
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        reviewCalls += 1;
        if (reviewCalls === 2) assert.ok(request.prompt.includes("earlier review"));
        yield { type: "done" };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, (request) => readAndAnswer(request, fixture.analystId));
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const stopped = await waitFor("review stopped", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "failed" ? row : null;
      });
      assert.equal(reviewCalls, 2);
      assert.equal(stopped.record.stopReason, "review_incomplete");
      assert.equal(stopped.record.reviewAttempts, 2);
      assert.equal(stopped.record.review?.outcome, "incomplete");
      const texts = await personalBotTexts(fixture);
      assert.ok(!texts.some((text) => text.includes("Recommend Plan A")));
      assert.ok(!texts.some((text) => /^done\.?$/i.test(text.trim())));
      assert.ok(texts.some((text) => text.includes("isn't marked done")));
    } finally {
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("reviews a false done as partial and never as verified", async () => {
    const fixture = await seed();
    let reviewPrompt = "";
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        reviewPrompt = request.prompt;
        yield {
          type: "done",
          text: "Analyst said it was done but showed nothing, so no pick yet.",
        };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, async function* () {
      yield { type: "done", text: "Done." };
    });
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const reviewed = await waitFor("false done reviewed", async () => {
        const [row] = await delegations(fixture);
        return row?.record.review ? row : null;
      });
      assert.equal(reviewed.record.review?.outcome, "partial");
      assert.match(reviewPrompt, /FAILED: The result only claims completion/);
      assert.match(reviewPrompt, /FAILED: Not referenced: docs\/a\.md, docs\/b\.md\./);
      assert.ok(
        reviewed.record.review?.limitations.some((line) => line.includes("0 successful read")),
      );
    } finally {
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("treats status as progress and a failed child as a blocker", async () => {
    const fixture = await seed();
    const seen: string[] = [];
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("progress update")) {
        seen.push("status");
        yield { type: "done" };
        return;
      }
      if (request.prompt.includes("could not finish")) {
        seen.push("blocker");
        assert.ok(request.prompt.includes(REQUEST));
        yield { type: "done", text: "Analyst hit an error reading the plans; I can retry later." };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, async function* (request) {
      yield {
        type: "tool",
        name: "message_bot",
        args: { bot_id: fixture.mainId, message: "Opened docs/a.md.", intent: "status" },
        executionId: `${request.runId}:status`,
      };
      throw new Error("fixture reader crashed");
    });
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const settled = await waitFor("blocker reviewed", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "failed" && row.record.review ? row : null;
      });
      assert.equal(settled.record.lastStatus?.text, "Opened docs/a.md.");
      assert.equal(settled.record.outcome?.intent, "blocker");
      assert.equal(settled.record.outcome?.failed, true);
      assert.equal(settled.record.review?.outcome, "blocked");
      assert.ok(!settled.record.history.some((step) => step.state === "completed"));
      await waitFor("status wake ran", async () => seen.includes("status"));
      assert.ok(seen.includes("blocker"));
    } finally {
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("ignores a late result for a cancelled task and a duplicate result", async () => {
    const fixture = await seed();
    const hold = barrier();
    let reviews = 0;
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        reviews += 1;
        yield { type: "done", text: "Reviewed." };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, async function* (request) {
      await hold.opened;
      seedDocuments(fixture.analystId);
      yield {
        type: "tool",
        name: "message_bot",
        args: { bot_id: fixture.mainId, message: RESULT, intent: "result" },
        executionId: `${request.runId}:result-1`,
      };
      yield {
        type: "tool",
        name: "message_bot",
        args: { bot_id: fixture.mainId, message: `${RESULT} (again)`, intent: "result" },
        executionId: `${request.runId}:result-2`,
      };
      yield { type: "done", text: RESULT };
    });
    try {
      // Duplicate: two explicit results and the automatic one yield one review.
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      hold.release();
      await waitFor("first reviewed", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "completed";
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(reviews, 1);

      // Late: the task is cancelled while the child is still working.
      const late = barrier();
      handlers.set(fixture.analystId, async function* (request) {
        await late.opened;
        yield* readAndAnswer(request, fixture.analystId);
      });
      await h.executor.continueRun(await say(fixture, "Compare again."), "test-worker");
      const [, second] = await waitFor("second delegation", async () => {
        const rows = await delegations(fixture);
        return rows.length === 2 && rows[1]!.record.state === "working" ? rows : null;
      });
      await updateDelegation(second!.taskId, (record) =>
        transitionDelegation(record, "cancelled", new Date(), "child_cancelled"),
      );
      late.release();
      const childRun = await waitFor("late child returned", async () => {
        const run = await p.run.findFirst({ where: { taskId: second!.taskId } });
        return run?.botOutcomeReturnedAt ? run : null;
      });
      assert.equal(childRun.status, "completed");
      const [, after] = await delegations(fixture);
      assert.equal(after!.record.state, "cancelled");
      assert.equal(after!.record.outcome, undefined);
      assert.equal(reviews, 1);
    } finally {
      hold.release();
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("supersedes a reviewed task with one focused rework that shares its allowance", async () => {
    const fixture = await seed();
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>") && request.prompt.includes("Redo")) {
        yield { type: "done", text: "Final: Plan A, cheaper per both plans." };
        return;
      }
      if (request.prompt.includes("<original_assignment>")) {
        yield* delegate(request, fixture.analystId, "Redo with pricing detail for each plan.");
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, (request) =>
      readAndAnswer(
        request,
        fixture.analystId,
        request.prompt.includes("Redo")
          ? "Pricing: docs/a.md costs 10, docs/b.md costs 14."
          : RESULT,
      ),
    );
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const [first, rework] = await waitFor("rework reviewed", async () => {
        const rows = await delegations(fixture);
        return rows.length === 2 && rows[1]!.record.state === "completed" ? rows : null;
      });
      assert.equal(first!.record.state, "superseded");
      assert.equal(first!.record.supersededBy, rework!.taskId);
      assert.equal(first!.record.stopReason, "rework_requested");
      assert.equal(rework!.record.parentTaskRef, first!.taskId);
      assert.equal(rework!.record.budget.maxRuns, first!.record.budget.maxRuns);
      assert.equal(rework!.record.budget.usedRuns, first!.record.budget.usedRuns + 2);
      assert.equal(rework!.record.deadline, first!.record.deadline);
      const texts = await personalBotTexts(fixture);
      assert.equal(texts.filter((text) => text.startsWith("Final: Plan A")).length, 1);
    } finally {
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("stops at the task budget before reviewing and says so", async () => {
    const fixture = await seed();
    const hold = barrier();
    let reviews = 0;
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        reviews += 1;
        yield { type: "done", text: "Reviewed." };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, async function* (request) {
      await hold.opened;
      yield* readAndAnswer(request, fixture.analystId);
    });
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const [task] = await waitFor("dispatched", async () => {
        const rows = await delegations(fixture);
        return rows.length === 1 && rows[0]!.record.state === "working" ? rows : null;
      });
      await updateDelegation(task!.taskId, (record) => ({
        ...record,
        budget: { ...record.budget, usedRuns: record.budget.maxRuns },
      }));
      hold.release();
      const stopped = await waitFor("budget stop", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "failed" ? row : null;
      });
      assert.equal(stopped.record.stopReason, "budget_exhausted");
      assert.equal(reviews, 0);
      const texts = await personalBotTexts(fixture);
      assert.ok(texts.some((text) => text.includes("reached its run limit")));
      assert.ok(!texts.some((text) => text.includes("Recommend Plan A")));
    } finally {
      hold.release();
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("recovers a child run whose queue publish failed after commit", async () => {
    const fixture = await seed();
    const enqueue = h.jobs.enqueue.bind(h.jobs);
    let dropped = 0;
    h.jobs.enqueue = async (job) => {
      const runId = (job.payload as { runId?: string }).runId;
      if (job.name === "run.continue" && runId && dropped === 0) {
        const run = await p.run.findUnique({ where: { id: runId } });
        if (run?.botId === fixture.analystId) {
          dropped += 1;
          throw new Error("queue unavailable");
        }
      }
      return enqueue(job);
    };
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        yield { type: "done", text: "Go with Plan A." };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, (request) => readAndAnswer(request, fixture.analystId));
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      assert.equal(dropped, 1);
      const [task] = await delegations(fixture);
      assert.equal(
        (await p.run.findFirstOrThrow({ where: { taskId: task!.taskId } })).status,
        "queued",
      );
      await reconciler().reconcileOnce();
      const done = await waitFor("recovered completion", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "completed" ? row : null;
      });
      assert.equal(done.record.review?.outcome, "verified");
      assert.equal(
        (await personalBotTexts(fixture)).filter((text) => text === "Go with Plan A.").length,
        1,
      );
    } finally {
      h.jobs.enqueue = enqueue;
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("returns a child result that missed its delivery once the reconciler runs", async () => {
    const fixture = await seed();
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        yield { type: "done", text: "Go with Plan A." };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    const hold = barrier();
    handlers.set(fixture.analystId, async function* (request) {
      await hold.opened;
      yield* readAndAnswer(request, fixture.analystId);
    });
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const [task] = await waitFor("working", async () => {
        const rows = await delegations(fixture);
        return rows[0]?.record.state === "working" ? rows : null;
      });
      // The requester is briefly unavailable, so the executor's automatic return fails.
      await p.bot.update({ where: { id: fixture.mainId }, data: { archivedAt: new Date() } });
      hold.release();
      const child = await waitFor("child completed without return", async () => {
        const run = await p.run.findFirst({ where: { taskId: task!.taskId } });
        return run?.status === "completed" && !run.botOutcomeReturnedAt ? run : null;
      });
      const [stillWorking] = await delegations(fixture);
      assert.equal(stillWorking!.record.state, "working");
      await p.bot.update({ where: { id: fixture.mainId }, data: { archivedAt: null } });
      const sweeper = reconciler();
      await sweeper.reconcileOnce();
      await sweeper.reconcileOnce();
      const done = await waitFor("reviewed after reconcile", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "completed" ? row : null;
      });
      assert.ok(done.record.review?.evidenceRefs.includes(`run:${child.id}`));
      await sweeper.reconcileOnce();
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(
        (await personalBotTexts(fixture)).filter((text) => text === "Go with Plan A.").length,
        1,
      );
    } finally {
      hold.release();
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);

  it("re-runs a review whose worker lost its lease and delivers it once", async () => {
    const fixture = await seed();
    const stuck = barrier();
    let reviewCalls = 0;
    handlers.set(fixture.mainId, async function* (request) {
      if (request.prompt.includes("<original_assignment>")) {
        reviewCalls += 1;
        if (reviewCalls === 1) await stuck.opened;
        yield { type: "done", text: `Go with Plan A (review ${reviewCalls}).` };
        return;
      }
      yield* delegate(request, fixture.analystId);
    });
    handlers.set(fixture.analystId, (request) => readAndAnswer(request, fixture.analystId));
    try {
      await h.executor.continueRun(await say(fixture, "Compare the plans."), "test-worker");
      const [task] = await waitFor("reviewing", async () => {
        const rows = await delegations(fixture);
        return rows[0]?.record.state === "reviewing" && reviewCalls === 1 ? rows : null;
      });
      const reviewTaskId = task!.record.reviewTaskIds![0]!;
      const reviewRun = await p.run.findFirstOrThrow({ where: { taskId: reviewTaskId } });
      assert.equal(reviewRun.status, "running");
      // The first worker is presumed dead: its lease expires and another worker takes over.
      await p.run.update({
        where: { id: reviewRun.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      await h.executor.continueRun(reviewRun.id, "takeover-worker");
      stuck.release();
      const done = await waitFor("reviewed once", async () => {
        const [row] = await delegations(fixture);
        return row?.record.state === "completed" ? row : null;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const answers = (await personalBotTexts(fixture)).filter((text) =>
        text.startsWith("Go with Plan A"),
      );
      assert.equal(answers.length, 1);
      assert.equal(done.record.review?.summary, answers[0]);
      assert.equal(done.record.review?.reviewRunId, reviewRun.id);
    } finally {
      stuck.release();
      handlers.clear();
      await cleanup(fixture);
    }
  }, 60_000);
});
