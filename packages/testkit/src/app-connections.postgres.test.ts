import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@rakazo/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../../apps/api/src/app.ts";

import { discardBotIntroRun } from "./discard-bot-intro.js";

const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
(enabled ? describe : describe.skip)("contextual connector workflow", () => {
  let handles: Awaited<ReturnType<typeof createApp>>;
  const dataDir = mkdtempSync(path.join(tmpdir(), "negroni-app-connect-"));
  let cookie: string;
  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      defaultProvider: "scripted",
      defaultModel: "scripted",
      composio: new ComposioEmulator(),
      signupsEnabled: "true",
    });
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        email: `connect-${Date.now()}@example.test`,
        password: "test-password-123",
        name: "Connector QA",
      }),
    });
    expect(response.ok).toBe(true);
    cookie = `better-auth.session_token=${response.headers.get("set-cookie")!.match(/better-auth\.session_token=([^;]+)/)![1]}`;
  });
  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });
  async function rpc(procedure: string, input: unknown = {}) {
    const response = await handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173", cookie },
      body: JSON.stringify({ json: input }),
    });
    expect(response.status, procedure).toBe(200);
    return ((await response.json()) as { json: any }).json;
  }
  it("persists one real card, connects, and replays the continuation without duplicate runs", async () => {
    const bot = await rpc("bots/create", {
      name: "Assistant",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const target = { botId: bot.id, threadKind: "team" };
    await discardBotIntroRun(handles, cookie, bot.id);
    const thread = await handles.prisma.thread.findUniqueOrThrow({
      where: { botId_kind: { botId: bot.id, kind: "team" } },
    });
    handles.runtime.run = async function* (request) {
      if (request.prompt.includes("Connected Gmail")) {
        yield { type: "done", text: "Resumed." };
        return;
      }
      yield { type: "tool", name: "search_apps", args: { query: "Gmail" }, executionId: "search" };
      for (const id of ["first", "retry"]) {
        yield {
          type: "tool",
          name: "request_app_connection",
          args: { connectorId: "composio", provider: "GMAIL" },
          executionId: id,
        };
      }
      yield { type: "done", text: "" };
    };
    const sent = await rpc("threads/send", {
      ...target,
      text: "Read my Gmail",
      clientNonce: "question",
    });
    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: sent.runId } });
    await expect
      .poll(
        async () => (await handles.prisma.run.findUniqueOrThrow({ where: { id: run.id } })).status,
      )
      .toBe("completed");
    const saved = await handles.prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("completed");
    const cards = await handles.prisma.message.findMany({
      where: { threadId: thread.id, clientNonce: { startsWith: "app-connect:" } },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.blocks).toMatchObject([
      {
        kind: "app_connect",
        provider: "GMAIL",
        sourceMessageId: run.sourceMessageId,
        requestId: run.id,
      },
    ]);
    expect(await handles.prisma.connection.count({ where: { userId: run.userId } })).toBe(0);
    const started = await rpc("connections/begin", { connectorId: "composio", provider: "GMAIL" });
    const connected = await rpc("connections/complete", { connectionId: started.connectionId });
    expect(connected.status).toBe("connected");
    const continuation = {
      ...target,
      text: "Connected Gmail. Continue the original request.",
      clientNonce: `connected:${cards[0]!.id}:GMAIL`,
      replyToMessageId: run.sourceMessageId,
    };
    const first = await rpc("threads/send", continuation);
    const second = await rpc("threads/send", continuation);
    expect(second.seq).toBe(first.seq);
    expect(second.runId).toBe(first.runId);
    expect(
      await handles.prisma.run.count({
        where: { threadId: thread.id, id: first.runId },
      }),
    ).toBe(1);
    expect(
      (
        await handles.prisma.message.findUniqueOrThrow({
          where: { threadId_seq: { threadId: thread.id, seq: first.seq } },
        })
      ).replyToMessageId,
    ).toBe(run.sourceMessageId);
  });
});
