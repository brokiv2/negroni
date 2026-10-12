import { AssistantWorkEventWatches } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { workWatchesEqual, workWatchMatches } from "./assistant-work-events.js";
import { assistantWorkRecovery } from "./assistant-work-recovery.js";

const now = new Date("2026-10-11T12:00:00Z");
const base = {
  status: "failed",
  error: "HTTP 503 model temporarily unavailable",
  recoveryCount: 0,
  runCount: 1,
  maxRuns: 10,
  deadline: new Date(now.getTime() + 3_600_000),
  now,
  uncertainEffects: false,
};

describe("work recovery policy", () => {
  it("backs off temporary failures, within the original allowance", () => {
    expect(assistantWorkRecovery(base)).toMatchObject({ action: "retry", delayMs: 300_000 });
    expect(assistantWorkRecovery({ ...base, recoveryCount: 2 })).toMatchObject({
      action: "retry",
      delayMs: 1_200_000,
    });
    expect(assistantWorkRecovery({ ...base, recoveryCount: 3 }).action).toBe("needs_input");
    expect(assistantWorkRecovery({ ...base, runCount: 10 }).action).toBe("pause");
  });
  it.each(["401 unauthorized", "403 permission denied", "invalid API key", "unknown error"])(
    "does not retry an access or unclassified failure: %s",
    (error) => {
      expect(assistantWorkRecovery({ ...base, error }).action).toBe("needs_input");
    },
  );
  it("does not retry an uncertain external action, even after a network timeout", () => {
    expect(
      assistantWorkRecovery({ ...base, error: "ETIMEDOUT", uncertainEffects: true }),
    ).toMatchObject({ action: "needs_input" });
  });
  it("permits one checkpoint repair without claiming the objective is done", () => {
    expect(assistantWorkRecovery({ ...base, status: "completed", error: null })).toMatchObject({
      action: "retry",
      delayMs: 60_000,
    });
    expect(assistantWorkRecovery({ ...base, status: "completed", recoveryCount: 1 }).action).toBe(
      "needs_input",
    );
  });
  it("does not schedule a retry beyond the deadline", () => {
    expect(
      assistantWorkRecovery({ ...base, deadline: new Date(now.getTime() + 60_000) }).action,
    ).toBe("pause");
  });
  it("does not add another backoff interval when an already scheduled retry becomes due", () => {
    expect(
      assistantWorkRecovery({
        ...base,
        now: new Date(now.getTime() + 300_000),
        deadline: new Date(now.getTime() + 400_000),
        scheduledFor: new Date(now.getTime() + 300_000),
      }).action,
    ).toBe("retry");
  });
});

describe("source event subscriptions", () => {
  const signal = {
    connectionId: "mail-a",
    externalId: "reply",
    threadKey: "thread",
    kind: "email",
    actor: { address: "Person@Example.test" },
    title: "Build ready",
    excerpt: "Please deploy",
  };
  it("matches exact account and thread with conjunctive optional filters", () => {
    expect(
      workWatchMatches(
        {
          connectionId: "mail-a",
          threadKey: "thread",
          actorAddress: "person@example.test",
          textIncludes: "READY",
        },
        signal,
      ),
    ).toBe(true);
    expect(workWatchMatches({ connectionId: "mail-b", threadKey: "thread" }, signal)).toBe(false);
    expect(workWatchMatches({ connectionId: "mail-a", threadKey: "other" }, signal)).toBe(false);
    expect(workWatchMatches({ connectionId: "mail-a", kind: "email_sent" }, signal)).toBe(false);
    expect(
      workWatchMatches({ connectionId: "mail-a", actorAddress: "other@example.test" }, signal),
    ).toBe(false);
  });
  it("requires scope and ignores ordering when preserving subscriptions", () => {
    expect(AssistantWorkEventWatches.safeParse([{ connectionId: "mail-a" }]).success).toBe(false);
    const a = { connectionId: "mail-a", threadKey: "a" };
    const b = { connectionId: "mail-b", externalId: "b" };
    expect(workWatchesEqual([a, b], [b, a])).toBe(true);
    expect(workWatchesEqual([a], [b])).toBe(false);
  });
});
