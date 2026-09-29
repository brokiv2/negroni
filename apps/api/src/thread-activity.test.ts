import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space",
  userId: "user",
  email: "user@example.test",
  isDeploymentOwner: true,
};
function fixture(owned = true, hasRun = true) {
  const findBot = vi
    .fn()
    .mockResolvedValue(owned ? { id: "bot", threads: [{ id: "thread" }], computer: null } : null);
  const findRuns = vi.fn().mockResolvedValue(hasRun ? [{ id: "run", status: "running" }] : []);
  const findEvents = vi.fn().mockResolvedValue([
    {
      id: "event",
      runId: "run",
      type: "agent.tool.called",
      createdAt: new Date("2026-09-29T10:00:00Z"),
      payload: {
        name: "GMAIL_LIST_MESSAGES",
        executionId: "call",
        args: { token: "private-token" },
      },
    },
  ]);
  const handler = new RPCHandler(
    createRouter({
      prisma: {
        bot: { findFirst: findBot },
        run: { findMany: findRuns },
        event: { findMany: findEvents },
      },
      env: { defaultProvider: "fake", defaultModel: "fake", sandboxProvider: "fake" },
      dataDir: "/tmp/thread-activity-test",
    } as unknown as RouterDeps),
  );
  async function call(runId?: string) {
    const { response } = await handler.handle(
      new Request("http://localhost/rpc/threads/activity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: "bot", ...(runId ? { runId } : {}) } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  }
  return { call, findBot, findRuns, findEvents };
}

describe("thread activity", () => {
  it("scopes history to the owned thread and returns only display metadata", async () => {
    const { call, findBot, findRuns, findEvents } = fixture();
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.json).toHaveLength(1);
    expect(body.json[0].status).toBe("running");
    expect(JSON.stringify(body)).not.toContain("private-token");
    expect(findBot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "bot", spaceId: "space", userId: "user" }),
      }),
    );
    expect(findRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ threadId: "thread", spaceId: "space", userId: "user" }),
      }),
    );
    expect(findEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          threadId: "thread",
          spaceId: "space",
          runId: { in: ["run"] },
        }),
      }),
    );
  });
  it("does not read events for an unowned bot", async () => {
    const { call, findRuns, findEvents } = fixture(false);
    expect((await call()).status).toBeGreaterThanOrEqual(400);
    expect(findRuns).not.toHaveBeenCalled();
    expect(findEvents).not.toHaveBeenCalled();
  });
  it("does not allow an explicit run id to escape its thread or actor", async () => {
    const { call, findRuns, findEvents } = fixture(true, false);
    expect(await (await call("other-run")).json()).toEqual({ json: [] });
    expect(findRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "other-run",
          threadId: "thread",
          spaceId: "space",
          userId: "user",
        }),
      }),
    );
    expect(findEvents).not.toHaveBeenCalled();
  });
});
