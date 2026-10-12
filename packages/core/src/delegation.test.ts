import { describe, expect, it } from "vitest";
import {
  advanceDelegationPhase,
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
  validateDelegationPhases,
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
    expect(rework.originalAssignment).toBe(parent.assignment);
    expect(rework.sources).toEqual(parent.sources);
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
    const result = reviewing("Recommend A per docs/a.md docs/b.md.");
    expect(stateAfterReview(result)).toBe("needs_input");
    expect(
      stateAfterReview({
        ...result,
        review: delegationReview({
          taskRef: "t",
          record: result,
          summary: "A meets the requested conditions.",
          reviewRunId: "review",
          now,
        }),
      }),
    ).toBe("completed");
  });

  it("names the stopped task without exposing ids", () => {
    expect(delegationStopNotice(fresh(), "budget_exhausted")).toBe(
      'I stopped "Compare docs/a.md and docs/b.md and recommend one." before reviewing its result: it reached its run limit.',
    );
  });
});

describe("bounded delegated phases", () => {
  const phases = [
    "Read and compare both sources.",
    "Check the tradeoffs.",
    "Write the recommendation.",
  ];
  function phaseRecord() {
    return createDelegationRecord({
      assignment: "Recommend one option with evidence.",
      sources: ["docs/a.md", "docs/b.md"],
      phases,
      requester,
      assigneeBotId: "analyst",
      now,
    });
  }
  function reviewed(
    record: DelegationRecord,
    text = "Recommend A per docs/a.md and docs/b.md.",
    reads = 2,
  ) {
    const result: DelegationRecord = {
      ...transitionDelegation(record, "reviewing", now),
      outcome: {
        intent: "result",
        text,
        messageId: "result",
        childRunId: "child",
        readCount: reads,
        receivedAt: now.toISOString(),
      },
      checks: delegationResultChecks({
        intent: "result",
        text,
        sources: record.sources,
        readCount: reads,
      }),
    };
    return {
      ...result,
      review: delegationReview({
        taskRef: "phase",
        record: result,
        summary: "The result follows from both cited sources.",
        reviewRunId: "review",
        now,
      }),
    };
  }
  it("keeps three verified stages under one assignment and one allowance", () => {
    const first = reviewed(chargeDelegationRun(phaseRecord(), now));
    expect(() => transitionDelegation(first, "completed", now)).toThrow(/intermediate phase/);
    const second = advanceDelegationPhase(first, now);
    expect(second).toMatchObject({
      state: "queued",
      assignment: first.assignment,
      budget: { usedRuns: 4 },
      deadline: first.deadline,
      phases: { index: 1, completed: [{ index: 0, outcome: first.outcome, review: first.review }] },
    });
    expect(second.outcome).toBeUndefined();
    expect(second.review).toBeUndefined();
    const third = advanceDelegationPhase(reviewed(chargeDelegationRun(second, now)), now);
    const final = transitionDelegation(reviewed(chargeDelegationRun(third, now)), "completed", now);
    expect(final.budget).toEqual({ maxRuns: 8, usedRuns: 7 });
    expect(final.phases?.completed).toHaveLength(2);
  });
  it("does not advance or complete missing evidence and bare completion claims", () => {
    const partial = reviewed(phaseRecord(), "I recommend A based on docs/a.md.", 1);
    expect(partial.review.outcome).toBe("partial");
    expect(stateAfterReview(partial)).toBe("needs_input");
    expect(() => advanceDelegationPhase(partial, now)).toThrow(/verified/);
    expect(() => transitionDelegation(partial, "completed", now)).toThrow(/verified review/);
    const result = reviewed(phaseRecord());
    expect(
      delegationReview({
        taskRef: "phase",
        record: result,
        summary: "Done.",
        reviewRunId: "review",
        now,
      }).outcome,
    ).toBe("incomplete");
  });
  it("retains the phase plan on rework and never resets expired or exhausted work", () => {
    const parent = reviewed(chargeDelegationRun(phaseRecord(), now));
    const rework = createDelegationRecord({
      assignment: "Verify the missing detail.",
      sources: [],
      requester,
      assigneeBotId: "analyst",
      parent: { ...parent, taskRef: "parent" },
      now,
    });
    expect(rework.phases).toEqual(parent.phases);
    expect(rework.sources).toEqual(parent.sources);
    expect(rework.originalAssignment).toBe(parent.assignment);
    expect(() =>
      advanceDelegationPhase({ ...parent, budget: { maxRuns: 8, usedRuns: 8 } }, now),
    ).toThrow(/cannot continue/);
    expect(() => advanceDelegationPhase(parent, new Date(now.getTime() + 25 * 3600_000))).toThrow(
      /cannot continue/,
    );
    expect(() =>
      advanceDelegationPhase(transitionDelegation(parent, "cancelled", now), now),
    ).toThrow(/verified intermediate/);
  });
  it("rejects empty, oversized and unbounded plans", () => {
    for (const invalid of [
      [],
      ["one"],
      ["one", "two", "three", "four"],
      ["", "two"],
      ["x".repeat(2001), "two"],
      [42, "two"],
    ])
      expect(() => validateDelegationPhases(invalid)).toThrow();
  });
});
