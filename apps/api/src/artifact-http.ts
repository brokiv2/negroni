import type { ArtifactStore } from "@rakazo/adapter-kit";
import type { Actor } from "@rakazo/contracts";
import {
  ArtifactUploadInput,
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
} from "@rakazo/contracts";
import { inferAttachmentMimeType } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import type { Context, Hono } from "hono";
import { adapterContext, createOwnedArtifact } from "./artifacts.js";
import type { ThreadTarget } from "./thread-target.js";
import { resolveThreadTarget } from "./thread-target.js";

/** Binary transport keeps large documents out of base64/JSON and phone memory. */
export function mountArtifactHttpRoutes(
  app: Hono,
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  actorFor: (c: Context) => Promise<Actor | null>,
) {
  app.get("/api/artifacts/limits", async (c) => {
    if (!(await actorFor(c))) return c.json({ error: "Sign in to upload files." }, 401);
    return c.json({
      maxBytes: ATTACHMENT_FILE_MAX_BYTES,
      maxCount: ATTACHMENT_MAX_COUNT,
    });
  });
  app.post("/api/artifacts/upload", async (c) => {
    const actor = await actorFor(c);
    if (!actor) return c.json({ error: "Sign in to upload files." }, 401);
    if (c.req.header("content-type")?.split(";")[0] !== "application/octet-stream")
      return c.json({ error: "Use binary file upload." }, 415);
    const input = ArtifactUploadInput.safeParse(c.req.query());
    if (!input.success) return c.json({ error: "Choose a file and a conversation." }, 400);
    const mimeType = inferAttachmentMimeType(input.data.name, input.data.mimeType);
    if (!mimeType) return c.json({ error: "This file format is not supported." }, 400);
    // Authenticate and resolve ownership before reading any file bytes.
    let target: ThreadTarget;
    try {
      target = await resolveThreadTarget(deps.prisma, actor, input.data);
    } catch {
      return c.json({ error: "Conversation not found." }, 404);
    }
    const botId = target.kind === "bot" ? target.botId : target.memberBotIds[0];
    if (!botId) return c.json({ error: "Conversation has no assistant." }, 400);
    const length = c.req.header("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > ATTACHMENT_FILE_MAX_BYTES))
      return c.json({ error: "This server accepts files up to 512 MB." }, 413);
    if (!c.req.raw.body) return c.json({ error: "The file is empty." }, 400);
    if (!deps.artifacts.putStream)
      return c.json({ error: "File streaming is unavailable on this server." }, 503);
    try {
      const artifact = await createOwnedArtifact(deps, actor, {
        ...input.data,
        mimeType,
        botId,
        groupId: target.kind === "group" ? target.groupId : undefined,
        contentStream: c.req.raw.body,
        signal: c.req.raw.signal,
      });
      return c.json(artifact);
    } catch (error) {
      if (error instanceof Error && /exceeds.*limit/.test(error.message))
        return c.json({ error: "This server accepts files up to 512 MB." }, 413);
      if (error instanceof Error && /content is empty/.test(error.message))
        return c.json({ error: "The file is empty." }, 400);
      throw error;
    }
  });
  app.get("/api/artifacts/:id/content", async (c) => {
    const actor = await actorFor(c);
    if (!actor) return c.json({ error: "Sign in to open files." }, 401);
    const row = await deps.prisma.artifact.findFirst({
      where: {
        id: c.req.param("id"),
        userId: actor.userId,
        spaceId: actor.spaceId,
      },
    });
    if (!row) return c.json({ error: "File not found." }, 404);
    const context = adapterContext(actor, row.botId ?? row.id, `artifact-download:${row.id}`);
    const body = deps.artifacts.getStream
      ? await deps.artifacts.getStream(row.storageKey, context)
      : await deps.artifacts.get(row.storageKey, context);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(row.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
