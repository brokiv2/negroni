import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space",
  userId: "owner",
  email: "demo@example.test",
  isDeploymentOwner: false,
};
function fixture(owned = true) {
  const date = new Date("2026-09-29T12:00:00Z");
  const findMany = vi.fn().mockResolvedValue([
    {
      id: "work",
      botId: "bot",
      threadId: "thread",
      title: "Demo check",
      objective: "Check demo output",
      status: "waiting",
      version: 1,
      nextWakeAt: date,
      wakeReason: "Expected change",
      lastResult: "",
      activeRunId: null,
      runCount: 0,
      maxRuns: 2,
      deadline: date,
      updatedAt: date,
      authorization: "private authorization record",
      creationKey: "internal-key",
    },
  ]);
  const findFirst = vi.fn().mockResolvedValue(null);
  const handler = new RPCHandler(
    createRouter({
      prisma: {
        bot: {
          findFirst: vi
            .fn()
            .mockResolvedValue(
              owned ? { id: "bot", threads: [{ id: "thread" }], computer: null } : null,
            ),
        },
        assistantWork: { findMany, findFirst },
      },
      env: { defaultProvider: "fake", defaultModel: "fake", sandboxProvider: "fake" },
      dataDir: "/tmp/work-api-test",
    } as unknown as RouterDeps),
  );
  async function call(method: string, input: unknown, authenticated = true) {
    const { response } = await handler.handle(
      new Request(`http://localhost/rpc/work/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor: authenticated ? actor : null } },
    );
    return response!;
  }
  return { call, findMany, findFirst };
}

describe("ongoing work API", () => {
  it("resolves the owned thread and returns presentation fields only", async () => {
    const h = fixture();
    const response = await h.call("list", { botId: "bot" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.json).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/private authorization|internal-key/);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: "space", userId: "owner", threadId: "thread" } }),
    );
  });
  it("does not query work for an unowned conversation", async () => {
    const h = fixture(false);
    expect((await h.call("list", { botId: "bot" })).status).toBeGreaterThanOrEqual(400);
    expect(h.findMany).not.toHaveBeenCalled();
  });
  it("does not allow a foreign work ID through the control endpoint", async () => {
    const h = fixture();
    expect(
      (await h.call("control", { workId: "foreign", version: 1, action: "cancel" })).status,
    ).toBe(400);
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", spaceId: "space", userId: "owner" },
    });
  });
  it("requires authentication even when a valid work ID is known", async () => {
    const h = fixture();
    expect(
      (await h.call("control", { workId: "work", version: 1, action: "resume" }, false)).status,
    ).toBe(401);
    expect(h.findFirst).not.toHaveBeenCalled();
  });
});
