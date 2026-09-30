import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { shouldInterrupt } from "./account-research.js";
import { gmailMessages, observeGmail } from "./gmail-observation.js";

describe("mail observation", () => {
  it("accepts supported envelopes and fails closed on malformed or failed reads", () => {
    expect(gmailMessages({ data: { messages: [] } })).toEqual([]);
    expect(() => gmailMessages({ successful: false, data: { messages: [] } })).toThrow();
    expect(() => gmailMessages({ data: {} })).toThrow();
  });
  it("pins the account, skips seen mail and codes, and reads bounded snippets", async () => {
    const execute = vi.fn(async function* () {
      yield {
        type: "result",
        data: {
          data: {
            messages: [
              { id: "seen", snippet: "Existing message" },
              {
                messageId: "preview",
                messageText: "",
                preview: { body: "An event was rescheduled", subject: "Updated event" },
                subject: "Updated event",
              },
              { id: "code", subject: "Your verification code", snippet: "123456" },
              {
                id: "login",
                subject: "New login",
                snippet: "New login from an unfamiliar location",
                attachment: "secret",
              },
            ],
          },
        },
      };
    });
    const beforeRead = vi.fn(async () => undefined);
    const result = await observeGmail(
      { execute } as unknown as ConnectorProvider,
      {
        connectionId: "chosen",
        since: new Date().toISOString(),
        seenDocumentIds: ["seen"],
        beforeRead,
      },
      { runId: "run", signal: new AbortController().signal } as AdapterContext,
    );
    expect(result.map((r) => r.id)).toEqual(["preview", "login"]);
    expect(result[0]!.text).toContain("An event was rescheduled");
    expect(result[0]!.text).not.toContain("[object Object]");
    expect(result[1]!.text).not.toContain("secret");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "chosen",
        args: expect.objectContaining({
          _account: "chosen",
          max_results: 20,
          include_payload: false,
        }),
      }),
      expect.anything(),
    );
    expect(beforeRead).toHaveBeenCalledOnce();
  });
  it("does not read a source whose permission was revoked", async () => {
    const execute = vi.fn();
    await expect(
      observeGmail(
        { execute } as unknown as ConnectorProvider,
        {
          connectionId: "chosen",
          since: new Date().toISOString(),
          beforeRead: async () => {
            throw new Error("revoked");
          },
        },
        { signal: new AbortController().signal } as AdapterContext,
      ),
    ).rejects.toThrow("revoked");
    expect(execute).not.toHaveBeenCalled();
  });
});
describe("important-update gate", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const candidate = {
    urgency: "time_sensitive",
    interruptReason: "A source reports a new unexpected account login just now.",
    confidence: 0.98,
    expiresAt: "2026-09-30T18:00:00Z",
  };
  it("requires urgency, evidence confidence, local waking hours and short expiry", () => {
    expect(shouldInterrupt(candidate, "UTC", now)).toBe(true);
    expect(shouldInterrupt({ ...candidate, urgency: "quiet" }, "UTC", now)).toBe(false);
    expect(shouldInterrupt({ ...candidate, confidence: 0.89 }, "UTC", now)).toBe(false);
    expect(shouldInterrupt(candidate, "Pacific/Auckland", now)).toBe(false);
    expect(shouldInterrupt({ ...candidate, expiresAt: "2026-10-05T18:00:00Z" }, "UTC", now)).toBe(
      false,
    );
    expect(shouldInterrupt({ ...candidate, expiresAt: now.toISOString() }, "UTC", now)).toBe(false);
  });
});
