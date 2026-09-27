import { createHash } from "node:crypto";
import type {
  AdapterContext,
  ArtifactStore,
  ComputerRef,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import type { CardImageRef } from "@rakazo/contracts";
import type { BrowserCardBlock } from "@rakazo/core";
import { browserCardBlock, browserCardSiteLabel } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";

/**
 * A transcript card is not a file transfer. 2 MiB is generous for a 1280×800
 * PNG of a web page and five times below the 10 MiB attachment ceiling, so an
 * oversized frame is dropped from the card rather than pushed through the
 * artifact path. The card still renders — it just shows the placeholder.
 */
export const BROWSER_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

const SCREENSHOT_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

export type BrowserScreenshotDeps = {
  prisma: PrismaClient;
  artifacts: ArtifactStore;
  sandbox: Pick<SandboxProvider, "observe">;
};

export type BrowserScreenshotInput = {
  spaceId: string;
  userId: string;
  botId: string;
  groupId?: string;
  runId: string;
  computer: ComputerRef;
  context: AdapterContext;
  operationId: string;
  /** Artifact name; repeated captures of one site become versions of one entry. */
  name: string;
};

/**
 * Capture the page the bot is looking at and park it as an artifact.
 *
 * Why an artifact and not bytes in the block: a message is replayed on every
 * snapshot, so inline base64 would be re-sent forever, and a signed screen URL
 * sealed at emit time is dead within the hour (`SCREEN_PROXY_TTL_MS`). An
 * artifact id is small, permanent, fetched lazily by the client through the
 * authorization it already has, and re-checked against the run's ownership on
 * every read.
 *
 * Best effort by construction: every failure path returns `undefined` so a
 * browse never fails because its picture did not come out.
 */
export async function captureBrowserScreenshot(
  deps: BrowserScreenshotDeps,
  input: BrowserScreenshotInput,
): Promise<CardImageRef | undefined> {
  if (input.context.signal.aborted) return undefined;
  try {
    const observation = await deps.sandbox.observe(input.computer, input.context);
    // A cancelled run must not leave a new artifact row behind.
    if (input.context.signal.aborted) return undefined;
    const bytes = observation.image;
    if (!bytes?.byteLength) return undefined;
    if (bytes.byteLength > BROWSER_SCREENSHOT_MAX_BYTES) {
      getLogger().info("browser card screenshot dropped: over size budget", {
        bytes: bytes.byteLength,
        max: BROWSER_SCREENSHOT_MAX_BYTES,
      });
      return undefined;
    }
    const extension = SCREENSHOT_EXTENSION[observation.mimeType];
    if (!extension) return undefined;

    const hash = createHash("sha256").update(bytes).digest("hex");
    const width = Math.max(1, Math.trunc(observation.width));
    const height = Math.max(1, Math.trunc(observation.height));

    // The same page snapshotted twice in one run is the same picture. Reusing
    // the row keeps a browse loop from writing a hundred identical blobs.
    const existing = await deps.prisma.artifact.findFirst({
      where: {
        spaceId: input.spaceId,
        userId: input.userId,
        botId: input.botId,
        runId: input.runId,
        hash,
      },
      select: { id: true, mimeType: true },
    });
    if (existing) {
      return { artifactId: existing.id, mimeType: existing.mimeType, width, height };
    }

    const stored = await attachWorkspaceFileToThread(
      { prisma: deps.prisma, artifacts: deps.artifacts },
      {
        spaceId: input.spaceId,
        userId: input.userId,
        botId: input.botId,
        ...(input.groupId ? { groupId: input.groupId } : {}),
        runId: input.runId,
        filePath: `screenshots/${observation.frameId}${extension}`,
        bytes,
        operationId: input.operationId,
        name: input.name,
        description: "Page screenshot captured for the browser card",
      },
    );
    return { artifactId: stored.artifactId, mimeType: observation.mimeType, width, height };
  } catch (error) {
    getLogger().error("browser card screenshot capture", error);
    return undefined;
  }
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

/**
 * Turn a `browser_navigate` result into the card the transcript shows.
 * The requested URL is the fallback: a failed navigation still tells the
 * reader which page the bot was trying to open.
 */
export function browserCardFromNavigateResult(input: {
  requestedUrl: string;
  result: unknown;
  screenshot?: CardImageRef;
  computerId?: string;
}): BrowserCardBlock {
  const value =
    input.result && typeof input.result === "object"
      ? (input.result as Record<string, unknown>)
      : {};
  const error = readString(value, "error");
  const url = readString(value, "url") ?? input.requestedUrl;
  const title = readString(value, "title");
  return browserCardBlock({
    url,
    ...(title ? { title } : {}),
    status: error ? "error" : "ready",
    ...(error ? { error } : {}),
    // A screenshot of a page that failed to load is noise, not evidence.
    ...(!error && input.screenshot ? { screenshot: input.screenshot } : {}),
    ...(input.computerId ? { computerId: input.computerId } : {}),
  });
}

/** Artifact name for a capture, so one site's screenshots version together. */
export function browserScreenshotArtifactName(url: string): string {
  return `Screenshot — ${browserCardSiteLabel(url)}`;
}
