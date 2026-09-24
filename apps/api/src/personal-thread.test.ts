import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { resolvePersonalThread } from "./personal-thread.js";
import { resolveThreadTarget } from "./thread-target.js";

const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

function prismaFor(options: { existing?: boolean; raceLost?: boolean } = {}) {
  const personal = { id: "thread-personal", unread: true, kind: "personal" };
  let created = false;
  const thread = {
    findUnique: vi.fn(async () =>
      options.existing || (options.raceLost && thread.create.mock.calls.length > 0) || created
        ? personal
        : null,
    ),
    create: vi.fn(async () => {
      if (options.raceLost) throw Object.assign(new Error("unique"), { code: "P2002" });
      created = true;
      return personal;
    }),
  };
  const bots = [
    { id: "child", pinned: true, parentBotId: "chief", createdAt: new Date("2026-01-01") },
    { id: "chief", pinned: true, parentBotId: null, createdAt: new Date("2026-02-01") },
    { id: "other", pinned: false, parentBotId: null, createdAt: new Date("2026-01-01") },
  ];
  const prisma = {
    thread,
    bot: {
      findMany: vi.fn(async () => bots),
      findFirst: vi.fn(async () => ({
        id: "chief",
        spaceId: "space-1",
        userId: "user-1",
        name: "Negroni",
        threads: [{ id: "thread-team" }],
        computer: null,
      })),
    },
  } as unknown as PrismaClient;
  return { prisma, thread };
}

describe("resolvePersonalThread", () => {
  it("creates the main assistant's Personal thread on first use", async () => {
    const { prisma, thread } = prismaFor();
    await expect(resolvePersonalThread(prisma, actor)).resolves.toEqual({
      botId: "chief",
      threadId: "thread-personal",
      unread: true,
    });
    expect(thread.create).toHaveBeenCalledWith({
      data: { spaceId: "space-1", userId: "user-1", botId: "chief", kind: "personal" },
    });
  });

  it("reuses an existing Personal thread", async () => {
    const { prisma, thread } = prismaFor({ existing: true });
    await expect(resolvePersonalThread(prisma, actor)).resolves.toMatchObject({
      threadId: "thread-personal",
    });
    expect(thread.findUnique).toHaveBeenCalledWith({
      where: { botId_kind: { botId: "chief", kind: "personal" } },
    });
    expect(thread.create).not.toHaveBeenCalled();
  });

  it("uses the winner when a concurrent first call created it", async () => {
    const { prisma } = prismaFor({ raceLost: true });
    await expect(resolvePersonalThread(prisma, actor)).resolves.toMatchObject({
      threadId: "thread-personal",
    });
  });
});

describe("resolveThreadTarget thread kinds", () => {
  it("keeps a bot's Team thread by default", async () => {
    const { prisma, thread } = prismaFor();
    await expect(resolveThreadTarget(prisma, actor, { botId: "chief" })).resolves.toMatchObject({
      kind: "bot",
      botId: "chief",
      threadId: "thread-team",
      threadKind: "team",
    });
    expect(thread.create).not.toHaveBeenCalled();
  });

  it("addresses the Personal thread when asked", async () => {
    const { prisma } = prismaFor({ existing: true });
    await expect(
      resolveThreadTarget(prisma, actor, { botId: "chief", threadKind: "personal" }),
    ).resolves.toMatchObject({
      kind: "bot",
      botId: "chief",
      threadId: "thread-personal",
      threadKind: "personal",
    });
  });
});
