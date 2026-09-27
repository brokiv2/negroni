import type { MessageBlock, RunActivityRow } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  type ActivityMessage,
  activityFilterLabel,
  approvalNotes,
  approvalRows,
  effectKindLabel,
  effectStatusLabel,
  filterActivityRuns,
  isRunRunning,
  mergeActivityRuns,
  pendingApprovals,
  pendingAsks,
  planForRun,
  planFraction,
  receiptsForRun,
  reviewDecisionLabel,
  runNeedsYou,
  runResult,
  runsAwaitingPerson,
  runTimeline,
  VESPER_ACTIVITY_FILTERS,
} from "./activity";

function run(patch: Partial<RunActivityRow> & { runId: string }): RunActivityRow {
  return {
    botId: "bot_1",
    botName: "Vesper",
    groupId: null,
    groupName: null,
    threadId: "thread_1",
    status: "running",
    trigger: "user",
    notificationsEnabled: true,
    promptSnippet: "Book the flight",
    updatedAt: "2026-09-27T10:00:00.000Z",
    ...patch,
  };
}

function message(patch: Partial<ActivityMessage> & { id: string }): ActivityMessage {
  return { role: "bot", blocks: [], ...patch };
}

describe("run status predicates", () => {
  it("counts every non-terminal status as running", () => {
    for (const status of [
      "queued",
      "leased",
      "running",
      "waiting_input",
      "waiting_takeover",
    ] as const) {
      expect(isRunRunning(status)).toBe(true);
    }
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(isRunRunning(status)).toBe(false);
    }
  });

  it("separates waiting on a person from waiting on a machine", () => {
    expect(runNeedsYou("waiting_input")).toBe(true);
    expect(runNeedsYou("waiting_takeover")).toBe(true);
    expect(runNeedsYou("running")).toBe(false);
    expect(runNeedsYou("queued")).toBe(false);
  });
});

