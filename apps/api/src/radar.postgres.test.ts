import { randomUUID } from "node:crypto";
import { RPCHandler } from "@orpc/server/fetch";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

suite("radar RPC (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  let handler: RPCHandler<Record<string, unknown>>;
  const ids: string[] = [];

  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    const connectors = {
      managed: (id: string) => (id === "composio" ? { canObserve: () => true } : undefined),
    };
    handler = new RPCHandler(
      createRouter({
        prisma,
        connectors,
        events: { notify: async () => undefined },
        jobs: { enqueue: async () => undefined },
        env: { defaultProvider: "fake", defaultModel: "fake", agentRuntime: "scripted" },
      } as unknown as RouterDeps),
    );
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await db.pool.end();
  });

  async function owner() {
    const id = randomUUID();
    ids.push(id);
    await prisma.user.create({
      data: { id, name: "Radar RPC", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Radar RPC", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({ data: { id, organizationId: id, name: "Radar", isDefault: true } });
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
    const gmail = await prisma.connection.create({
      data: {
        spaceId: id,
        userId: id,
        provider: "gmail",
        displayName: "Mail",
        status: "connected",
      },
    });
    const actor = {
      userId: id,
      spaceId: id,
      email: `${id}@example.test`,
      isDeploymentOwner: false,
    };
    const call = async (path: string, input?: unknown) => {
      const { response } = await handler.handle(
        new Request(`http://fixture.test/rpc/radar/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      const body = (await response!.json()) as { json?: unknown };
      return { status: response!.status, body: body.json as Record<string, unknown> & any };
    };
    const signal = async (externalId: string, data: Record<string, unknown> = {}) => {
      await prisma.radarProfile.createMany({
        data: [{ spaceId: id, userId: id }],
        skipDuplicates: true,
      });
      return prisma.radarSignal.create({
        data: {
          spaceId: id,
          userId: id,
          connectionId: gmail.id,
          source: "gmail",
          externalId,
          kind: "email",
          occurredAt: new Date(),
          actor: { name: "A colleague", address: "colleague@example.test" },
          title: "Re: budget",
          contentHash: externalId,
          status: "decided",
          disposition: "brief",
          importance: 55,
          urgency: "today",
          ...data,
        },
      });
    };
    return { id, gmail, call, signal };
  }

  it("configures, lists, takes feedback and learns, scoped to the caller", async () => {
    const a = await owner();
    const b = await owner();

    let response = await a.call("status");
    expect(response.status).toBe(200);
    expect(response.body.settings.enabled).toBe(false);
    expect(response.body.sources).toMatchObject([
      { connectionId: a.gmail.id, state: "paused", supported: true },
    ]);

    response = await a.call("configure", { enabled: true, level: "more" });
    expect(response.status).toBe(200);
    expect(response.body.settings).toMatchObject({ enabled: true, level: "more" });
    expect(response.body.sources).toMatchObject([{ connectionId: a.gmail.id, state: "ok" }]);
    expect((await a.call("configure", { level: "everything" })).status).toBe(400);
    expect((await a.call("source", { connectionId: b.gmail.id, enabled: true })).status).toBe(404);

    const mine = await a.signal("m1");
    const second = await a.signal("m2");
    const theirs = await b.signal("t1");
    response = await a.call("updates", { view: "open" });
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [mine.id, second.id].sort(),
    );

    expect((await a.call("feedback", { id: theirs.id, kind: "done" })).status).toBe(404);
    expect((await prisma.radarSignal.findUniqueOrThrow({ where: { id: theirs.id } })).state).toBe(
      "open",
    );
    expect((await a.call("feedback", { id: mine.id, kind: "snooze" })).status).toBe(400);
    response = await a.call("feedback", { id: mine.id, kind: "not_important" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: mine.id,
      state: "dismissed",
      feedback: "not_important",
    });
    await a.call("feedback", { id: second.id, kind: "not_important" });
    response = await a.call("rules");
    expect(response.body).toMatchObject([
      { kind: "digest", origin: "learned", match: { sender: "colleague@example.test" } },
    ]);
    expect((await b.call("rules")).body).toEqual([]);

    response = await a.call("rule", { add: { kind: "never", match: { domain: "example.test" } } });
    expect(response.body).toHaveLength(2);
    const added = response.body.find((rule: { origin: string }) => rule.origin === "explicit");
    response = await a.call("rule", { removeId: added.id });
    expect(response.body).toMatchObject([{ kind: "digest" }]);
    expect((await a.call("rule", {})).status).toBe(400);
  });

  it("asks for a cycle or a brief only when Radar is on", async () => {
    const a = await owner();
    const off = await a.call("check");
    expect(off.status).toBe(400);
    expect(off.body.message).toBe("Turn on Radar first.");
    await a.call("configure", { enabled: true });
    const check = await a.call("check");
    expect(check.status).toBe(200);
    expect(typeof check.body.nextCycleAt).toBe("string");
    const brief = await a.call("brief");
    expect(brief.status).toBe(200);
    expect(typeof brief.body.nextBriefAt).toBe("string");
  });

  it("refuses callers without a session", async () => {
    const { response } = await handler.handle(
      new Request("http://fixture.test/rpc/radar/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: null }),
      }),
      { prefix: "/rpc", context: { actor: null } },
    );
    expect(response?.status).toBe(401);
  });
});
