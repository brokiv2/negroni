import { randomUUID } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import { ResponseUiBlock } from "@rakazo/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { updateResponseUiState } from "./response-ui.js";

const suite =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
const block = ResponseUiBlock.parse({
  kind: "response_ui",
  id: "calculator",
  summary: "Budget",
  complete: true,
  spec: {
    root: "root",
    summary: "Budget",
    state: { amount: 2 },
    elements: {
      root: {
        type: "Input",
        props: { label: "Amount", input: "number", bind: "/amount", min: 0, max: 100 },
        children: [],
      },
    },
  },
});
suite("response input persistence (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  const users: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
  });
  async function cleanup() {
    const ids = users.splice(0);
    await db.prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await db.prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.prisma.$disconnect();
    await db.pool.end();
  });
  async function setup() {
    const id = randomUUID();
    users.push(id);
    const prisma = db.prisma;
    await prisma.user.create({
      data: { id, name: "Response test", email: `${id}@example.test`, emailVerified: true },
    });
    await prisma.organization.create({
      data: { id, name: "Response test", slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id, organizationId: id, name: "General", isDefault: true },
    });
    await prisma.member.create({
      data: { id, userId: id, organizationId: id, role: "owner", createdAt: new Date() },
    });
    const bot = await prisma.bot.create({
      data: { spaceId: id, userId: id, name: "Assistant", color: "test" },
    });
    const thread = await prisma.thread.create({
      data: { spaceId: id, userId: id, botId: bot.id, kind: "personal" },
    });
    const task = await prisma.task.create({
      data: {
        spaceId: id,
        userId: id,
        botId: bot.id,
        threadId: thread.id,
        prompt: "Budget",
        status: "completed",
      },
    });
    const run = await prisma.run.create({
      data: {
        spaceId: id,
        userId: id,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        status: "completed",
        trigger: "user",
      },
    });
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        botId: bot.id,
        runId: run.id,
        role: "bot",
        seq: 0,
        blocks: [
          { kind: "text", text: "Adjust the budget." },
          block,
          { kind: "future_kind", data: "keep" },
        ],
      },
    });
    const actor: Actor = {
      spaceId: id,
      userId: id,
      email: `${id}@example.test`,
      isDeploymentOwner: false,
    };
    const input = { messageId: message.id, blockId: block.id, revision: 0, state: { amount: 4 } };
    return { actor, input, message, run, thread };
  }
  it("persists only the existing block and publishes an update after the source run is terminal", async () => {
    const h = await setup();
    const result = await updateResponseUiState(db.prisma, h.actor, h.input);
    const reopened = await db.prisma.message.findUniqueOrThrow({ where: { id: h.message.id } });
    expect(reopened.blocks).toEqual([
      { kind: "text", text: "Adjust the budget." },
      { ...block, revision: 1, state: { amount: 4 } },
      { kind: "future_kind", data: "keep" },
    ]);
    expect(reopened.seq).toBe(h.message.seq);
    expect(reopened.createdAt).toEqual(h.message.createdAt);
    const event = await db.prisma.event.findFirstOrThrow({ where: { threadId: h.thread.id } });
    expect(event.type).toBe("thread.message.updated");
    expect(event.runId).toBeNull();
    expect(event.payload).toMatchObject({ messageId: h.message.id, messageRunId: h.run.id });
    expect(result.eventSeq).toBe(event.seq);
    expect(await db.prisma.run.count({ where: { threadId: h.thread.id } })).toBe(1);
    expect(await db.prisma.externalEffect.count({ where: { runId: h.run.id } })).toBe(0);
  });
  it("allows an identical transport retry without another event", async () => {
    const h = await setup();
    await updateResponseUiState(db.prisma, h.actor, h.input);
    const retry = await updateResponseUiState(db.prisma, h.actor, h.input);
    expect(retry.block.revision).toBe(1);
    expect(retry.eventSeq).toBeNull();
    expect(await db.prisma.event.count({ where: { threadId: h.thread.id } })).toBe(1);
  });
  it("accepts one of two concurrent devices and rejects the stale write", async () => {
    const h = await setup();
    const results = await Promise.allSettled([
      updateResponseUiState(db.prisma, h.actor, h.input),
      updateResponseUiState(db.prisma, h.actor, { ...h.input, state: { amount: 9 } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((r) => r.status === "rejected");
    expect(rejection).toMatchObject({ reason: { reason: "conflict" } });
    expect(await db.prisma.event.count({ where: { threadId: h.thread.id } })).toBe(1);
  });
  it("enforces owner, Space, membership, role and block identity", async () => {
    const h = await setup();
    const foreign = await setup();
    await expect(updateResponseUiState(db.prisma, foreign.actor, h.input)).rejects.toThrow();
    await expect(
      updateResponseUiState(db.prisma, { ...h.actor, spaceId: foreign.actor.spaceId }, h.input),
    ).rejects.toThrow();
    await expect(
      updateResponseUiState(db.prisma, h.actor, { ...h.input, blockId: "missing" }),
    ).rejects.toThrow();
    await db.prisma.message.update({ where: { id: h.message.id }, data: { role: "user" } });
    await expect(updateResponseUiState(db.prisma, h.actor, h.input)).rejects.toThrow();
    await db.prisma.message.update({ where: { id: h.message.id }, data: { role: "bot" } });
    await db.prisma.spaceMember.deleteMany({ where: { spaceId: h.actor.spaceId } });
    await expect(updateResponseUiState(db.prisma, h.actor, h.input)).rejects.toThrow();
    expect(await db.prisma.event.count({ where: { threadId: h.thread.id } })).toBe(0);
  });
  it("rejects out of range, changed types and added paths without modifying the message", async () => {
    const h = await setup();
    for (const state of [{ amount: -1 }, { amount: "4" }, { amount: 4, injected: "new" }, {}])
      await expect(
        updateResponseUiState(db.prisma, h.actor, { ...h.input, state }),
      ).rejects.toThrow();
    await db.prisma.message.update({
      where: { id: h.message.id },
      data: { blocks: [{ ...block, complete: false }] },
    });
    await expect(updateResponseUiState(db.prisma, h.actor, h.input)).rejects.toThrow();
    expect(await db.prisma.event.count({ where: { threadId: h.thread.id } })).toBe(0);
  });
});
