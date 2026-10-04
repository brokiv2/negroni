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
    const call = async (path: string, input?: unknown, client?: "native" | "web") => {
      const { response } = await handler.handle(
        new Request(`http://fixture.test/rpc/${path.includes("/") ? path : `radar/${path}`}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor, ...(client ? { client } : {}) } },
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

  it("reads one update, forgets a person, and notes a web client watching the personal thread", async () => {
    const a = await owner();
    const b = await owner();
    const mine = await a.signal("m1");
    let response = await a.call("update", { id: mine.id });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: mine.id, title: "Re: budget" });
    expect((await b.call("update", { id: mine.id })).status).toBe(404);

    await prisma.radarProfile.update({
      where: { spaceId_userId: { spaceId: a.id, userId: a.id } },
      data: {
        learned: {
          people: [
            {
              name: "Colleague",
              addresses: ["colleague@example.test"],
              relation: "",
              weight: 2,
              origin: "learned",
            },
            {
              name: "Manager",
              addresses: ["boss@example.test"],
              relation: "manager",
              weight: 3,
              origin: "explicit",
            },
          ],
        },
      },
    });
    response = await a.call("person", { address: "Colleague@Example.test" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject([{ name: "Manager" }]);
    expect((await a.call("person", {})).status).toBe(400);

    const bot = await prisma.bot.create({
      data: { spaceId: a.id, userId: a.id, name: "Assistant", color: "test" },
    });
    await prisma.thread.create({
      data: { spaceId: a.id, userId: a.id, botId: bot.id, kind: "personal" },
    });
    const read = (client: "native" | "web") =>
      a.call("threads/head", { botId: bot.id, threadKind: "personal" }, client);
    expect((await read("native")).status).toBe(200);
    const presence = async () =>
      (
        await prisma.radarProfile.findUniqueOrThrow({
          where: { spaceId_userId: { spaceId: a.id, userId: a.id } },
        })
      ).presenceAt;
    expect(await presence()).toBeNull();
    expect((await read("web")).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await presence()).toBeInstanceOf(Date);
  });

  it("sends a message about an update into the personal conversation with the update attached", async () => {
    const a = await owner();
    const b = await owner();
    const bot = await prisma.bot.create({
      data: { spaceId: a.id, userId: a.id, name: "Assistant", color: "test" },
    });
    const thread = await prisma.thread.create({
      data: { spaceId: a.id, userId: a.id, botId: bot.id, kind: "personal" },
    });
    await prisma.thread.create({
      data: { spaceId: a.id, userId: a.id, botId: bot.id, kind: "team" },
    });
    const card = await prisma.message.create({
      data: {
        threadId: thread.id,
        role: "bot",
        seq: 0,
        blocks: [{ kind: "text", text: "Budget figures due today" }],
      },
    });
    await prisma.thread.update({ where: { id: thread.id }, data: { nextMessageSeq: 1 } });
    const update = await a.signal("m1", {
      messageId: card.id,
      headline: "Budget figures due today",
    });
    const send = (input: Record<string, unknown>) =>
      a.call("threads/send", {
        botId: bot.id,
        threadKind: "personal",
        text: "Draft the reply",
        ...input,
      });
    expect((await send({ radarUpdateId: (await b.signal("t1")).id })).status).toBe(404);
    expect(
      (await a.call("threads/send", { botId: bot.id, text: "Draft", radarUpdateId: update.id }))
        .status,
    ).toBe(400);
    const sent = await send({ radarUpdateId: update.id });
    expect(sent.status).toBe(200);
    const message = await prisma.message.findFirstOrThrow({
      where: { threadId: thread.id, role: "user" },
      orderBy: { seq: "desc" },
    });
    expect(message).toMatchObject({
      radarSignalId: update.id,
      replyToMessageId: card.id,
      replyQuote: "Budget figures due today",
    });
  });
});
