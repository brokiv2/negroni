import type { AdapterContext, ArtifactStore, ComputerRef } from "@rakazo/adapter-kit";
import { MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_SCREENSHOT_MAX_BYTES,
  browserCardFromNavigateResult,
  browserScreenshotArtifactName,
  captureBrowserScreenshot,
} from "./browser-card.js";

const computer: ComputerRef = { id: "c1", botId: "b1", kind: "fake", providerRef: "c1" };

function adapterContext(signal = new AbortController().signal): AdapterContext {
  return { operationId: "op-1", traceId: "op-1", spaceId: "space-1", userId: "user-1", signal };
}

function observation(bytes: Uint8Array, frameId = "frame-1") {
  return {
    frameId,
    capturedAt: "2026-09-27T10:00:00.000Z",
    mimeType: "image/png" as const,
    image: bytes,
    width: 1280,
    height: 800,
  };
}

function capturingDeps(options: { existing?: { id: string; mimeType: string } | null } = {}) {
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: "artifact-1",
    name: args.data.name,
    mimeType: args.data.mimeType,
    size: args.data.size,
  }));
  const artifact = {
    findFirst: vi.fn().mockResolvedValue(options.existing ?? null),
    create,
    aggregate: vi.fn().mockResolvedValue({ _max: { version: null } }),
  };
  const tx = { artifact, $queryRaw: vi.fn().mockResolvedValue([{ lock: "1" }]) };
  const put = vi.fn().mockResolvedValue({ id: "stored-1", hash: "hash" });
  return {
    artifactRow: artifact,
    put,
    deps: {
      prisma: {
        artifact,
        $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      } as unknown as PrismaClient,
      artifacts: { put, remove: vi.fn() } as unknown as ArtifactStore,
      sandbox: { observe: vi.fn() },
    },
  };
}

const input = {
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  runId: "run-1",
  computer,
  operationId: "op-1",
  name: "Screenshot — example.com",
};

