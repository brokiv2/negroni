import type { ArtifactWithContent, CardImageRef } from "@rakazo/contracts";
import { rpc } from "../api";

/**
 * Card images are artifact ids, never bytes and never a signed URL — a URL
 * sealed at emit time would be dead by the time the transcript is replayed. This
 * resolves one through the authorized artifact path and hands back a data URI
 * React Native's `Image` can render.
 *
 * Two things keep a long transcript honest:
 *
 * - **One fetch per artifact, ever.** Results are cached by id, so scrolling a
 *   screenshot in and out of view costs nothing after the first load.
 * - **A concurrency gate.** A transcript with forty browser cards must not open
 *   forty requests; at most `MAX_IN_FLIGHT` run at a time and the rest wait.
 */

const MAX_IN_FLIGHT = 3;
/** Enough for a screen of screenshots without holding a session's worth of bytes. */
const MAX_CACHED = 24;

export type ArtifactImageTarget = { botId: string } | { groupId: string };

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let running = 0;

function remember(artifactId: string, uri: string): void {
  cache.delete(artifactId);
  cache.set(artifactId, uri);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function acquire(): Promise<void> {
  if (running < MAX_IN_FLIGHT) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
}

function release(): void {
  running -= 1;
  waiting.shift()?.();
}

/** The cached data URI, if this artifact has already been loaded. */
export function cachedArtifactImage(artifactId: string): string | undefined {
  return cache.get(artifactId);
}

export async function loadArtifactImage(
  target: ArtifactImageTarget,
  image: CardImageRef,
): Promise<string> {
  const cached = cache.get(image.artifactId);
  if (cached) return cached;
  const pending = inFlight.get(image.artifactId);
  if (pending) return pending;

  const request = (async () => {
    await acquire();
    try {
      const artifact = await rpc<ArtifactWithContent>("artifacts/get", {
        ...target,
        artifactId: image.artifactId,
      });
      const mimeType = artifact.mimeType || image.mimeType;
      const uri = `data:${mimeType};base64,${artifact.contentBase64}`;
      remember(image.artifactId, uri);
      return uri;
    } finally {
      release();
      inFlight.delete(image.artifactId);
    }
  })();
  inFlight.set(image.artifactId, request);
  return request;
}

/** The box to reserve before the bytes arrive, so a load never reflows the list. */
export function cardImageAspectRatio(image: CardImageRef): number {
  return image.height > 0 ? image.width / image.height : 1;
}

/** Test-only: drop everything cached and in flight. */
export function resetArtifactImageCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  waiting.length = 0;
  running = 0;
}
