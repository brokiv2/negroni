import { RPCHandler } from "@orpc/server/fetch";
import { emptyModelRouting } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor = {
  userId: "user-fixture",
  spaceId: "space-fixture",
  email: "user@fixture.test",
  isDeploymentOwner: false,
};
function fixture() {
  const findUnique = vi.fn(async () => ({ modelRouting: null }));
  const update = vi.fn(async () => ({}));
  const deps = {
    prisma: {
      spaceMember: { findUnique, update },
      spaceModelPreference: { findMany: vi.fn(async () => []) },
      userModelCredential: { findMany: vi.fn(async () => []) },
    },
    env: { defaultProvider: "fake", defaultModel: "fake" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const call = async (name: string, input?: unknown) =>
    (
      await handler.handle(
        new Request(`http://fixture.test/rpc/models/${name}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor } },
      )
    ).response;
  return { call, findUnique, update };
}
describe("space model routing", () => {
  it("returns only enabled display choices without requiring credential access", async () => {
    const f = fixture();
    const response = await f.call("choices");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ json: [] });
    expect(f.findUnique).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      select: { modelRouting: true },
    });
  });
  it("reads only the authenticated member config and returns empty defaults for old accounts", async () => {
    const f = fixture();
    const response = await f.call("routing");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ json: emptyModelRouting() });
    expect(f.findUnique).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      select: { modelRouting: true },
    });
  });
  it("rejects unconnected models without changing settings", async () => {
    const f = fixture();
    const response = await f.call("saveRouting", {
      ...emptyModelRouting(),
      enabled: [{ provider: "unconnected", modelId: "model" }],
    });
    expect(response.status).toBe(400);
    expect(f.update).not.toHaveBeenCalled();
  });
  it("reads the stored background role when an older client omits it", async () => {
    const f = fixture();
    const { background: _omitted, ...older } = emptyModelRouting();
    const response = await f.call("saveRouting", older);
    expect(response.status).toBe(200);
    expect(f.findUnique).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      select: { modelRouting: true },
    });
    expect(f.update).toHaveBeenCalledWith({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      data: { modelRouting: emptyModelRouting() },
    });
  });
  it("does not accept a role outside the enabled set", async () => {
    const f = fixture();
    const response = await f.call("saveRouting", {
      ...emptyModelRouting(),
      router: { provider: "unconnected", modelId: "model" },
    });
    expect(response.status).toBe(400);
    expect(f.update).not.toHaveBeenCalled();
  });
});
