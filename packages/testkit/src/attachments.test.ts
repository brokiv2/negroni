import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@rakazo/adapter-kit";
import type { ThreadSnapshot } from "@rakazo/contracts";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BotIntroHarness } from "./discard-bot-intro.js";
import { discardBotIntroFromCreate } from "./discard-bot-intro.js";
import { sessionCookieHeader } from "./index.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeAttachments = hasDb ? describe : describe.skip;
let botIntroHarness: BotIntroHarness | undefined;

describeAttachments("chat attachments", () => {
  let app: App;
  let stop: () => Promise<void>;
  let runtime: AgentRuntime;
  const stamp = Date.now();
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-attachments-"));
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    const handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
    });
    app = handles.app;
    stop = handles.stop;
    runtime = handles.runtime;
    botIntroHarness = handles;
  });

  afterAll(async () => {
    try {
      await stop?.();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("persists a composed image reference and serves bytes only to its conversation owner", async () => {
    const owner = await signup(app, `image-owner-${stamp}@rakazo.test`, "Image Owner");
    const other = await signup(app, `image-other-${stamp}@rakazo.test`, "Other User");
    const bot = await rpc<{ id: string }>(app, owner, "bots/create", {
      name: "Image Assistant",
      title: "Image Assistant",
      description: "synthetic image QA",
      instructions: "",
      notifyOnFinish: false,
    });
    const artifact = await rpc<{ id: string }>(app, owner, "artifacts/create", {
      botId: bot.id,
      name: "pixel.png",
      mimeType: "image/png",
      contentBase64: tinyPng.toString("base64"),
    });
    const spec = {
      root: "photo",
      state: {},
      summary: "Attached pixel",
      elements: {
        photo: {
          type: "Image",
          props: {
            artifactId: artifact.id,
            alt: "Attached pixel",
            caption: "Synthetic image fixture",
          },
          children: [],
        },
      },
    };
    const output =
      "```negroni-ui\n" +
      Object.entries(spec)
        .map(([key, value]) => JSON.stringify({ op: "add", path: `/${key}`, value }))
        .join("\n") +
      "\n```";
    const scripted = vi.spyOn(runtime, "run").mockImplementation(async function* () {
      yield { type: "text", text: output };
      yield { type: "done", text: output };
    });
    try {
      await sendAndWait(app, owner, bot.id, { text: "Show the attached synthetic image" });
      const snapshot = await rpc<ThreadSnapshot>(app, owner, "threads/get", { botId: bot.id });
      const composed = snapshot.messages
        .flatMap((message) => message.blocks)
        .find((block) => block.kind === "response_ui");
      expect(composed).toMatchObject({
        kind: "response_ui",
        complete: true,
        spec: { elements: { photo: spec.elements.photo } },
      });
      const fetched = await rpc<{ contentBase64: string }>(app, owner, "artifacts/get", {
        botId: bot.id,
        artifactId: artifact.id,
      });
      expect(fetched.contentBase64).toBe(tinyPng.toString("base64"));
      expect(
        (
          await raw(app, other, "artifacts/get", {
            botId: bot.id,
            artifactId: artifact.id,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (await raw(app, "", "artifacts/get", { botId: bot.id, artifactId: artifact.id })).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await raw(app, owner, "artifacts/get", {
            botId: bot.id,
            artifactId: "missing-image",
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    } finally {
      scripted.mockRestore();
    }
  });

  it("creates and reads owned feed-chat images while rejecting foreign feed targets", async () => {
    const owner = await signup(app, `feed-image-owner-${stamp}@rakazo.test`, "Feed Image Owner");
    const other = await signup(app, `feed-image-other-${stamp}@rakazo.test`, "Other Feed User");
    const bot = await rpc<{ id: string }>(app, owner, "bots/create", {
      name: "Feed Image Assistant",
      title: "Feed Image Assistant",
      description: "synthetic feed image QA",
      instructions: "",
      notifyOnFinish: false,
    });
    const prisma = botIntroHarness!.prisma;
    const ownedBot = await prisma.bot.findUniqueOrThrow({ where: { id: bot.id } });
    const feed = await prisma.feedItem.create({
      data: {
        botId: bot.id,
        userId: ownedBot.userId,
        spaceId: ownedBot.spaceId,
        dedupKey: "synthetic-feed-image",
        kind: "note",
        title: "Synthetic image note",
        summary: "Synthetic image fixture",
        content: "Synthetic image fixture",
      },
    });
    const image = await rpc<{ id: string }>(app, owner, "artifacts/create", {
      feedItemId: feed.id,
      name: "feed-pixel.png",
      mimeType: "image/png",
      contentBase64: tinyPng.toString("base64"),
    });
    const fetched = await rpc<{ id: string; contentBase64: string }>(app, owner, "artifacts/get", {
      feedItemId: feed.id,
      artifactId: image.id,
    });
    expect(fetched.id).toBe(image.id);
    expect(fetched.contentBase64).toBe(tinyPng.toString("base64"));
    for (const [cookie, feedItemId] of [
      [other, feed.id],
      [owner, "missing-feed"],
    ]) {
      expect(
        (
          await raw(app, cookie!, "artifacts/get", {
            feedItemId,
            artifactId: image.id,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await raw(app, cookie!, "artifacts/create", {
            feedItemId,
            name: "denied.png",
            mimeType: "image/png",
            contentBase64: tinyPng.toString("base64"),
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
  });

  it("uploads, sends with image/file, and rejects invalid attachments", async () => {
    const cookie = await signup(app, `attachments-${stamp}@rakazo.test`, "Attachment User");
    const bot = await rpc<{ id: string }>(app, cookie, "bots/create", {
      name: "Attacher",
      title: "Attacher",
      description: "tests attachments",
      instructions: "",
      notifyOnFinish: true,
    });

    const image = await rpc<{ id: string; mimeType: string }>(app, cookie, "artifacts/create", {
      botId: bot.id,
      name: "pixel.png",
      mimeType: "image/png",
      contentBase64: tinyPng.toString("base64"),
    });
    const file = await rpc<{ id: string }>(app, cookie, "artifacts/create", {
      botId: bot.id,
      name: "notes.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello attachment").toString("base64"),
    });

    await sendAndWait(app, cookie, bot.id, { text: "see this", artifactIds: [image.id] });
    let snapshot = await rpc<ThreadSnapshot>(app, cookie, "threads/get", { botId: bot.id });
    const imageMessage = snapshot.messages.find((message) =>
      message.blocks.some((block) => block.kind === "image"),
    );
    expect(imageMessage?.blocks).toEqual(
      expect.arrayContaining([
        { kind: "text", text: "see this" },
        expect.objectContaining({ kind: "image", artifactId: image.id, name: "pixel.png" }),
      ]),
    );

    await sendAndWait(app, cookie, bot.id, { artifactIds: [file.id] });
    snapshot = await rpc<ThreadSnapshot>(app, cookie, "threads/get", { botId: bot.id });
    const fileMessage = snapshot.messages.find((message) =>
      message.blocks.some((block) => block.kind === "file"),
    );
    expect(fileMessage?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "file", artifactId: file.id, name: "notes.txt" }),
      ]),
    );

    const fetched = await rpc<{ contentBase64: string }>(app, cookie, "artifacts/get", {
      botId: bot.id,
      artifactId: image.id,
    });
    expect(fetched.contentBase64).toBe(tinyPng.toString("base64"));

    const badMime = await raw(app, cookie, "artifacts/create", {
      botId: bot.id,
      name: "evil.zip",
      mimeType: "invalid-mime",
      contentBase64: Buffer.from("zip").toString("base64"),
    });
    expect(badMime.status).toBeGreaterThanOrEqual(400);

    const oversize = await raw(app, cookie, "artifacts/create", {
      botId: bot.id,
      name: "big.bin",
      mimeType: "text/plain",
      contentBase64: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 1).toString("base64"),
    });
    expect(oversize.status).toBeGreaterThanOrEqual(400);
  });

  it("attaches a workspace file into the thread", async () => {
    const cookie = await signup(app, `attach-thread-${stamp}@rakazo.test`, "Attach Thread User");
    const bot = await rpc<{ id: string }>(app, cookie, "bots/create", {
      name: "Attacher",
      title: "Attacher",
      description: "tests attach_file",
      instructions: "",
      notifyOnFinish: true,
    });
    await sendAndWait(app, cookie, bot.id, {
      text: "write notes/result.txt and attach it to the thread",
    });
    const snapshot = await rpc<ThreadSnapshot>(app, cookie, "threads/get", { botId: bot.id });
    const fileMessage = snapshot.messages.find((message) =>
      message.blocks.some((block) => block.kind === "file"),
    );
    const fileBlock = fileMessage?.blocks.find((block) => block.kind === "file");
    expect(fileBlock).toMatchObject({ kind: "file", name: "result.txt" });
    if (fileBlock?.kind !== "file") throw new Error("expected file block");
    const fetched = await rpc<{ contentBase64: string }>(app, cookie, "artifacts/get", {
      botId: bot.id,
      artifactId: fileBlock.artifactId,
    });
    expect(Buffer.from(fetched.contentBase64, "base64").toString("utf8")).toContain(
      "write notes/result.txt and attach it to the thread",
    );
  });
});

async function signup(app: App, email: string, name: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, password: "test-password-123", name }),
  });
  expect(response.status).toBeLessThan(400);
  return sessionCookieHeader(response);
}

async function rpc<T>(app: App, cookie: string, proc: string, body: unknown = {}): Promise<T> {
  const res = await raw(app, cookie, proc, body);
  const text = await res.text();
  const parsed = JSON.parse(text) as { json?: T; error?: { message?: string } };
  if (res.status >= 400 || parsed.error) {
    throw new Error(`${proc} ${res.status}: ${parsed.error?.message ?? text}`);
  }
  return discardBotIntroFromCreate(botIntroHarness, cookie, proc, parsed.json as T);
}

async function raw(app: App, cookie: string, proc: string, body: unknown) {
  return app.request(`/rpc/${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({ json: body }),
  });
}

async function sendAndWait(
  app: App,
  cookie: string,
  botId: string,
  input: { text?: string; artifactIds?: string[] },
) {
  await rpc(app, cookie, "threads/send", { botId, ...input });
  await waitFor(
    app,
    cookie,
    botId,
    (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
  );
}

async function waitFor(
  app: App,
  cookie: string,
  botId: string,
  pred: (snap: ThreadSnapshot) => boolean,
) {
  const start = Date.now();
  let last: ThreadSnapshot | null = null;
  while (Date.now() - start < 20_000) {
    last = await rpc<ThreadSnapshot>(app, cookie, "threads/get", { botId });
    if (pred(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout waiting for thread: ${JSON.stringify(last)}`);
}
