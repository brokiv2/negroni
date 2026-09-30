import { randomUUID } from "node:crypto";
import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { FeedProfileSchema } from "@rakazo/contracts";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eligibleFeedInterests, mutateFeedProfile } from "./feed-profile.js";
import { learnInterestsInBackground } from "./interest-learning.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
suite("background interest learning (PostgreSQL, offline)", () => {
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

  async function setup(learningEnabled = true) {
    const id = randomUUID();
    users.push(id);
    const owner = { spaceId: id, userId: id };
    await prisma.user.create({
      data: { id, name: "Learning test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Learning test", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id, organizationId: id, name: "Learning test", isDefault: true },
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
    await mutateFeedProfile(prisma, owner, (p) => ({ ...p, learningEnabled }));
    let seq = 0;
    const say = (text: string, at: Date) =>
      prisma.message.create({
        data: {
          threadId: thread.id,
          seq: seq++,
          role: "user",
          blocks: [{ kind: "text", text }],
          createdAt: at,
        },
      });
    const cycle = async (at: Date) => {
      const row = await prisma.feedResearch.create({
        data: {
          ...owner,
          kind: "accounts",
          version: 1,
          deadline: new Date(Date.now() + 300_000),
          createdAt: at,
        },
      });
      await prisma.feedProfile.update({
        where: { spaceId_userId: owner },
        data: { activeResearchId: row.id },
      });
      return row;
    };
    const learn = async (researchId: string, reply: (request: AgentRunRequest) => string) => {
      const runtime = new ScriptedAgentRuntime();
      const seen: AgentRunRequest[] = [];
      runtime.run = async function* (request) {
        seen.push(request);
        yield { type: "text", text: reply(request) };
      };
      const result = await learnInterestsInBackground({
        prisma,
        runtime,
        researchId,
        model: { provider: "scripted", id: "cheap", thinkingLevel: "off" },
        request: { botId: bot.id, threadId: thread.id, runId: `run-${researchId}` },
        context: {
          ...owner,
          operationId: researchId,
          traceId: researchId,
          signal: new AbortController().signal,
        },
      });
      return { result, seen };
    };
    const profile = () =>
      prisma.feedProfile.findUniqueOrThrow({ where: { spaceId_userId: owner } });
    return { owner, say, cycle, learn, profile };
  }

  it("learns a topic from two separate messages without disturbing the active cycle", async () => {
    const s = await setup();
    const t0 = Date.now();
    const m1 = await s.say(
      "I keep reading about Rust compilers lately, fascinating.",
      new Date(t0 - 3_600_000),
    );
    const c1 = await s.cycle(new Date(t0 - 3_000_000));
    const before = await s.profile();
    const first = await s.learn(c1.id, (request) => {
      const prompt = JSON.parse(request.prompt) as { messages: { id: string }[] };
      expect(prompt.messages.map((m) => m.id)).toEqual([m1.id]);
      expect(request.tools).toEqual([]);
      return JSON.stringify({
        interests: [
          {
            messageId: m1.id,
            topic: "Rust compilers",
            reason: "Reads about it",
            evidence: "reading about Rust compilers",
            confidence: 0.9,
          },
        ],
      });
    });
    expect(first.result).toEqual({ messages: 1, observed: 1 });
    let row = await s.profile();
    expect(row.researchVersion).toBe(before.researchVersion);
    expect(row.activeResearchId).toBe(c1.id);
    let data = FeedProfileSchema.parse(row.data);
    expect(data.interests).toHaveLength(1);
    expect(eligibleFeedInterests(data)).toHaveLength(0);

    const m2 = await s.say("Any news on Rust compilers this week?", new Date(t0 - 2_000_000));
    const c2 = await s.cycle(new Date(t0 - 1_000_000));
    const second = await s.learn(c2.id, (request) => {
      const prompt = JSON.parse(request.prompt) as { messages: { id: string }[] };
      // Only messages since the previous cycle are reviewed again.
      expect(prompt.messages.map((m) => m.id)).toEqual([m2.id]);
      return JSON.stringify({
        interests: [
          {
            messageId: m2.id,
            topic: "Rust compilers",
            reason: "Asks for news",
            evidence: "news on Rust compilers",
            confidence: 0.92,
          },
        ],
      });
    });
    expect(second.result.observed).toBe(1);
    row = await s.profile();
    data = FeedProfileSchema.parse(row.data);
    expect(eligibleFeedInterests(data).map((i) => i.topic)).toEqual(["Rust compilers"]);
    expect(row.activeResearchId).toBe(c2.id);
    expect(row.researchVersion).toBe(before.researchVersion);
  });

  it("ignores low confidence, invented quotes, unknown messages and garbage output", async () => {
    const s = await setup();
    const m = await s.say(
      "Planning a trip to Kyoto in spring, any tips?",
      new Date(Date.now() - 60_000),
    );
    const c = await s.cycle(new Date());
    const { result } = await s.learn(c.id, () =>
      JSON.stringify({
        interests: [
          {
            messageId: m.id,
            topic: "Kyoto",
            reason: "trip",
            evidence: "trip to Kyoto",
            confidence: 0.4,
          },
          {
            messageId: m.id,
            topic: "Kyoto",
            reason: "trip",
            evidence: "never said this",
            confidence: 0.95,
          },
          {
            messageId: "other",
            topic: "Kyoto",
            reason: "trip",
            evidence: "trip to Kyoto",
            confidence: 0.95,
          },
        ],
      }),
    );
    expect(result.observed).toBe(0);
    const garbage = await s.learn(c.id, () => "not json at all");
    expect(garbage.result.observed).toBe(0);
    expect(FeedProfileSchema.parse((await s.profile()).data).interests).toHaveLength(0);
  });

  it("does nothing and calls no model when learning is off", async () => {
    const s = await setup(false);
    await s.say("I love astrophotography and new telescopes.", new Date(Date.now() - 60_000));
    const c = await s.cycle(new Date());
    const { result, seen } = await s.learn(c.id, () => "{}");
    expect(result).toEqual({ messages: 0, observed: 0 });
    expect(seen).toHaveLength(0);
  });
});
