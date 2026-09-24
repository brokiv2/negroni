import { describe, expect, it, vi } from "vitest";

vi.mock("@rakazo/db", async (original) => ({
  ...(await original<typeof import("@rakazo/db")>()),
  createThreadMessageInTransaction: vi.fn(async () => ({ id: "message", seq: 7 })),
  appendEventInTransaction: vi.fn(async () => ({ seq: 20 })),
}));
vi.mock("./artifacts.js", () => ({
  resolveSendAttachments: vi.fn(async () => ({ blocks: [], artifacts: [] })),
  buildUserMessageBlocks: (text: string) => [{ kind: "text", text }],
  buildSendPrompt: (text: string) => text,
}));

import { sendThreadMessage } from "./thread-target.js";

function fixture(active = false, threadKind: "team" | "personal" = "team") {
  const tx = {
    message: { findUnique: vi.fn(async () => null), update: vi.fn() },
    task: { create: vi.fn(async () => ({ id: "task" })) },
    run: {
      findFirst: vi.fn(async () => (active ? { id: "busy", status: "running" } : null)),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "run", taskId: "task", status: "queued" })),
    },
    steeringMessage: { create: vi.fn() },
  };
  const deps = {
    prisma: { ...tx, $transaction: async (fn: (db: typeof tx) => unknown) => fn(tx) },
    events: { notify: vi.fn(async () => undefined) },
    jobs: { enqueue: vi.fn(async () => undefined) },
  };
  const send = (input: { interactionMode?: "voice" | "chat"; clientNonce?: string }) =>
    sendThreadMessage(
      deps as never,
      { userId: "user", spaceId: "space" } as never,
      { kind: "bot", botId: "bot", threadId: "thread", threadKind } as never,
      { text: "Hello", ...input },
    );
  return { tx, send };
}
describe("voice run intent", () => {
  it.each([
    [{ interactionMode: "voice" as const }, "voice"],
    [{ clientNonce: "call-legacy-client" }, "voice"],
    [{ interactionMode: "chat" as const, clientNonce: "call-explicit-chat" }, "chat"],
    [{}, "chat"],
  ])("persists the turn mode without changing the bot: %j", async (input, mode) => {
    const { tx, send } = fixture();
    await send(input);
    expect(tx.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ interactionMode: mode, trigger: "user" }),
      }),
    );
  });
  it("does not steer a voice turn into an already running chat job", async () => {
    const { tx, send } = fixture(true);
    await expect(send({ interactionMode: "voice" })).rejects.toThrow("already working");
    expect(tx.steeringMessage.create).not.toHaveBeenCalled();
    expect(tx.run.create).not.toHaveBeenCalled();
  });
  it.each([
    [{}, "personal"],
    [{ interactionMode: "chat" as const }, "personal"],
    [{ interactionMode: "voice" as const }, "voice"],
  ])("runs a Personal thread turn in personal mode: %j", async (input, mode) => {
    const { tx, send } = fixture(false, "personal");
    await send(input);
    expect(tx.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ interactionMode: mode, trigger: "user" }),
      }),
    );
  });
});