describe("captureBrowserScreenshot", () => {
  it("stores the frame and returns a reference sized for the card", async () => {
    const { deps, put } = capturingDeps();
    deps.sandbox.observe = vi.fn().mockResolvedValue(observation(new Uint8Array([1, 2, 3])));

    const ref = await captureBrowserScreenshot(deps, { ...input, context: adapterContext() });

    expect(ref).toEqual({
      artifactId: "artifact-1",
      mimeType: "image/png",
      width: 1280,
      height: 800,
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("reuses the artifact when the same frame is captured twice in a run", async () => {
    // A browse loop on one page must not write a hundred identical blobs.
    const { deps, put } = capturingDeps({ existing: { id: "artifact-9", mimeType: "image/png" } });
    deps.sandbox.observe = vi.fn().mockResolvedValue(observation(new Uint8Array([1, 2, 3])));

    const ref = await captureBrowserScreenshot(deps, { ...input, context: adapterContext() });

    expect(ref).toMatchObject({ artifactId: "artifact-9" });
    expect(put).not.toHaveBeenCalled();
  });

  it("drops a frame over the size budget instead of pushing it through", async () => {
    const { deps, put } = capturingDeps();
    deps.sandbox.observe = vi
      .fn()
      .mockResolvedValue(observation(new Uint8Array(BROWSER_SCREENSHOT_MAX_BYTES + 1)));

    expect(await captureBrowserScreenshot(deps, { ...input, context: adapterContext() })).toBe(
      undefined,
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("does not observe at all once the run is aborted", async () => {
    const { deps } = capturingDeps();
    const observe = vi.fn();
    deps.sandbox.observe = observe;
    const controller = new AbortController();
    controller.abort();

    expect(
      await captureBrowserScreenshot(deps, {
        ...input,
        context: adapterContext(controller.signal),
      }),
    ).toBe(undefined);
    expect(observe).not.toHaveBeenCalled();
  });

  it("writes nothing when the run is cancelled while the frame is in flight", async () => {
    const { deps, put } = capturingDeps();
    const controller = new AbortController();
    deps.sandbox.observe = vi.fn(async () => {
      controller.abort();
      return observation(new Uint8Array([1, 2, 3]));
    });

    expect(
      await captureBrowserScreenshot(deps, {
        ...input,
        context: adapterContext(controller.signal),
      }),
    ).toBe(undefined);
    expect(put).not.toHaveBeenCalled();
  });

  it("swallows a capture failure so a browse never fails over its picture", async () => {
    const { deps } = capturingDeps();
    deps.sandbox.observe = vi.fn().mockRejectedValue(new Error("screen unavailable"));

    expect(await captureBrowserScreenshot(deps, { ...input, context: adapterContext() })).toBe(
      undefined,
    );
  });
});

describe("browserCardFromNavigateResult", () => {
  it("builds a ready card from a successful navigation", () => {
    const block = browserCardFromNavigateResult({
      requestedUrl: "https://example.com",
      result: { url: "https://example.com/pricing", title: "Pricing" },
      screenshot: { artifactId: "art_1", mimeType: "image/png", width: 1280, height: 800 },
      computerId: "cmp_1",
    });
    expect(MessageBlock.parse(block)).toEqual(block);
    expect(block).toMatchObject({
      status: "ready",
      url: "https://example.com/pricing",
      title: "Pricing",
      computerId: "cmp_1",
    });
  });

  it("keeps the requested URL when the navigation failed", () => {
    const block = browserCardFromNavigateResult({
      requestedUrl: "https://internal.example/reports",
      result: { error: "DNS lookup failed", fallback: "computer_act" },
    });
    expect(block).toMatchObject({
      status: "error",
      url: "https://internal.example/reports",
      error: "DNS lookup failed",
    });
  });

  it("never attaches a screenshot to a failed page", () => {
    // A picture of a page that did not load is noise, not evidence.
    const block = browserCardFromNavigateResult({
      requestedUrl: "https://example.com",
      result: { error: "timed out" },
      screenshot: { artifactId: "art_1", mimeType: "image/png", width: 10, height: 10 },
    });
    expect("screenshot" in block).toBe(false);
  });

  it("survives a result shape it does not recognize", () => {
    const block = browserCardFromNavigateResult({
      requestedUrl: "https://example.com",
      result: "not an object",
    });
    expect(MessageBlock.safeParse(block).success).toBe(true);
    expect(block.url).toBe("https://example.com");
  });
});

describe("browserScreenshotArtifactName", () => {
  it("names by host so one site's captures version together", () => {
    expect(browserScreenshotArtifactName("https://www.example.com/a")).toBe(
      "Screenshot — example.com",
    );
  });
});

describe("redactBlocks over tool cards", () => {
  it("scrubs a filled login out of every free-text field on a card", async () => {
    // A page echoes back what was typed into it, so a card can carry a secret
    // in its title, its URL query or its summary.
    const { redactBlocks } = await import("./executor.js");
    const [browser, mail, plan] = redactBlocks(
      [
        browserCardFromNavigateResult({
          requestedUrl: "https://example.com/?q=hunter2",
          result: { url: "https://example.com/?q=hunter2", title: "Results for hunter2" },
        }),
        {
          kind: "mail",
          summary: "hunter2 in the subject",
          mode: "thread",
          subject: "hunter2",
          excerpt: "the password is hunter2",
        },
        {
          kind: "plan",
          summary: "Sign in as hunter2",
          title: "Sign in as hunter2",
          status: "running",
          steps: [{ title: "Type hunter2", status: "done", detail: "hunter2" }],
        },
      ],
      ["hunter2"],
    );

    expect(JSON.stringify([browser, mail, plan])).not.toContain("hunter2");
    expect(browser).toMatchObject({ url: "https://example.com/?q=[redacted]" });
    expect(plan).toMatchObject({ steps: [{ title: "Type [redacted]", detail: "[redacted]" }] });
  });
});
