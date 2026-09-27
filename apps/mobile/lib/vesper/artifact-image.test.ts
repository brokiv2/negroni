import type { CardImageRef } from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({ rpc }));

import {
  cachedArtifactImage,
  cardImageAspectRatio,
  loadArtifactImage,
  resetArtifactImageCacheForTests,
} from "./artifact-image";

function ref(artifactId: string, patch: Partial<CardImageRef> = {}): CardImageRef {
  return { artifactId, mimeType: "image/png", width: 1280, height: 800, ...patch };
}

describe("card image loading", () => {
  beforeEach(() => {
    resetArtifactImageCacheForTests();
    rpc.mockReset();
  });

  afterEach(() => {
    resetArtifactImageCacheForTests();
  });

  it("resolves an artifact id into a data URI", async () => {
    rpc.mockResolvedValue({ mimeType: "image/png", contentBase64: "AAAA" });

    await expect(loadArtifactImage({ botId: "bot_1" }, ref("art_1"))).resolves.toBe(
      "data:image/png;base64,AAAA",
    );
    expect(rpc).toHaveBeenCalledWith("artifacts/get", { botId: "bot_1", artifactId: "art_1" });
  });

  it("fetches one artifact once, however many cards show it", async () => {
    rpc.mockResolvedValue({ mimeType: "image/png", contentBase64: "AAAA" });

    await loadArtifactImage({ botId: "bot_1" }, ref("art_1"));
    await loadArtifactImage({ botId: "bot_1" }, ref("art_1"));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(cachedArtifactImage("art_1")).toBe("data:image/png;base64,AAAA");
  });

  it("shares one request between concurrent callers", async () => {
    rpc.mockResolvedValue({ mimeType: "image/png", contentBase64: "AAAA" });

    const [first, second] = await Promise.all([
      loadArtifactImage({ botId: "bot_1" }, ref("art_1")),
      loadArtifactImage({ botId: "bot_1" }, ref("art_1")),
    ]);

    expect(first).toBe(second);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps a long transcript to three requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    rpc.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return { mimeType: "image/png", contentBase64: "AAAA" };
    });

    const loads = Array.from({ length: 12 }, (_, index) =>
      loadArtifactImage({ botId: "bot_1" }, ref(`art_${index}`)),
    );
    // Let every acquire that can start, start.
    for (let pass = 0; pass < 20; pass += 1) {
      await Promise.resolve();
      while (gates.length) gates.shift()?.();
    }
    await Promise.all(loads);

    expect(peak).toBeLessThanOrEqual(3);
    expect(rpc).toHaveBeenCalledTimes(12);
  });

  it("does not cache a failure, and frees the slot it held", async () => {
    rpc.mockRejectedValueOnce(new Error("offline"));
    await expect(loadArtifactImage({ botId: "bot_1" }, ref("art_1"))).rejects.toThrow("offline");
    expect(cachedArtifactImage("art_1")).toBeUndefined();

    rpc.mockResolvedValueOnce({ mimeType: "image/png", contentBase64: "BBBB" });
    await expect(loadArtifactImage({ botId: "bot_1" }, ref("art_1"))).resolves.toBe(
      "data:image/png;base64,BBBB",
    );
  });

  it("falls back to the ref's mime type when the artifact does not report one", async () => {
    rpc.mockResolvedValue({ mimeType: "", contentBase64: "AAAA" });
    await expect(
      loadArtifactImage({ botId: "bot_1" }, ref("art_1", { mimeType: "image/jpeg" })),
    ).resolves.toBe("data:image/jpeg;base64,AAAA");
  });

  it("resolves against a group when the thread is one", async () => {
    rpc.mockResolvedValue({ mimeType: "image/png", contentBase64: "AAAA" });
    await loadArtifactImage({ groupId: "grp_1" }, ref("art_1"));
    expect(rpc).toHaveBeenCalledWith("artifacts/get", { groupId: "grp_1", artifactId: "art_1" });
  });
});

describe("reserving the box", () => {
  it("uses the ref's own dimensions so a load never reflows the list", () => {
    expect(cardImageAspectRatio(ref("art_1"))).toBe(1.6);
    expect(cardImageAspectRatio(ref("art_1", { width: 800, height: 800 }))).toBe(1);
  });

  it("does not divide by zero on a malformed ref", () => {
    expect(cardImageAspectRatio(ref("art_1", { height: 0 }))).toBe(1);
  });
});
