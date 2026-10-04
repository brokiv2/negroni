import { randomUUID } from "node:crypto";
import { createDb, type PrismaClient } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RadarError } from "./errors.js";
import { applyRadarFeedback } from "./feedback.js";
import { changeRadarRule, listRadarRules, requestRadarCycle } from "./profile.js";
import { configureRadar } from "./settings.js";
import { setRadarSource } from "./sources.js";
import { getRadarStatus } from "./status.js";
import { listRadarUpdates } from "./updates.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

suite("radar profile, sources, updates and learning (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  const ids: string[] = [];
  const registry = {
    managed: (connectorId: string) => (connectorId === "composio" ? ({} as never) : undefined),
  };
  const now = new Date("2026-10-04T09:00:00Z");

  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
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
      data: { id, name: "Radar test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Radar test", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({ data: { id, organizationId: id, name: "Radar", isDefault: true } });
    await prisma.member.create({
      data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
    });
    // A database trigger may already have added the membership.
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
    const scope = { spaceId: id, userId: id };
    const connect = (provider: string, status = "connected", connectorId = "composio") =>
      prisma.connection.create({
        data: {
          ...scope,
          connectorId,
          provider,
          displayName: provider,
          status,
          metadata: { accountLabel: `${provider}@example.test` },
        },
      });
    return { id, scope, connect };
  }

  let sequence = 0;
  async function signal(
    scope: { spaceId: string; userId: string },
    connectionId: string,
    data: Record<string, unknown> = {},
  ) {
    sequence += 1;
    const n = sequence;
    await prisma.radarProfile.createMany({ data: [scope], skipDuplicates: true });
    return prisma.radarSignal.create({
      data: {
        ...scope,
        connectionId,
        source: "gmail",
        externalId: `m${n}`,
        kind: "email",
        occurredAt: new Date(now.getTime() - n * 60_000),
        actor: { name: "A colleague", address: "colleague@example.test" },
        title: `Message ${n}`,
        contentHash: `h${n}`,
        status: "decided",
        disposition: "brief",
        importance: 50,
        urgency: "week",
        createdAt: now,
        ...data,
      },
    });
  }

  const error = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (caught) {
      return caught instanceof RadarError ? caught.code : caught;
    }
    return "resolved";
  };

  it("lists the owner's accounts with their states before Radar is touched", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    await a.connect("github");
    await a.connect("slack", "revoked");
    await a.connect("googlecalendar", "pending");
    await a.connect("todoist", "connected", "unmanaged");
    const other = await owner();
    await other.connect("gmail");

    const status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.settings.enabled).toBe(false);
    expect(status.today).toEqual({ seen: 0, interrupted: 0, briefed: 0, skipped: 0, deferred: 0 });
    expect(status.sources.map((source) => [source.source, source.state, source.supported])).toEqual(
      [
        ["gmail", "paused", true],
        ["github", "unsupported", false],
        ["slack", "revoked", true],
      ],
    );
    expect(status.sources[0]).toMatchObject({
      connectionId: gmail.id,
      account: "gmail@example.test",
      enabled: false,
      seenToday: 0,
    });
    expect(await prisma.radarProfile.count({ where: a.scope })).toBe(0);
  });

  it("turns on with the earlier research accounts and time zone, else every supported account", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    const calendar = await a.connect("googlecalendar");
    await prisma.feedProfile.create({
      data: {
        ...a.scope,
        data: { accountResearchIds: [gmail.id], accountTimeZone: "Europe/Helsinki" },
      },
    });
    await configureRadar(prisma, registry, a.scope, { enabled: true }, now);
    let status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.settings).toMatchObject({ enabled: true, timeZone: "Europe/Helsinki" });
    expect(status.nextCycleAt).toBe(now.toISOString());
    expect(status.sources.find((s) => s.connectionId === gmail.id)?.state).toBe("ok");
    expect(status.sources.find((s) => s.connectionId === calendar.id)?.state).toBe("paused");
    const profile = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect(profile.version).toBe(2);

    // Turning off and on again never re-imports over the owner's own choices.
    await configureRadar(prisma, registry, a.scope, { enabled: false }, now);
    await configureRadar(prisma, registry, a.scope, { enabled: true }, now);
    status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.sources.filter((s) => s.enabled).map((s) => s.connectionId)).toEqual([gmail.id]);

    const b = await owner();
    await b.connect("gmail");
    await b.connect("googledrive");
    await b.connect("github");
    await configureRadar(prisma, registry, b.scope, { enabled: true }, now);
    status = await getRadarStatus(prisma, registry, b.scope, now);
    expect(status.settings.timeZone).toBe("UTC");
    expect(status.sources.map((s) => [s.source, s.enabled])).toEqual([
      ["gmail", true],
      ["googledrive", true],
      ["github", false],
    ]);
  });

  it("patches settings without resetting omitted fields and bumps the version only on change", async () => {
    const a = await owner();
    await configureRadar(prisma, registry, a.scope, { quietHours: { start: "23:00" } }, now);
    await configureRadar(prisma, registry, a.scope, { quietHours: { enabled: false } }, now);
    const before = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect((await getRadarStatus(prisma, registry, a.scope, now)).settings.quietHours).toEqual({
      enabled: false,
      start: "23:00",
      end: "08:00",
    });
    await configureRadar(prisma, registry, a.scope, { quietHours: { enabled: false } }, now);
    const after = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect(after.version).toBe(before.version);
  });

  it("pauses, shows the pause, and resumes with a cycle", async () => {
    const a = await owner();
    await configureRadar(prisma, registry, a.scope, { enabled: true }, now);
    const until = new Date(now.getTime() + 3_600_000).toISOString();
    await configureRadar(prisma, registry, a.scope, { pausedUntil: until }, now);
    expect((await getRadarStatus(prisma, registry, a.scope, now)).settings.pausedUntil).toBe(until);
    // A pause that has run out reads as running.
    const later = new Date(now.getTime() + 7_200_000);
    expect(
      (await getRadarStatus(prisma, registry, a.scope, later)).settings.pausedUntil,
    ).toBeNull();
    await prisma.radarProfile.update({
      where: { spaceId_userId: a.scope },
      data: { nextCycleAt: null },
    });
    await configureRadar(prisma, registry, a.scope, { pausedUntil: null }, now);
    const status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.settings.pausedUntil).toBeNull();
    expect(status.nextCycleAt).toBe(now.toISOString());
  });

  it("switches sources only for the owner's readable, connected accounts", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    const github = await a.connect("github");
    const slack = await a.connect("slack", "revoked");
    const other = await owner();
    const foreign = await other.connect("gmail");
    const input = (connectionId: string, enabled = true) => ({ connectionId, enabled });

    expect(await error(setRadarSource(prisma, registry, a.scope, input(github.id), now))).toBe(
      "BAD_REQUEST",
    );
    expect(await error(setRadarSource(prisma, registry, a.scope, input(slack.id), now))).toBe(
      "BAD_REQUEST",
    );
    expect(await error(setRadarSource(prisma, registry, a.scope, input(foreign.id), now))).toBe(
      "NOT_FOUND",
    );
    await setRadarSource(prisma, registry, a.scope, input(gmail.id), now);
    await setRadarSource(prisma, registry, a.scope, input(gmail.id), now);
    let status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.sources.find((s) => s.connectionId === gmail.id)).toMatchObject({
      enabled: true,
      state: "ok",
      nextCheckAt: now.toISOString(),
    });
    const profile = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect(profile.version).toBe(2);
    await prisma.radarSource.update({
      where: { connectionId: gmail.id },
      data: {
        lastError: "The account could not be read.",
        failures: 2,
        seenDate: "2026-10-04",
        seenCount: 7,
      },
    });
    status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.sources.find((s) => s.connectionId === gmail.id)).toMatchObject({
      state: "error",
      lastError: "The account could not be read.",
      seenToday: 7,
    });
    await setRadarSource(prisma, registry, a.scope, input(gmail.id, false), now);
    status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.sources.find((s) => s.connectionId === gmail.id)).toMatchObject({
      enabled: false,
      state: "paused",
    });
    // A switched-off account stays off when Radar is first turned on.
    await configureRadar(prisma, registry, a.scope, { enabled: true }, now);
    status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.sources.every((s) => !s.enabled)).toBe(true);
  });

  it("counts today's work and names the next brief in the owner's day", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    await configureRadar(
      prisma,
      registry,
      a.scope,
      { enabled: true, timeZone: "Europe/Helsinki" },
      now,
    );
    const earlier = new Date("2026-10-03T12:00:00Z");
    await signal(a.scope, gmail.id, { disposition: "interrupt", deliveredAt: now });
    await signal(a.scope, gmail.id, { disposition: "brief" });
    await signal(a.scope, gmail.id, { disposition: "silent", reason: "Newsletter" });
    await signal(a.scope, gmail.id, {
      disposition: "interrupt",
      deliverAt: new Date(now.getTime() + 600_000),
    });
    await signal(a.scope, gmail.id, { disposition: "silent", createdAt: earlier });
    const status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.today).toEqual({ seen: 4, interrupted: 1, briefed: 1, skipped: 1, deferred: 1 });
    // Noon in Helsinki: a missed morning brief is no longer sent, the next is tomorrow's.
    expect(status.nextBriefAt).toBe("2026-10-05T05:30:00.000Z");
    await prisma.radarBrief.create({
      data: { ...a.scope, period: "morning", localDate: "2026-10-04", createdAt: now },
    });
    const early = new Date("2026-10-04T06:00:00Z");
    const morning = await getRadarStatus(prisma, registry, a.scope, early);
    expect(morning.lastBriefAt).toBe(now.toISOString());
    expect(morning.nextBriefAt).toBe("2026-10-05T05:30:00.000Z");
  });

  it("lists open, brief, skipped and all updates with stable cursors", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    const other = await owner();
    const foreign = await other.connect("gmail");
    const urgent = await signal(a.scope, gmail.id, {
      disposition: "interrupt",
      urgency: "now",
      importance: 70,
    });
    const important = await signal(a.scope, gmail.id, {
      disposition: "brief",
      urgency: "today",
      importance: 95,
    });
    const minor = await signal(a.scope, gmail.id, {
      disposition: "brief",
      urgency: "today",
      importance: 45,
    });
    const skipped = await signal(a.scope, gmail.id, { disposition: "silent", reason: "Bulk mail" });
    const flagged = await signal(a.scope, gmail.id, {
      disposition: "silent",
      feedback: "important",
      urgency: "week",
      importance: 30,
    });
    const snoozedDue = await signal(a.scope, gmail.id, {
      state: "snoozed",
      snoozedUntil: new Date(now.getTime() - 60_000),
      urgency: "none",
      importance: 60,
    });
    const snoozedLater = await signal(a.scope, gmail.id, {
      state: "snoozed",
      snoozedUntil: new Date(now.getTime() + 60_000),
    });
    const done = await signal(a.scope, gmail.id, { state: "done" });
    const pending = await signal(a.scope, gmail.id, { status: "pending", disposition: null });
    await signal(other.scope, foreign.id, { disposition: "interrupt" });

    const list = (view: string, cursor?: string, limit = 2) =>
      listRadarUpdates(prisma, a.scope, { view, limit, cursor }, now);
    const open: string[] = [];
    let page = await list("open");
    open.push(...page.items.map((item) => item.id));
    while (page.nextCursor) {
      page = await list("open", page.nextCursor);
      open.push(...page.items.map((item) => item.id));
    }
    expect(open).toEqual([urgent.id, important.id, minor.id, flagged.id, snoozedDue.id]);

    expect((await list("brief", undefined, 10)).items.map((item) => item.id)).toEqual([
      important.id,
      minor.id,
      snoozedDue.id,
      snoozedLater.id,
      done.id,
    ]);
    const skippedPage = await list("skipped", undefined, 10);
    expect(skippedPage.items.map((item) => item.id)).toEqual([skipped.id, flagged.id]);
    expect(skippedPage.items[0]?.reason).toBe("Bulk mail");

    const all: string[] = [];
    let history = await list("all", undefined, 3);
    all.push(...history.items.map((item) => item.id));
    while (history.nextCursor) {
      history = await list("all", history.nextCursor, 3);
      all.push(...history.items.map((item) => item.id));
    }
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
    expect(all.at(-1)).toBe(pending.id);
    expect(
      (await list("all", undefined, 10)).items.find((item) => item.id === pending.id)?.state,
    ).toBe("pending");
    expect(await error(list("all", "not-a-cursor"))).toBe("BAD_REQUEST");
  });

  it("applies feedback and learns from it in one transaction", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    const feedback = (id: string, kind: string, until?: string) =>
      applyRadarFeedback(prisma, a.scope, { id, kind, ...(until ? { until } : {}) }, now);
    const [first, second, third] = [
      await signal(a.scope, gmail.id),
      await signal(a.scope, gmail.id),
      await signal(a.scope, gmail.id),
    ];

    const done = await feedback(first!.id, "done");
    expect(done).toMatchObject({ state: "done", feedback: "done" });
    expect((await feedback(first!.id, "opened")).feedback).toBe("done");

    expect(await error(feedback(second!.id, "snooze", "2026-10-04T08:00:00.000Z"))).toBe(
      "BAD_REQUEST",
    );
    expect(await error(feedback(second!.id, "snooze", "2026-12-04T08:00:00.000Z"))).toBe(
      "BAD_REQUEST",
    );
    const snoozed = await feedback(second!.id, "snooze", "2026-10-04T15:00:00.000Z");
    expect(snoozed).toMatchObject({ state: "snoozed", snoozedUntil: "2026-10-04T15:00:00.000Z" });

    // Two "not important" for one sender learn a digest rule; repeating one adds nothing.
    await feedback(second!.id, "not_important");
    await feedback(second!.id, "not_important");
    expect(await listRadarRules(prisma, a.scope)).toEqual([]);
    await feedback(third!.id, "not_important");
    expect(await listRadarRules(prisma, a.scope)).toMatchObject([
      { kind: "digest", origin: "learned", match: { sender: "colleague@example.test" } },
    ]);

    // Changing one back to important keeps the digest but gives the sender weight.
    await feedback(third!.id, "important");
    let status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.people).toMatchObject([
      { addresses: ["colleague@example.test"], weight: 1, origin: "learned" },
    ]);
    await feedback(second!.id, "important");
    status = await getRadarStatus(prisma, registry, a.scope, now);
    expect(status.rules).toMatchObject([{ kind: "always", origin: "learned" }]);
    expect(status.people[0]?.weight).toBe(2);

    // Mute is explicit and learning cannot take it back.
    const fourth = await signal(a.scope, gmail.id);
    expect(await feedback(fourth.id, "mute_sender")).toMatchObject({ state: "dismissed" });
    const fifth = await signal(a.scope, gmail.id);
    await feedback(fifth.id, "important");
    expect(await listRadarRules(prisma, a.scope)).toMatchObject([
      { kind: "never", origin: "explicit", match: { sender: "colleague@example.test" } },
    ]);

    const anonymous = await signal(a.scope, gmail.id, { actor: { name: "No address" } });
    expect(await error(feedback(anonymous.id, "always_sender"))).toBe("BAD_REQUEST");
    expect((await feedback(anonymous.id, "important")).state).toBe("open");

    const stranger = await owner();
    expect(
      await error(applyRadarFeedback(prisma, stranger.scope, { id: fifth.id, kind: "done" }, now)),
    ).toBe("NOT_FOUND");
    expect((await prisma.radarSignal.findUniqueOrThrow({ where: { id: fifth.id } })).state).toBe(
      "open",
    );
  });

  it("serializes concurrent feedback so learning sees every mark", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    const marks = await Promise.all([1, 2, 3].map(() => signal(a.scope, gmail.id)));
    const before = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    await Promise.all(
      marks.map((mark) =>
        applyRadarFeedback(prisma, a.scope, { id: mark.id, kind: "not_important" }, now),
      ),
    );
    const after = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect(await listRadarRules(prisma, a.scope)).toMatchObject([{ kind: "digest" }]);
    expect(after.version).toBe(before.version + 1);
  });

  it("adds and removes rules, keeping one rule per match", async () => {
    const a = await owner();
    const add = (kind: string, match: Record<string, string>, note?: string) =>
      changeRadarRule(prisma, a.scope, { add: { kind, match, note } }, now);
    await add("never", { domain: "Example.TEST" });
    const rules = await add("always", { domain: "example.test" }, "Partners");
    expect(rules).toMatchObject([
      { kind: "always", origin: "explicit", note: "Partners", match: { domain: "example.test" } },
    ]);
    await add("digest", { topic: "Weekly report" });
    const removed = await changeRadarRule(prisma, a.scope, { removeId: rules[0]!.id }, now);
    expect(removed).toMatchObject([{ kind: "digest", match: { topic: "Weekly report" } }]);
    const version = (
      await prisma.radarProfile.findUniqueOrThrow({ where: { spaceId_userId: a.scope } })
    ).version;
    await changeRadarRule(prisma, a.scope, { removeId: "missing" }, now);
    expect(
      (await prisma.radarProfile.findUniqueOrThrow({ where: { spaceId_userId: a.scope } })).version,
    ).toBe(version);
  });

  it("asks for a cycle or a brief only while Radar is on", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    expect(await error(requestRadarCycle(prisma, a.scope, { brief: false }, now))).toBe(
      "BAD_REQUEST",
    );
    await configureRadar(prisma, registry, a.scope, { enabled: true }, now);
    const later = new Date(now.getTime() + 600_000);
    await prisma.radarSource.update({
      where: { connectionId: gmail.id },
      data: { nextCheckAt: new Date(now.getTime() + 3_600_000) },
    });
    const version = (
      await prisma.radarProfile.findUniqueOrThrow({ where: { spaceId_userId: a.scope } })
    ).version;
    await requestRadarCycle(prisma, a.scope, { brief: false }, later);
    const profile = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect(profile.nextCycleAt?.toISOString()).toBe(later.toISOString());
    expect(profile.version).toBe(version);
    expect(
      (
        await prisma.radarSource.findUniqueOrThrow({ where: { connectionId: gmail.id } })
      ).nextCheckAt?.toISOString(),
    ).toBe(later.toISOString());
    await requestRadarCycle(prisma, a.scope, { brief: true }, later);
    await requestRadarCycle(prisma, a.scope, { brief: true }, new Date(later.getTime() + 60_000));
    const asked = await prisma.radarProfile.findUniqueOrThrow({
      where: { spaceId_userId: a.scope },
    });
    expect(asked.briefRequestedAt?.toISOString()).toBe(later.toISOString());
    expect((await getRadarStatus(prisma, registry, a.scope, later)).nextBriefAt).toBe(
      later.toISOString(),
    );
  });

  it("leaves no rows behind when a connection, message or user goes away", async () => {
    const a = await owner();
    const gmail = await a.connect("gmail");
    const calendar = await a.connect("googlecalendar");
    await configureRadar(prisma, registry, a.scope, { enabled: true }, now);
    const bot = await prisma.bot.create({
      data: { ...a.scope, name: "Assistant", color: "test" },
    });
    const thread = await prisma.thread.create({
      data: { ...a.scope, botId: bot.id, kind: "personal" },
    });
    const message = await prisma.message.create({
      data: { threadId: thread.id, role: "bot", seq: 0, blocks: [] },
    });
    const kept = await signal(a.scope, calendar.id, { messageId: message.id });
    await signal(a.scope, gmail.id);
    await prisma.radarBrief.create({
      data: { ...a.scope, period: "morning", localDate: "2026-10-04", messageId: message.id },
    });

    const viewed = await listRadarUpdates(prisma, a.scope, { view: "open" }, now);
    expect(viewed.items.find((item) => item.id === kept.id)).toMatchObject({
      messageId: message.id,
      threadId: thread.id,
    });

    await prisma.connection.delete({ where: { id: gmail.id } });
    expect(await prisma.radarSource.count({ where: { connectionId: gmail.id } })).toBe(0);
    expect(await prisma.radarSignal.count({ where: { connectionId: gmail.id } })).toBe(0);

    await prisma.message.delete({ where: { id: message.id } });
    expect((await prisma.radarSignal.findUniqueOrThrow({ where: { id: kept.id } })).messageId).toBe(
      null,
    );
    expect((await prisma.radarBrief.findFirstOrThrow({ where: a.scope })).messageId).toBeNull();

    await prisma.organization.delete({ where: { id: a.id } });
    await prisma.user.delete({ where: { id: a.id } });
    expect(await prisma.radarProfile.count({ where: a.scope })).toBe(0);
    expect(await prisma.radarSignal.count({ where: a.scope })).toBe(0);
    expect(await prisma.radarSource.count({ where: a.scope })).toBe(0);
    expect(await prisma.radarBrief.count({ where: a.scope })).toBe(0);
  });
});
