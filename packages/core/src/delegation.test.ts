import { describe, expect, it } from "vitest";
import {
  chargeDelegationRun,
  createDelegationRecord,
  DELEGATED_NO_RESULT_TEXT,
  DELEGATION_MAX_RUNS,
  type DelegationRecord,
  delegationRecord,
  delegationResultChecks,
  delegationReview,
  delegationReviewPointer,
  delegationStopNotice,
  delegationStopReason,
  stateAfterReview,
  transitionDelegation,
} from "./delegation.js";

const now = new Date("2026-10-01T10:00:00.000Z");
const requester = {
  botId: "main",
  threadId: "personal",
  runId: "run-main",
  requestMessageId: "msg-request",
  sourceMessageId: "msg-user",
};

function fresh(sources = ["docs/a.md", "docs/b.md"]): DelegationRecord {
  return createDelegationRecord({
    assignment: "Compare docs/a.md and docs/b.md and recommend one.",
    sources,
    requester,
    assigneeBotId: "analyst",
    now,
  });
}

function reviewing(text: string, intent: "result" | "blocker" = "result", readCount = 2) {
  const record = fresh();
  return {
    ...transitionDelegation(record, "reviewing", now),
    outcome: {
      intent,
      text,
      messageId: "msg-result",
      childRunId: "run-child",
      readCount,
      receivedAt: now.toISOString(),
    },
    checks: delegationResultChecks({ intent, text, sources: record.sources, readCount }),
  } satisfies DelegationRecord;
}

describe("delegated task lifecycle", () => {
  it("opens queued with the dispatching and first child run charged", () => {
    const record = fresh();
    expect(record).toMatchObject({
      kind: "delegation",
      state: "queued",
      sources: ["docs/a.md", "docs/b.md"],
      budget: { maxRuns: DELEGATION_MAX_RUNS, usedRuns: 2 },
      reviewAttempts: 0,
    });
    expect(delegationRecord(record)).toEqual(record);
    expect(delegationReviewPointer(record)).toBeNull();
    expect(delegationReviewPointer({ kind: "review", taskRef: "t", attempt: 0 })).toEqual({
      kind: "review",
      taskRef: "t",
      attempt: 0,
    });
    expect(delegationRecord({ kind: "delegation", state: "bogus" })).toBeNull();
  });

  it("refuses to complete without a stored review", () => {
    const record = reviewing("Option A, per docs/a.md and docs/b.md.");
    expect(() => transitionDelegation(record, "completed", now)).toThrow(/review is stored/);
    const review = delegationReview({
      taskRef: "task-1",
      record,
      summary: "A is better.",
      reviewRunId: "run-review",
      now,
    });
    const done = transitionDelegation({ ...record, review }, "completed", now, "review_verified");
    expect(done.state).toBe("completed");
    expect(done.review?.reviewedAt).toBe(now.toISOString());
  });

  it("never moves a status or a closed task to completed", () => {
    const record = fresh();
    expect(() => transitionDelegation(record, "completed", now)).toThrow();
    const cancelled = transitionDelegation(record, "cancelled", now, "child_cancelled");
    expect(cancelled.stopReason).toBe("child_cancelled");
    expect(() => transitionDelegation(cancelled, "reviewing", now)).toThrow();
    expect(delegationStopReason(cancelled, now)).toBe("closed");
  });

  it("stops dispatch when the allowance or deadline is spent", () => {
    let record = fresh();
    for (let used = record.budget.usedRuns; used < record.budget.maxRuns; used += 1) {
      expect(delegationStopReason(record, now)).toBeNull();
      record = chargeDelegationRun(record, now);
    }
    expect(delegationStopReason(record, now)).toBe("budget_exhausted");
    expect(delegationStopReason(fresh(), new Date(now.getTime() + 25 * 3600_000))).toBe(
      "deadline_passed",
    );
  });

  it("lets a rework continue the parent's allowance and deadline", () => {
    const parent = chargeDelegationRun(fresh(), now);
    const rework = createDelegationRecord({
      assignment: "Also cover pricing.",
      requester,
      assigneeBotId: "analyst",
      now: new Date(now.getTime() + 3600_000),
      parent: { ...parent, taskRef: "task-parent" },
    });
    expect(rework.parentTaskRef).toBe("task-parent");
    expect(rework.budget).toEqual({ maxRuns: parent.budget.maxRuns, usedRuns: 4 });
    expect(rework.deadline).toBe(parent.deadline);
  });
});

