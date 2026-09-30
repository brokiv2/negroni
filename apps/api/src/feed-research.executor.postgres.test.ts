import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ComposioEmulator,
  EmailEmulator,
  mutateFeedProfile,
  reconcileFeedResearch,
} from "@rakazo/adapters";
import { it } from "vitest";
import { createApp } from "./app.js";

const scenario = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? it : it.skip;
scenario.each([
  { forbidden: false, accounts: false },
  { forbidden: true, accounts: false },
  { forbidden: false, accounts: true },
  { forbidden: true, accounts: true },
])(
  "isolates public and connected research from chat and computer tools: %j",
  async ({ forbidden, accounts }) => {
    const dataDir = await mkdtemp(join(tmpdir(), "assistant-work-executor-"));
    const priorEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: priorEnv.DATABASE_URL,
      WAKEUP_DRIVER: "memory",
      SANDBOX_PROVIDER: "fake",
      AGENT_RUNTIME: "scripted",
      COMPOSIO_API_KEY: "",
      WEB_PROVIDER: "fake",
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
    const evidence = "Prepare a prototype for the next review meeting.";
    const composio = Object.assign(new ComposioEmulator(), {
      canObserve: () => true,
      observe: async () => [{ id: "meeting", title: "Prototype", text: evidence }],
    });
    const h = await createApp({ composio, email: new EmailEmulator() });
    let accountId = "";
    const p = h.prisma,
      id = randomUUID();
    let calls = 0;
    let computerCalls = 0;
    h.sandbox.provision = async () => {
      computerCalls++;
      throw new Error("Research must never provision a computer");
    };
    h.runtime.run = async function* (request) {
      calls++;
      assert.deepEqual(
        request.tools.map((t) => t.name),
        accounts ? ["save_opportunity"] : ["web_search", "web_fetch", "research_submit"],
      );
      assert.deepEqual(request.history, []);
      assert.ok(!request.prompt.includes("PRIVATE_THREAD_CONTEXT"));
      assert.equal(request.modelRoutingApplied, true);
      if (forbidden)
        yield {
          type: "tool",
          name: "shell",
          args: { command: "echo forbidden" },
          executionId: "forbidden",
        };
      if (accounts && !forbidden)
        yield {
          type: "tool",
          name: "save_opportunity",
          executionId: "candidate",
          args: {
            sourceId: `${accountId}:meeting`,
            title: "Prepare a prototype",
            summary: "Preparation for the review.",
            nextStep: "Draft a checklist.",
            reason: "The review needs a prototype and preparation is useful now.",
            evidence,
            confidence: 0.95,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        };
      yield { type: "text", text: "This narration must stay private" };
      yield { type: "done", text: "No useful findings" };
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
      await p.message.create({
        data: {
          threadId: thread.id,
          role: "user",
          seq: 0,
          blocks: [{ kind: "text", text: "PRIVATE_THREAD_CONTEXT" }],
        },
      });
      const owner = { spaceId: id, userId: id };
      if (accounts)
        accountId = (
          await p.connection.create({
            data: {
              ...owner,
              connectorId: "composio",
              provider: "notes",
              displayName: "Notes",
              status: "connected",
            },
          })
        ).id;
      await mutateFeedProfile(p, owner, (profile) => ({
        ...profile,
        researchEnabled: !accounts,
        accountResearchIds: accounts ? [accountId] : [],
        interests: [
          {
            topic: "Astronomy",
            origin: "explicit",
            reason: "Added by you",
            evidenceIds: [],
            updatedAt: new Date().toISOString(),
          },
        ],
      }));
      const jobs = { enqueue: async () => {}, cancel: async () => {}, close: async () => {} };
      await reconcileFeedResearch({ prisma: p, jobs });
      const run = await p.run.findFirstOrThrow({
        where: { botId: bot.id, trigger: "research" },
      });
      assert.notEqual(run.threadId, thread.id);
      await h.executor.continueRun(run.id, "research-executor-probe");
      const ended = await p.run.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(ended.status, forbidden ? "failed" : "completed");
      await reconcileFeedResearch({ prisma: p, jobs });
      assert.equal(await p.message.count({ where: { threadId: thread.id, role: "bot" } }), 0);
      assert.equal(await p.feedItem.count({ where: owner }), accounts && !forbidden ? 1 : 0);
      assert.equal(calls, 1);
      assert.equal(computerCalls, 0);
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
