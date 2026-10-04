import { describe, expect, it } from "vitest";
import { projectToolTimeline } from "./tool-timeline.js";

const base = { id: "event", runId: "run", createdAt: "2026-09-29T10:00:00Z" };
describe("tool activity timeline", () => {
  it("shows a paused question as waiting even before the tool completion arrives", () => {
    const events = [
      {
        ...base,
        type: "agent.tool.called",
        payload: { name: "ask_user", executionId: "question" },
      },
    ];
    expect(projectToolTimeline(events, new Map([["run", "waiting_input"]]))[0]?.status).toBe(
      "waiting",
    );
    expect(projectToolTimeline(events, new Map([["run", "waiting_takeover"]]))[0]?.status).toBe(
      "waiting",
    );
    expect(projectToolTimeline(events, new Map([["run", "running"]]))[0]?.status).toBe("running");
  });
  it("pairs calls and completions, distinguishes repeated tools, and excludes payload contents", () => {
    const events = [
      {
        ...base,
        type: "agent.tool.called",
        payload: { name: "GMAIL_LIST_MESSAGES", executionId: "one", args: { secret: "private" } },
      },
      {
        ...base,
        type: "agent.tool.called",
        payload: { name: "GMAIL_LIST_MESSAGES", executionId: "two" },
      },
      {
        ...base,
        type: "agent.tool.completed",
        payload: {
          name: "GMAIL_LIST_MESSAGES",
          executionId: "one",
          outcome: "succeeded",
          durationMs: 1200,
          result: "private",
        },
      },
    ];
    const rows = projectToolTimeline(events, new Map([["run", "running"]]));
    expect(rows.map((r) => r.status)).toEqual(["succeeded", "running"]);
    expect(rows[0]?.durationMs).toBe(1200);
    expect(JSON.stringify(rows)).not.toContain("private");
    expect(projectToolTimeline(events, new Map([["run", "cancelled"]]))[1]?.status).toBe(
      "interrupted",
    );
  });
  it("shows approval pauses as waiting instead of errors", () => {
    const rows = projectToolTimeline(
      [
        {
          ...base,
          type: "agent.tool.completed",
          payload: { name: "shell", executionId: "one", outcome: "paused", durationMs: 100 },
        },
      ],
      new Map([["run", "waiting_input"]]),
    );
    expect(rows[0]?.status).toBe("waiting");
  });
  it("keeps errors distinct from success even after the run completes", () => {
    expect(
      projectToolTimeline(
        [
          {
            ...base,
            type: "agent.tool.completed",
            payload: { name: "screen_view", executionId: "one", outcome: "error", durationMs: 200 },
          },
        ],
        new Map([["run", "completed"]]),
      )[0]?.status,
    ).toBe("error");
  });
});