describe("deterministic result checks", () => {
  it("passes a substantive result that cites every source and read them", () => {
    const checks = delegationResultChecks({
      intent: "result",
      text: "Recommend A: docs/a.md shows lower cost, b.md shows slower rollout.",
      sources: ["docs/a.md", "docs/b.md"],
      readCount: 2,
    });
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("flags a false done, a missing artifact and an empty placeholder", () => {
    const falseDone = delegationResultChecks({
      intent: "result",
      text: "Done.",
      sources: ["docs/a.md"],
      readCount: 0,
    });
    expect(falseDone.filter((check) => !check.passed).map((check) => check.name)).toEqual([
      "substantive",
      "sources_cited",
      "source_reads",
    ]);
    const missing = delegationResultChecks({
      intent: "result",
      text: "Recommend A based on docs/a.md.",
      sources: ["docs/a.md", "docs/b.md"],
      readCount: 1,
    });
    expect(missing.find((check) => check.name === "sources_cited")).toMatchObject({
      passed: false,
      detail: "Not referenced: docs/b.md.",
    });
    const empty = delegationResultChecks({
      intent: "result",
      text: DELEGATED_NO_RESULT_TEXT,
      sources: [],
      readCount: 0,
    });
    expect(empty.find((check) => check.name === "result_present")?.passed).toBe(false);
  });
});

describe("review outcome", () => {
  it("is verified only when every check passed and the reviewer answered", () => {
    const verified = delegationReview({
      taskRef: "task-1",
      record: reviewing("Recommend A per docs/a.md, docs/b.md."),
      summary: "A wins.",
      reviewRunId: "run-review",
      now,
    });
    expect(verified).toMatchObject({
      taskRef: "task-1",
      outcome: "verified",
      evidenceRefs: ["run:run-child", "message:msg-result", "source:docs/a.md", "source:docs/b.md"],
      reviewRunId: "run-review",
    });
    expect(verified.limitations).toContain(
      "Claims inside the result were assessed by the reviewing model, not proven by code.",
    );
  });

  it("is partial when a check failed and incomplete when the reviewer was empty", () => {
    const record = reviewing("Recommend A per docs/a.md.", "result", 1);
    expect(
      delegationReview({ taskRef: "t", record, summary: "A.", reviewRunId: null, now }).outcome,
    ).toBe("partial");
    const empty = delegationReview({ taskRef: "t", record, summary: "  ", reviewRunId: null, now });
    expect(empty.outcome).toBe("incomplete");
    expect(empty.limitations[0]).toBe("The review produced no answer.");
  });

  it("keeps a blocker open for the user and a failed child closed", () => {
    const blocked = reviewing("docs/b.md is missing.", "blocker");
    expect(
      delegationReview({
        taskRef: "t",
        record: blocked,
        summary: "B is missing.",
        reviewRunId: null,
        now,
      }).outcome,
    ).toBe("blocked");
    expect(stateAfterReview(blocked)).toBe("needs_input");
    expect(stateAfterReview({ ...blocked, outcome: { ...blocked.outcome, failed: true } })).toBe(
      "failed",
    );
    expect(stateAfterReview(reviewing("ok per docs/a.md docs/b.md"))).toBe("completed");
  });

  it("names the stopped task without exposing ids", () => {
    expect(delegationStopNotice(fresh(), "budget_exhausted")).toBe(
      'I stopped "Compare docs/a.md and docs/b.md and recommend one." before reviewing its result: it reached its run limit.',
    );
  });
});