describe("mergeActivityRuns", () => {
  it("prefers the active row when both lists carry the same run", () => {
    const merged = mergeActivityRuns(
      [run({ runId: "r1", status: "running", updatedAt: "2026-09-27T10:05:00.000Z" })],
      [run({ runId: "r1", status: "completed", updatedAt: "2026-09-27T10:00:00.000Z" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("running");
  });

  it("floats runs waiting on the person to the top, then sorts by recency", () => {
    const merged = mergeActivityRuns(
      [
        run({ runId: "fresh", updatedAt: "2026-09-27T12:00:00.000Z" }),
        run({ runId: "waiting", status: "waiting_input", updatedAt: "2026-09-27T09:00:00.000Z" }),
      ],
      [run({ runId: "old", status: "completed", updatedAt: "2026-09-27T08:00:00.000Z" })],
    );
    expect(merged.map((entry) => entry.runId)).toEqual(["waiting", "fresh", "old"]);
  });
});

describe("filterActivityRuns", () => {
  const runs = [
    run({ runId: "a", status: "running" }),
    run({ runId: "b", status: "completed" }),
    run({ runId: "c", status: "waiting_input" }),
  ];

  it("labels and covers all three chips", () => {
    expect([...VESPER_ACTIVITY_FILTERS]).toEqual(["all", "running", "finished"]);
    for (const filter of VESPER_ACTIVITY_FILTERS) expect(activityFilterLabel(filter)).not.toBe("");
  });

  it("splits on running rather than on the raw status", () => {
    expect(filterActivityRuns(runs, "all").map((entry) => entry.runId)).toEqual(["a", "b", "c"]);
    expect(filterActivityRuns(runs, "running").map((entry) => entry.runId)).toEqual(["a", "c"]);
    expect(filterActivityRuns(runs, "finished").map((entry) => entry.runId)).toEqual(["b"]);
  });

  it("counts only what is waiting on the person for the bell", () => {
    expect(runsAwaitingPerson(runs).map((entry) => entry.runId)).toEqual(["c"]);
  });
});

describe("planForRun", () => {
  const plan: MessageBlock = {
    kind: "plan",
    summary: "Booking the flight",
    title: "Book the flight",
    status: "running",
    note: "Comparing fares",
    steps: [
      { title: "Search fares", status: "done" },
      { title: "Compare options", status: "running" },
      { title: "Book", status: "pending" },
    ],
  };

  it("reads per-step status off the plan block", () => {
    const result = planForRun([message({ id: "m1", runId: "r1", blocks: [plan] })], "r1");
    expect(result?.title).toBe("Book the flight");
    expect(result?.done).toBe(1);
    expect(result?.total).toBe(3);
    expect(result?.note).toBe("Comparing fares");
    expect(result?.steps[1]).toEqual({
      label: "Compare options",
      done: false,
      active: true,
      failed: false,
    });
  });

  it("takes the last plan block, because a plan is updated in place", () => {
    const later: MessageBlock = {
      ...plan,
      steps: [
        { title: "Search fares", status: "done" },
        { title: "Compare options", status: "done" },
        { title: "Book", status: "done" },
      ],
    };
    const result = planForRun(
      [
        message({ id: "m1", runId: "r1", blocks: [plan] }),
        message({ id: "m2", runId: "r1", blocks: [later] }),
      ],
      "r1",
    );
    expect(result?.done).toBe(3);
  });

  it("ignores another run's plan", () => {
    expect(planForRun([message({ id: "m1", runId: "other", blocks: [plan] })], "r1")).toBeNull();
  });

  it("falls back to a steps block when there is no plan", () => {
    const steps: MessageBlock = {
      kind: "steps",
      steps: [
        { label: "Searched the web", count: 3 },
        { label: "Read a page", count: 1 },
      ],
    };
    const result = planForRun([message({ id: "m1", runId: "r1", blocks: [steps] })], "r1");
    expect(result?.steps.map((step) => step.label)).toEqual(["Searched the web ×3", "Read a page"]);
    expect(result?.done).toBe(2);
  });

  it("counts skipped as done and failed as neither", () => {
    const mixed: MessageBlock = {
      ...plan,
      steps: [
        { title: "One", status: "skipped" },
        { title: "Two", status: "failed" },
      ],
    };
    const result = planForRun([message({ id: "m1", runId: "r1", blocks: [mixed] })], "r1");
    expect(result?.done).toBe(1);
    expect(result?.steps[1]?.failed).toBe(true);
  });
});

describe("planFraction", () => {
  it("is null when there is nothing to measure", () => {
    expect(planFraction(null)).toBeNull();
    expect(planFraction({ title: "x", steps: [], done: 0, total: 0 })).toBeNull();
  });

  it("is the completed share otherwise", () => {
    expect(planFraction({ title: "x", steps: [], done: 1, total: 4 })).toBe(0.25);
  });
});

describe("asks and approvals", () => {
  const question: MessageBlock = { kind: "ask", text: "Which seat?", status: "pending" };
  const approval: MessageBlock = {
    kind: "ask",
    text: "Review before gmail_send_email → ada@example.com",
    approvalEffectId: "eff_1",
    detail: "Recipient is not in this thread\nto: ada@example.com\nsubject: Itinerary",
    status: "pending",
    actions: [
      { id: "allow", label: "Allow once" },
      { id: "deny", label: "Deny" },
    ],
  };
  const answered: MessageBlock = { ...question, status: "answered", answer: "12A" };
  const messages = [
    message({ id: "m1", runId: "r1", blocks: [question] }),
    message({ id: "m2", runId: "r1", blocks: [approval] }),
    message({ id: "m3", runId: "r1", blocks: [answered] }),
    message({ id: "m4", blocks: [question] }),
  ];

  it("skips answered asks and asks with no run", () => {
    expect(pendingAsks(messages).map((ask) => ask.messageId)).toEqual(["m1", "m2"]);
  });

  it("keeps only the ones gating a real-world action", () => {
    expect(pendingApprovals(messages).map((ask) => ask.messageId)).toEqual(["m2"]);
  });

  it("re-exports the approval readers, so one import covers an Activity card", () => {
    expect(approvalRows(approval.kind === "ask" ? approval.detail : undefined)).toEqual([
      { k: "to", v: "ada@example.com" },
      { k: "subject", v: "Itinerary" },
    ]);
    expect(approvalNotes(approval.kind === "ask" ? approval.detail : undefined)).toEqual([
      "Recipient is not in this thread",
    ]);
  });
});

describe("runTimeline and runResult", () => {
  const messages = [
    message({
      id: "m1",
      runId: "r1",
      createdAt: "2026-09-27T10:00:00.000Z",
      blocks: [
        { kind: "progress", text: "Searching flights" },
        { kind: "meta", text: "" },
      ],
    }),
    message({
      id: "m2",
      runId: "r1",
      blocks: [
        { kind: "browser", summary: "Opened kayak.com", url: "https://kayak.com", status: "ready" },
      ],
    }),
    message({ id: "m3", runId: "r1", blocks: [{ kind: "text", text: "Booked seat 12A." }] }),
    message({ id: "m4", runId: "other", blocks: [{ kind: "progress", text: "Something else" }] }),
  ];

  it("records narration and tool summaries in order, skipping empty lines", () => {
    expect(runTimeline(messages, "r1").map((entry) => entry.text)).toEqual([
      "Searching flights",
      "Opened kayak.com",
    ]);
  });

  it("carries the message timestamp when there is one", () => {
    expect(runTimeline(messages, "r1")[0]?.createdAt).toBe("2026-09-27T10:00:00.000Z");
  });

  it("takes the last prose reply as the result", () => {
    expect(runResult(messages, "r1")).toBe("Booked seat 12A.");
    expect(runResult(messages, "other")).toBeNull();
  });
});

describe("receipts", () => {
  it("scopes to one run", () => {
    const receipts = [
      { id: "e1", runId: "r1" },
      { id: "e2", runId: "r2" },
    ];
    expect(receiptsForRun(receipts, "r1").map((receipt) => receipt.id)).toEqual(["e1"]);
  });

  it("names statuses and verdicts people can read", () => {
    expect(effectStatusLabel("succeeded")).toBe("Done");
    expect(effectStatusLabel("something_new")).toBe("something_new");
    expect(reviewDecisionLabel(null)).toBeNull();
    expect(reviewDecisionLabel("pass")).toBe("Checked and allowed");
    expect(reviewDecisionLabel("novel")).toBe("novel");
  });

  it("makes a tool name readable", () => {
    expect(effectKindLabel("gmail_send_email")).toBe("Gmail send email");
    expect(effectKindLabel("destination.write")).toBe("Destination write");
    expect(effectKindLabel("")).toBe("");
  });
});
