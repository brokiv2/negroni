import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "./api";
import { sendCallTurn } from "./call-session";

vi.mock("./api", () => ({ rpc: vi.fn() }));
vi.mock("./call-turn", async (original) => ({
  ...(await original<typeof import("./call-turn")>()),
  callDelay: vi.fn(async () => undefined),
}));
const context = { apiBase: "https://example.test", headers: { authorization: "Bearer test" } };
const signal = new AbortController().signal;
beforeEach(() => vi.mocked(rpc).mockReset());
describe("call replies", () => {
  it("waits for the submitted run and reads only its final text", async () => {
    vi.mocked(rpc)
      .mockResolvedValueOnce({ runId: "run-new", seq: 4 })
      .mockResolvedValueOnce({ run: { id: "run-new", status: "running" }, messages: [] })
      .mockResolvedValueOnce({
        run: { id: "run-new", status: "completed" },
        messages: [
          { role: "bot", runId: "run-old", seq: 2, blocks: [{ kind: "text", text: "Old answer" }] },
          {
            role: "bot",
            runId: "run-new",
            seq: 6,
            blocks: [
              { kind: "text", text: "Here is the current answer." },
              { kind: "reasoning", text: "Private reasoning" },
            ],
          },
        ],
      });
    expect(await sendCallTurn("bot", "Hello", context, signal)).toEqual([
      "Here is the current answer.",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "threads/send",
      expect.objectContaining({ interactionMode: "voice" }),
      expect.anything(),
    );
    expect(vi.mocked(rpc).mock.calls.every((call) => call[2]?.requestContext === context)).toBe(
      true,
    );
  });
  it("returns control to chat for an approval", async () => {
    vi.mocked(rpc)
      .mockResolvedValueOnce({ runId: "run", seq: 1 })
      .mockResolvedValueOnce({ run: { id: "run", status: "waiting_input" }, messages: [] });
    await expect(sendCallTurn("bot", "Hello", context, signal)).rejects.toThrow("needs attention");
  });
  it("never sends after hangup", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sendCallTurn("bot", "Hello", context, controller.signal)).rejects.toThrow(
      "Call ended",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
