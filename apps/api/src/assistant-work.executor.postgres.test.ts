import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackgroundJob } from "@rakazo/adapter-kit";
import { ComposioEmulator, EmailEmulator, reconcileAssistantWork } from "@rakazo/adapters";
import { it } from "vitest";
import { createApp } from "./app.js";

const scenario = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? it : it.skip;
scenario(
  "persists a responsibility through real tool dispatch and keeps an unchanged wake silent",
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "assistant-work-executor-"));
    const priorEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: priorEnv.DATABASE_URL,
      WAKEUP_DRIVER: "memory",
      SANDBOX_PROVIDER: "fake",
      AGENT_RUNTIME: "scripted",
      COMPOSIO_API_KEY: "",
      BETTER_AUTH_SECRET: "isolated-work-executor-secret-32chars",
      ENCRYPTION_KEY: "isolated-work-encryption-32chars",
      SCREEN_PROXY_SECRET: "isolated-work-screen-secret-32chars",
      BETTER_AUTH_URL: "http://127.0.0.1:3199",
      WEB_ORIGIN: "http://127.0.0.1:5199",
      API_HOST: "127.0.0.1",
      API_PORT: "3199",
      API_URL: "http://127.0.0.1:3199",
      DATA_DIR: dataDir,
      SIGNUPS_ENABLED: "true",
      CI: "1",
    });
    const h = await createApp({ composio: new ComposioEmulator(), email: new EmailEmulator() });
    const p = h.prisma,
      id = randomUUID();
    let calls = 0;
    const input = {
      title: "Demo result",
      objective: "Check demo output until it is ready",
      nextWakeAt: new Date(Date.now() + 120000).toISOString(),
      wakeReason: "Expected demo completion",
      deadline: new Date(Date.now() + 3600000).toISOString(),
      maxRuns: 3,
    };
    h.runtime.run = async function* (request) {
      calls++;
      const work = await p.assistantWork.findFirst({ where: { threadId: request.threadId } });
      if (!work) {
        yield {
          type: "tool",
          name: "work_create",
          args: input,
          executionId: `${request.runId}:create`,
        };
        yield { type: "done", text: "I will check the demo." };
      } else {
        assert.equal(request.workload, "task");
        yield {
          type: "tool",
          name: "work_update",
          args: {
            workId: work.id,
            version: work.version,
            status: "waiting",
            nextWakeAt: new Date(Date.now() + 120000).toISOString(),
            wakeReason: "Demo unchanged",
            result: "Same source revision",
          },
          executionId: `${request.runId}:update`,
        };
        yield { type: "done", text: "NO_RESPONSE" };
      }
    };
    try {
      await p.user.create({
        data: { id, name: "Work test", email: `${id}@example.test`, emailVerified: true },
      });
      await p.organization.create({
        data: { id, name: "Work test", slug: id, createdAt: new Date() },
      });
      await p.space.create({
        data: { id, organizationId: id, name: "Work test", isDefault: true },
      });
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
      const computer = await p.computer.create({
        data: {
          spaceId: id,
          userId: id,
          scopeKey: `work-probe-${id}`,
          homeKey: `work-probe-${id}`,
          kind: "fake",
          state: "stopped",
        },
      });
      const bot = await p.bot.create({
        data: {
          spaceId: id,
          userId: id,
          name: "Assistant",
          color: "test",
          computerId: computer.id,
        },
      });
      const thread = await p.thread.create({
        data: { spaceId: id, userId: id, botId: bot.id, kind: "personal", nextMessageSeq: 1 },
      });
      const message = await p.message.create({
        data: {
          threadId: thread.id,
          role: "user",
          seq: 0,
          blocks: [{ kind: "text", text: "Check the demo until it is ready." }],
        },
      });
      const task = await p.task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          prompt: "Check demo until ready",
          status: "queued",
        },
      });
      const run = await p.run.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          taskId: task.id,
          sourceMessageId: message.id,
          trigger: "user",
          status: "queued",
          interactionMode: "personal",
        },
      });
      await h.executor.continueRun(run.id, "work-executor-probe");
      const observed = await p.run.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(observed.status, "completed");
      const work = await p.assistantWork.findFirstOrThrow({ where: { threadId: thread.id } });
      assert.equal(work.status, "waiting");
      const before = await p.message.count({ where: { threadId: thread.id, role: "bot" } });
      await p.assistantWork.update({
        where: { id: work.id },
        data: { nextWakeAt: new Date(Date.now() - 1000) },
      });
      const queued: BackgroundJob[] = [];
      await reconcileAssistantWork({
        prisma: p,
        jobs: {
          enqueue: async (j) => {
            queued.push(j);
          },
          cancel: async () => {},
          close: async () => {},
        },
      });
      const active = await p.assistantWork.findUniqueOrThrow({ where: { id: work.id } });
      assert.ok(active.activeRunId);
      await h.executor.continueRun(active.activeRunId, "work-executor-probe");
      const ended = await p.run.findUniqueOrThrow({ where: { id: active.activeRunId } });
      assert.equal(ended.status, "completed");
      await reconcileAssistantWork({
        prisma: p,
        jobs: { enqueue: async () => {}, cancel: async () => {}, close: async () => {} },
      });
      const after = await p.assistantWork.findUniqueOrThrow({ where: { id: work.id } });
      assert.equal(after.status, "waiting");
      assert.equal(after.activeRunId, null);
      assert.equal(after.runCount, 1);
      assert.equal(after.lastResult, "Same source revision");
      assert.equal(await p.message.count({ where: { threadId: thread.id, role: "bot" } }), before);
      assert.equal(calls, 2);
      assert.equal(queued.length, 1);
    } finally {
      await p.organization.deleteMany({ where: { id } });
      await p.user.deleteMany({ where: { id } });
      await h.stop();
      for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
      Object.assign(process.env, priorEnv);
      await rm(dataDir, { recursive: true, force: true });
    }
  },
  30000,
);
