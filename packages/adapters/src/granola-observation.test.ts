import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { granolaMeetings, observeGranola } from "./granola-observation.js";

describe("Granola observation", () => {
  it("accepts structured and JSON-text MCP envelopes but rejects prose and errors", () => {
    expect(
      granolaMeetings({ data: { content: [{ type: "text", text: '{"meetings":[{"id":"a"}]}' }] } }),
    ).toEqual([{ id: "a" }]);
    expect(granolaMeetings({ meetings: [] })).toEqual([]);
    expect(() => granolaMeetings({ content: [{ type: "text", text: "No idea" }] })).toThrow();
    expect(() => granolaMeetings({ isError: true, meetings: [] })).toThrow();
  });
  it("only reads listed meetings from the selected account and rechecks each read", async () => {
    const calls: unknown[] = [];
    const connector = {
      async *execute(call: { tool: string; args: unknown }) {
        calls.push(call);
        yield {
          type: "result",
          data: {
            meetings: call.tool.endsWith("LIST_MEETINGS")
              ? [{ id: "a" }]
              : [
                  {
                    id: "a",
                    title: "Review",
                    url: "https://attacker.test",
                    notes: "Prepare draft",
                  },
                  { id: "other", title: "Not listed" },
                ],
          },
        };
      },
    } as unknown as ConnectorProvider;
    const beforeRead = vi.fn(async () => undefined);
    const context = { runId: "run", signal: new AbortController().signal } as AdapterContext;
    const docs = await observeGranola(
      connector,
      { connectionId: "account", since: "2026-09-01", beforeRead },
      context,
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]?.url).toBeUndefined();
    expect(beforeRead).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      expect.objectContaining({
        tool: "GRANOLA_MCP_LIST_MEETINGS",
        args: expect.objectContaining({ _account: "account" }),
      }),
      expect.objectContaining({
        tool: "GRANOLA_MCP_GET_MEETINGS",
        args: { meeting_ids: ["a"], _account: "account" },
      }),
    ]);
  });
  it("reads unseen meetings first, then rotates previously checked meetings", async () => {
    let requested: string[] = [];
    const connector = {
      async *execute(call: { tool: string; args: { meeting_ids?: string[] } }) {
        if (call.tool.endsWith("GET_MEETINGS")) requested = call.args.meeting_ids!;
        yield {
          type: "result",
          data: { meetings: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}` })) },
        };
      },
    } as unknown as ConnectorProvider;
    await observeGranola(
      connector,
      {
        connectionId: "a",
        since: "2026-09-01",
        seenDocumentIds: Array.from({ length: 10 }, (_, i) => `m${i}`),
        beforeRead: async () => undefined,
      },
      { signal: new AbortController().signal } as AdapterContext,
    );
    expect(requested.slice(0, 2)).toEqual(["m10", "m11"]);
    expect(requested).toHaveLength(10);
  });
  it("does not perform a second read after permission changes", async () => {
    const execute = vi.fn(async function* () {
      yield { type: "result", data: { meetings: [{ id: "a" }] } };
    });
    const beforeRead = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("paused"));
    await expect(
      observeGranola(
        { execute } as unknown as ConnectorProvider,
        { connectionId: "a", since: "2026-09-01", beforeRead },
        { signal: new AbortController().signal } as AdapterContext,
      ),
    ).rejects.toThrow("paused");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
