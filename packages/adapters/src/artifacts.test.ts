import { mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "./artifacts.js";

const dirs: string[] = [];
const context = { spaceId: "space-1" } as never;

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("LocalArtifactStore", () => {
  it("creates artifact files with owner-only permissions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-artifacts-"));
    dirs.push(root);
    const store = new LocalArtifactStore(root);

    const stored = await store.put(
      {
        name: "private.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("private"),
      },
      context,
    );

    const info = await stat(path.join(root, "artifacts", "space-1", stored.id));
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("does not follow a replacement symlink when reading an artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-artifacts-"));
    dirs.push(root);
    const store = new LocalArtifactStore(root);
    const stored = await store.put(
      {
        name: "private.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("private"),
      },
      context,
    );
    const file = path.join(root, "artifacts", "space-1", stored.id);
    const target = path.join(root, "outside.txt");
    await writeFile(target, "outside");
    await rm(file);
    await symlink(target, file);

    await expect(store.get(stored.id, context)).rejects.toThrow();
  });
});

it("streams a large file and removes an interrupted or oversized upload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-artifacts-stream-"));
  dirs.push(root);
  const store = new LocalArtifactStore(root);
  const ctx = {
    spaceId: "space-1",
    signal: new AbortController().signal,
  } as never;
  async function* chunks() {
    for (let i = 0; i < 24; i++) yield new Uint8Array(1024 * 1024).fill(i);
  }
  const stored = await store.putStream(
    {
      name: "deck.pptx",
      mimeType: "application/zip",
      stream: chunks(),
      maxBytes: 32 * 1024 * 1024,
    },
    ctx,
  );
  expect(stored.size).toBe(24 * 1024 * 1024);
  const downloaded = new Uint8Array(
    await new Response(await store.getStream(stored.id, ctx)).arrayBuffer(),
  );
  expect(downloaded.length).toBe(stored.size);
  expect(downloaded.at(-1)).toBe(23);
  await expect(
    store.putStream(
      {
        name: "large",
        mimeType: "text/plain",
        stream: chunks(),
        maxBytes: 1024,
      },
      ctx,
    ),
  ).rejects.toThrow("limit");
  async function* interrupted() {
    yield new Uint8Array(100);
    throw new Error("interrupted");
  }
  await expect(
    store.putStream(
      {
        name: "broken",
        mimeType: "text/plain",
        stream: interrupted(),
        maxBytes: 1024,
      },
      ctx,
    ),
  ).rejects.toThrow("interrupted");
  expect(await readdir(path.join(root, "artifacts", "space-1"))).toEqual([stored.id]);
});
