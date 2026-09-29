import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { resolveThreadTarget } from "./thread-target.js";

const actor = {
  userId: "user-fixture",
  spaceId: "space-fixture",
  email: "fixture@example.test",
  isDeploymentOwner: false,
};
function fixture() {
  const findMany = vi.fn(async () => []);
  const findFirst = vi.fn(async () => null);
  const update = vi.fn();
  const deps = {
    prisma: { feedItem: { findMany, findFirst, update } },
    env: { defaultProvider: "fake", defaultModel: "fake" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(method: string, input: unknown) {
    return (
      await handler.handle(
        new Request(`http://fixture.test/rpc/feed/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor } },
      )
    ).response;
  }
  return { deps, findMany, findFirst, update, call };
}
describe("feed ownership", () => {
  it("filters by user and space on every listing", async () => {
    const f = fixture();
    expect((await f.call("list", { saved: true })).status).toBe(200);
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: actor.userId, spaceId: actor.spaceId, hidden: false, saved: true },
      }),
    );
  });
  it("cannot hide someone else's item", async () => {
    const f = fixture();
    expect((await f.call("update", { id: "foreign", hidden: true })).status).toBe(404);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", userId: actor.userId, spaceId: actor.spaceId },
    });
  });
  it("cannot open someone else's article discussion", async () => {
    const f = fixture();
    await expect(
      resolveThreadTarget(f.deps.prisma, actor, { feedItemId: "foreign" }),
    ).rejects.toThrow();
    expect(f.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", userId: actor.userId, spaceId: actor.spaceId },
    });
  });
});
