import type { Actor } from "@rakazo/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountArtifactHttpRoutes } from "./artifact-http.js";

vi.mock("./thread-target.js", () => ({
  resolveThreadTarget: vi.fn(async (_db, _actor, input) => {
    if (input.botId !== "owned") throw new Error("not owned");
    return { kind: "bot", botId: "owned" };
  }),
}));
vi.mock("./artifacts.js", () => ({
  adapterContext: vi.fn(() => ({})),
  createOwnedArtifact: vi.fn(async (_deps, _actor, input) => {
    let size = 0;
    for await (const chunk of input.contentStream) size += chunk.byteLength;
    return { id: "artifact", size, mimeType: input.mimeType };
  }),
}));

function setup(signedIn = true) {
  const app = new Hono();
  const findFirst = vi.fn(async () => null);
  const deps = { prisma: { artifact: { findFirst } }, artifacts: { putStream: vi.fn() } };
  mountArtifactHttpRoutes(app, deps as never, async () =>
    signedIn ? ({ userId: "user", spaceId: "space" } as Actor) : null,
  );
  return { app, findFirst };
}
const upload = (botId = "owned") =>
  `/api/artifacts/upload?botId=${botId}&name=slides.pptx&mimeType=application%2Foctet-stream`;
const init = {
  method: "POST",
  headers: { "content-type": "application/octet-stream" },
  body: "file contents",
};

describe("binary artifacts", () => {
  it("requires authentication and conversation ownership", async () => {
    expect((await setup(false).app.request(upload(), init)).status).toBe(401);
    expect((await setup().app.request(upload("another-user"), init)).status).toBe(404);
  });
  it("infers Office files and stores the streamed body", async () => {
    const result = await setup().app.request(upload(), init);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      size: 13,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  });
  it("rejects form submissions and oversized declared bodies", async () => {
    const { app } = setup();
    expect(
      (await app.request(upload(), { ...init, headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    expect(
      (
        await app.request(upload(), {
          ...init,
          headers: { ...init.headers, "content-length": String(513 * 1024 * 1024) },
        })
      ).status,
    ).toBe(413);
  });
  it("scopes downloads to both the user and Space", async () => {
    const { app, findFirst } = setup();
    expect((await app.request("/api/artifacts/foreign/content")).status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", userId: "user", spaceId: "space" },
    });
  });
});
