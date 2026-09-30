import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { answerRunInput } from "./events.js";

const draft = {
  account: "Demo mail",
  to: ["test@example.test"],
  cc: [],
  subject: "Agenda",
  body: "Hello",
};
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "thread" }]),
    run: {
      findUnique: vi.fn().mockResolvedValue({ status: "queued", startedAt: new Date() }),
      findFirst: vi.fn().mockResolvedValue({ botId: "bot", userId: "owner" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    message: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: "message",
          blocks: [{ kind: "ask", text: "Agenda", status: "pending", emailDraft: draft }],
        }),
      update: vi.fn().mockResolvedValue({ id: "message" }),
    },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    thread: { update: vi.fn().mockResolvedValue({ nextEventSeq: 2 }) },
    event: { create: vi.fn(async ({ data }) => data) },
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaClient;
  const answer = (value: unknown) =>
    answerRunInput(prisma, {
      spaceId: "space",
      threadId: "thread",
      runId: "run",
      messageId: "message",
      answeredByUserId: "owner",
      answer: JSON.stringify(value),
    });
  return { tx, answer };
}
describe("email review persistence", () => {
  it("queues the exact reviewed draft and records a request, not a delivery", async () => {
    const f = fixture();
    const edited = { ...draft, subject: "Revised agenda", body: "New body" };
    expect(await f.answer({ type: "email_review", action: "send", draft: edited })).toBe(true);
    expect(f.tx.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          blocks: [
            expect.objectContaining({ emailDraft: edited, answer: "send", status: "answered" }),
          ],
        },
      }),
    );
    const prompt = f.tx.task.updateMany.mock.calls[0]![0].data.prompt;
    expect(prompt).toContain(JSON.stringify(edited));
    expect(prompt).toContain("Send it once");
    expect(prompt).toContain("Report the actual provider result");
  });
  it("does not queue a malformed review or change the sending account", async () => {
    for (const change of [{ to: ["broken"] }, { account: "Another account" }]) {
      const f = fixture();
      expect(
        await f.answer({ type: "email_review", action: "send", draft: { ...draft, ...change } }),
      ).toBe(false);
      expect(f.tx.run.updateMany).not.toHaveBeenCalled();
    }
  });
  it("cancels without requesting a send", async () => {
    const f = fixture();
    expect(await f.answer({ type: "email_review", action: "cancel", draft })).toBe(true);
    expect(f.tx.task.updateMany.mock.calls[0]![0].data.prompt).toContain("Do not send");
  });
});
