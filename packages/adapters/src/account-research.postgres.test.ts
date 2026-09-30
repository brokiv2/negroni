import { randomUUID } from "node:crypto";
import type {
  AgentRuntimeEvent,
  BackgroundJob,
  ManagedConnectorProvider,
  MemoryStore,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeAccountResearch, validateAccountResearch } from "./account-research.js";
import { mutateFeedProfile } from "./feed-profile.js";
import { reconcileFeedResearch } from "./feed-research.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
suite("connected-source anticipation (PostgreSQL, offline)", () => {
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
  async function setup() {
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
      researchEnabled: false,
      researchChecksPerDay: 8,
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

    const account = await prisma.connection.create({
      data: {
        ...owner,
        connectorId: "notes",
        provider: "meetings",
        displayName: "Notes",
        status: "connected",
        providerRef: "remote-account",
      },
    });
    await mutateFeedProfile(prisma, owner, (p) => ({ ...p, accountResearchIds: [account.id] }));
    const evidence = "Prepare a prototype for the follow-up meeting tomorrow.";
    const observe = vi.fn(async () => [{ id: "meeting", title: "Prototype", text: evidence }]);
    const provider = { canObserve: () => true, observe } as unknown as ManagedConnectorProvider;
    const registry = { managed: () => provider };
    const memory = {
      search: vi.fn(async () => [
        { path: "projects/prototype.md", snippet: "Prototype work", score: 1 },
      ]),
    } as unknown as MemoryStore;
    const candidate = {
      sourceId: `${account.id}:meeting`,
      title: "Prepare the prototype",
      summary: "A concrete preparation step.",
      nextStep: "Draft the demo checklist.",
      reason: "The next meeting is tomorrow and needs a prototype.",
      evidence,
      confidence: 0.95,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const run = async (
      events: AgentRuntimeEvent[] = [
        { type: "tool", executionId: "test-call", name: "save_opportunity", args: candidate },
      ],
    ) => {
      const cycle = await active();
      const runtime = new ScriptedAgentRuntime();
      runtime.run = async function* () {
        yield* events;
      };
      const spy = vi.spyOn(runtime, "run");
      await executeAccountResearch({
        prisma,
        runtime,
        registry,
        memory,
        researchId: cycle.id,
        context: {
          ...owner,
          operationId: cycle.id,
          traceId: cycle.id,
          runId: cycle.run!.id,
          signal: new AbortController().signal,
        },
        request: {
          runId: cycle.run!.id,
          botId: bot.id,
          threadId: thread.id,
          model: { provider: "scripted", id: "scripted" },
        },
      });
      return spy;
    };
    const finish = async () => {
      const cycle = await active();
      await prisma.run.update({ where: { id: cycle.run!.id }, data: { status: "completed" } });
      await reconcile();
    };
    const next = async () => {
      await prisma.feedProfile.update({
        where: { spaceId_userId: owner },
        data: { nextResearchAt: new Date(0) },
      });
      await reconcile();
    };
    await reconcile();
    return {
      owner,
      account,
      observe,
      registry,
      memory,
      candidate,
      run,
      finish,
      next,
      active,
      profile,
      reconcile,
    };
  }
  it("delivers a timely finding once and leaves repeated publication silent", async () => {
    const s = await setup();
    const offset = new Date().getUTCHours() - 12;
    const timeZone = `Etc/GMT${offset >= 0 ? "+" : ""}${offset}`;
    await mutateFeedProfile(prisma, s.owner, (p) => ({
      ...p,
      accountAlerts: true,
      accountTimeZone: timeZone,
    }));
    await s.next();
    await s.run([
      {
        type: "tool",
        executionId: "urgent",
        name: "save_opportunity",
        args: {
          ...s.candidate,
          urgency: "time_sensitive",
          interruptReason: "A changed imminent meeting requires preparing the prototype now.",
          confidence: 0.98,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      },
    ]);
    const cycle = await s.active();
    await prisma.run.update({ where: { id: cycle.run!.id }, data: { status: "completed" } });
    const send = vi.fn(async () => undefined);
    const deps = {
      prisma,
      jobs: {
        enqueue: async () => undefined,
        cancel: async () => undefined,
        close: async () => undefined,
      },
      notifications: { send } as unknown as NotificationProvider,
    };
    await reconcileFeedResearch(deps);
    await reconcileFeedResearch(deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toBeDefined();
    expect(
      await prisma.message.count({
        where: { thread: s.owner, clientNonce: { startsWith: "account-alert:" } },
      }),
    ).toBe(1);
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(1);
  });
  it("links changed notes to memory, publishes once, skips unchanged input before inference", async () => {
    const s = await setup();
    expect((await s.active()).kind).toBe("accounts");
    const spy = await s.run();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].tools?.map((t) => t.name)).toEqual(["save_opportunity"]);
    expect(s.memory.search).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "all" }),
      expect.objectContaining({ ...s.owner, connectedConnections: [] }),
    );
    await s.finish();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(1);
    expect(await prisma.message.count({ where: { thread: s.owner } })).toBe(0);
    await s.next();
    expect(await s.run()).not.toHaveBeenCalled();
    await s.finish();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(1);
  });
  it("stops accepting findings at the allowance without failing useful work", async () => {
    const s = await setup();
    await s.run(
      Array.from({ length: 6 }, (_, i) => ({
        type: "tool" as const,
        executionId: `attempt-${i}`,
        name: "save_opportunity",
        args: s.candidate,
      })),
    );
    await s.finish();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(1);
    await s.next();
    expect(await s.run()).not.toHaveBeenCalled();
  });
  it("a useful empty evaluation still remembers the source fingerprint", async () => {
    const s = await setup();
    await s.run([]);
    await s.finish();
    await s.next();
    expect(await s.run()).not.toHaveBeenCalled();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(0);
  });
  it("revocation before delivery prevents publication", async () => {
    const s = await setup();
    await s.run();
    await prisma.connection.update({ where: { id: s.account.id }, data: { status: "revoked" } });
    await s.finish();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(0);
  });
  it("pausing rejects late work and publication", async () => {
    const s = await setup();
    await s.run();
    await mutateFeedProfile(prisma, s.owner, (p) => ({ ...p, accountResearchIds: [] }));
    await s.reconcile();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(0);
    expect((await s.profile()).activeResearchId).toBeNull();
  });
  it("does not revive a dismissed suggestion when its source changes", async () => {
    const s = await setup();
    await s.run();
    await s.finish();
    await prisma.feedItem.updateMany({ where: s.owner, data: { hidden: true } });
    s.observe.mockResolvedValue([
      { id: "meeting", title: "Prototype", text: s.candidate.evidence + " New detail." },
    ]);
    await s.next();
    await s.run();
    await s.finish();
    expect(await prisma.feedItem.count({ where: s.owner })).toBe(1);
    expect((await prisma.feedItem.findFirstOrThrow({ where: s.owner })).hidden).toBe(true);
  });
  it.each(["send_message", "web_search", "work_create"])(
    "rejects %s outside isolated tools",
    async (name) => {
      const s = await setup();
      await expect(
        s.run([{ type: "tool", executionId: "test-call", name, args: {} }]),
      ).rejects.toThrow("unavailable");
      expect(await prisma.accountObservation.count({ where: { connectionId: s.account.id } })).toBe(
        0,
      );
    },
  );
  it("rejects invented evidence and expired opportunities", async () => {
    const s = await setup();
    await expect(
      s.run([
        {
          type: "tool",
          executionId: "test-call",
          name: "save_opportunity",
          args: { ...s.candidate, evidence: "This sentence never appeared in the source." },
        },
      ]),
    ).rejects.toThrow("exact source quote");
    await expect(
      s.run([
        {
          type: "tool",
          executionId: "test-call",
          name: "save_opportunity",
          args: { ...s.candidate, expiresAt: new Date(0).toISOString() },
        },
      ]),
    ).rejects.toThrow("expiry");
  });
  it("rejects an account revoked during source reading before model evaluation", async () => {
    const s = await setup();
    s.observe.mockImplementation(async () => {
      await prisma.connection.update({ where: { id: s.account.id }, data: { status: "revoked" } });
      return [{ id: "meeting", title: "Prototype", text: s.candidate.evidence }];
    });
    await expect(s.run()).rejects.toThrow("account is unavailable");
    expect(await prisma.feedFinding.count({ where: { researchId: (await s.active()).id } })).toBe(
      0,
    );
  });
  it("alternates public and account work within the same daily allowance", async () => {
    const s = await setup();
    await s.run([]);
    await s.finish();
    await mutateFeedProfile(prisma, s.owner, (p) => ({ ...p, researchEnabled: true }));
    await s.reconcile();
    expect((await s.active()).kind).toBe("public");
    await s.finish();
    await s.next();
    expect((await s.active()).kind).toBe("accounts");
  });
  it("enforces exact owner and rejects unsupported or duplicate accounts", async () => {
    const s = await setup();
    await expect(
      validateAccountResearch(prisma, s.registry, { ...s.owner, userId: "someone-else" }, [
        s.account.id,
      ]),
    ).rejects.toThrow("connected account");
    await expect(
      validateAccountResearch(prisma, s.registry, s.owner, [s.account.id, s.account.id]),
    ).rejects.toThrow("connected account");
    await expect(
      validateAccountResearch(prisma, { managed: () => undefined }, s.owner, [s.account.id]),
    ).rejects.toThrow("connected account");
  });
});
