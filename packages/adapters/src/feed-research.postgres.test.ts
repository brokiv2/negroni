import { randomUUID } from "node:crypto";
import type { AgentRuntimeEvent, BackgroundJob } from "@rakazo/adapter-kit";
import { FeedProfileSchema } from "@rakazo/contracts";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { mutateFeedProfile } from "./feed-profile.js";
import {
  executeFeedResearch,
  getFeedResearchStatus,
  reconcileFeedResearch,
} from "./feed-research.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
suite("bounded public research (PostgreSQL, no external services)", () => {
  let db: ReturnType<typeof createDb>, prisma: PrismaClient;
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
  async function setup(enabled = true) {
    const id = randomUUID();
    users.push(id);
    const owner = { spaceId: id, userId: id };
    await prisma.user.create({
      data: { id, name: "Research test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Research test", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id, organizationId: id, name: "Research test", isDefault: true },
    });
    await prisma.member.create({
      data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
    });
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: owner },
      update: {},
      create: { ...owner, id, organizationId: id, role: "owner", createdAt: new Date() },
    });
    const bot = await prisma.bot.create({ data: { ...owner, name: "Assistant", color: "test" } });
    const thread = await prisma.thread.create({
      data: { ...owner, botId: bot.id, kind: "personal" },
    });
    await mutateFeedProfile(prisma, owner, (p) => ({
      ...p,
      researchEnabled: enabled,
      researchChecksPerDay: 2,
      sourceDomains: ["example.test"],
      interests: [
        {
          topic: "Space research",
          reason: "Added by you",
          origin: "explicit",
          evidenceIds: [],
          updatedAt: new Date().toISOString(),
        },
      ],
    }));
    const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
    const jobs = { enqueue, cancel: async () => undefined, close: async () => undefined };
    const reconcile = () => reconcileFeedResearch({ prisma, jobs });
    const profile = () =>
      prisma.feedProfile.findUniqueOrThrow({ where: { spaceId_userId: owner } });
    const active = async () =>
      prisma.feedResearch.findUniqueOrThrow({
        where: { id: (await profile()).activeResearchId! },
        include: { run: true },
      });
    const web = new FakeWebProvider();
    web.searchHits = [
      { url: "https://example.test/space", title: "Space research", snippet: "A useful discovery" },
    ];
    web.fetchResult = {
      url: "https://example.test/space",
      title: "Space research",
      text: "The observatory published new measurements of a nearby planetary system.",
      truncated: false,
    };
    const item = {
      kind: "article",
      url: "https://example.test/space",
      title: "New measurements",
      summary: "A research update.",
      topic: "Space research",
      reason: "Matches your astronomy interest",
    };
    const events: AgentRuntimeEvent[] = [
      {
        type: "tool",
        name: "web_search",
        args: { query: "Space research" },
        executionId: "search",
      },
      { type: "tool", name: "web_fetch", args: { url: item.url }, executionId: "fetch" },
      {
        type: "tool",
        name: "research_submit",
        args: { item, evidence: web.fetchResult.text, confidence: 0.95 },
        executionId: "submit",
      },
      { type: "done", text: "Do not publish this narration" },
    ];
    async function execute(script = events) {
      const cycle = await active();
      const run = cycle.run!;
      await prisma.run.update({ where: { id: run.id }, data: { status: "running" } });
      const runtime = new ScriptedAgentRuntime();
      runtime.run = async function* (request) {
        expect(request.history).toEqual([]);
        expect(request.tools.map((tool) => tool.name)).toEqual([
          "web_search",
          "web_fetch",
          "research_submit",
        ]);
        for (const event of script) yield event;
      };
      await executeFeedResearch({
        prisma,
        runtime,
        web,
        researchId: cycle.id,
        request: {
          botId: bot.id,
          threadId: thread.id,
          runId: run.id,
          workload: "conversation",
          model: { provider: "scripted", id: "scripted" },
        },
        context: {
          ...owner,
          botId: bot.id,
          traceId: run.id,
          operationId: run.id,
          signal: new AbortController().signal,
        },
      });
      return run;
    }
    const settle = async () => {
      const cycle = await active();
      await prisma.run.update({
        where: { id: cycle.run!.id },
        data: { status: "completed", completedAt: new Date() },
      });
    };
    return {
      owner,
      bot,
      thread,
      jobs,
      enqueue,
      reconcile,
      profile,
      active,
      execute,
      events,
      web,
      item,
      settle,
    };
  }
  it("defaults discovery off and does not infer authorization from learned interests", async () => {
    expect(FeedProfileSchema.parse({}).researchEnabled).toBe(false);
    const h = await setup(false);
    await h.reconcile();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect((await getFeedResearchStatus(prisma, h.owner)).state).toBe("off");
  });
  it("claims one wake under concurrency, saves verified private findings, then delivers only a feed card", async () => {
    const h = await setup();
    await Promise.all([h.reconcile(), h.reconcile()]);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    h.web.fetchResult.imageUrl = "https://example.test/source-preview.png";
    await h.execute();
    expect(await prisma.feedItem.count({ where: h.owner })).toBe(0);
    const cycle = await h.active();
    expect(await prisma.feedFinding.count({ where: { researchId: cycle.id } })).toBe(1);
    await h.settle();
    await h.reconcile();
    expect(await prisma.feedItem.count({ where: h.owner })).toBe(1);
    expect((await prisma.feedItem.findFirstOrThrow({ where: h.owner })).imageUrl).toBe(
      "https://example.test/source-preview.png",
    );
    expect(await prisma.message.count({ where: { threadId: h.thread.id } })).toBe(0);
    expect((await h.profile()).activeResearchId).toBeNull();
  });
  it.each(["shell", "run_subagent", "message_user", "COMPOSIO_MULTI_EXECUTE_TOOL", "work_create"])(
    "rejects forbidden tool %s at dispatch",
    async (name) => {
      const h = await setup();
      await h.reconcile();
      await expect(
        h.execute([{ type: "tool", name, args: {}, executionId: "forbidden" }]),
      ).rejects.toThrow("not available");
      expect(await prisma.feedItem.count({ where: h.owner })).toBe(0);
    },
  );
  it("rejects invented evidence and an unread source", async () => {
    const h = await setup();
    await h.reconcile();
    await expect(h.execute([h.events[2]!])).rejects.toThrow("quote");
    await expect(
      h.execute([
        ...h.events.slice(0, 2),
        {
          ...h.events[2]!,
          args: {
            item: h.item,
            evidence: "This invented content never occurred on the page.",
            confidence: 1,
          },
        } as AgentRuntimeEvent,
      ]),
    ).rejects.toThrow("quote");
  });
  it("filters disallowed search results and refuses arbitrary fetches", async () => {
    const h = await setup();
    await h.reconcile();
    await expect(
      h.execute([
        {
          type: "tool",
          name: "web_fetch",
          args: { url: "https://other.test/private" },
          executionId: "fetch",
        },
      ]),
    ).rejects.toThrow("permitted URL");
  });
  it("stops an in-flight reader on pause and discards late findings", async () => {
    const h = await setup();
    await h.reconcile();
    const original = h.web.fetch.bind(h.web);
    h.web.fetch = async (...args) => {
      const result = await original(...args);
      await mutateFeedProfile(prisma, h.owner, (p) => ({ ...p, researchEnabled: false }));
      return result;
    };
    await expect(h.execute()).rejects.toThrow("paused");
    expect((await h.profile()).activeResearchId).toBeNull();
    expect(await prisma.feedFinding.count({ where: { research: h.owner } })).toBe(0);
  });
  it("never resurrects a hidden source when later research finds it again", async () => {
    const h = await setup();
    await h.reconcile();
    await h.execute();
    await h.settle();
    await h.reconcile();
    await prisma.feedItem.updateMany({ where: h.owner, data: { hidden: true } });
    await prisma.feedProfile.update({
      where: { spaceId_userId: h.owner },
      data: { nextResearchAt: new Date(0) },
    });
    await h.reconcile();
    await h.execute();
    await h.settle();
    await h.reconcile();
    const cards = await prisma.feedItem.findMany({ where: h.owner });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.hidden).toBe(true);
  });
  it("enforces a rolling daily model-check allowance and backs off empty checks", async () => {
    const h = await setup();
    for (let i = 0; i < 2; i++) {
      await prisma.feedProfile.update({
        where: { spaceId_userId: h.owner },
        data: { nextResearchAt: new Date(0) },
      });
      await h.reconcile();
      await h.execute([]);
      await h.settle();
      await h.reconcile();
      expect((await h.profile()).nextResearchAt!.getTime()).toBeGreaterThan(
        Date.now() + 23 * 3600_000,
      );
    }
    await prisma.feedProfile.update({
      where: { spaceId_userId: h.owner },
      data: { nextResearchAt: new Date(0) },
    });
    await h.reconcile();
    expect(h.enqueue).toHaveBeenCalledTimes(2);
  });
  it("does not publish saved findings after membership is revoked", async () => {
    const h = await setup();
    await h.reconcile();
    await h.execute();
    await h.settle();
    await prisma.spaceMember.deleteMany({ where: h.owner });
    await h.reconcile();
    expect(await prisma.feedItem.count({ where: h.owner })).toBe(0);
  });
  it("rejects publication after source scope changes", async () => {
    const h = await setup();
    await h.reconcile();
    await h.execute();
    await h.settle();
    await mutateFeedProfile(prisma, h.owner, (p) => ({ ...p, sourceDomains: ["other.test"] }));
    await h.reconcile();
    expect(await prisma.feedItem.count({ where: h.owner })).toBe(0);
  });
});
