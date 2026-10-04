import { describe, expect, it } from "vitest";
import { feedbackChange } from "./feedback.js";
import { radarUpdateView } from "./updates.js";

const now = new Date("2026-10-04T09:00:00Z");
function row(patch: Partial<Parameters<typeof radarUpdateView>[0]> = {}) {
  return {
    id: "signal-1",
    spaceId: "space",
    userId: "user",
    connectionId: "connection",
    source: "gmail",
    externalId: "m1",
    threadKey: "t1",
    kind: "email",
    occurredAt: new Date("2026-10-04T08:00:00Z"),
    actor: { name: "A colleague", address: "colleague@example.test" },
    direct: true,
    title: "Re: budget",
    excerpt: "x".repeat(900),
    url: "https://mail.example.test/t1",
    meta: {},
    contentHash: "h1",
    status: "decided",
    attempts: 0,
    importance: 81,
    urgency: "today",
    action: "reply",
    headline: "Budget figures due today",
    why: "They need the figures before the 15:00 review.",
    nextStep: null,
    offer: "Draft a reply?",
    evidence: "Could you send the budget figures before the 15:00 review?",
    storyKey: "budget",
    confidence: 0.9,
    disposition: "interrupt",
    reason: null,
    trace: { level: "important", importance: 81, thresholds: { interrupt: 72, brief: 40 } },
    deliverAt: null,
    deliveredAt: new Date("2026-10-04T08:05:00Z"),
    deliveryKey: "k1",
    messageId: "message-1",
    state: "open",
    snoozedUntil: null,
    feedback: null,
    feedbackAt: null,
    createdAt: now,
    updatedAt: now,
    message: { threadId: "thread-1" },
    ...patch,
  };
}

describe("radar update view", () => {
  it("shows the triage title, a short excerpt and where it was delivered", () => {
    const view = radarUpdateView(row());
    expect(view).toMatchObject({
      id: "signal-1",
      title: "Budget figures due today",
      actor: { name: "A colleague", address: "colleague@example.test" },
      url: "https://mail.example.test/t1",
      importance: 81,
      urgency: "today",
      action: "reply",
      disposition: "interrupt",
      state: "open",
      messageId: "message-1",
      threadId: "thread-1",
      offer: "Draft a reply?",
      evidence: "Could you send the budget figures before the 15:00 review?",
      trace: { level: "important", thresholds: { interrupt: 72, brief: 40 } },
    });
    expect(view.excerpt).toHaveLength(500);
    expect(view.nextStep).toBeUndefined();
  });

  it("reads undecided updates as pending and drops values outside the contract", () => {
    const view = radarUpdateView(
      row({
        status: "pending",
        headline: null,
        disposition: null,
        urgency: "someday",
        url: "javascript:alert(1)",
        trace: { gates: "not a list" },
        actor: { name: 42 },
      }),
    );
    expect(view).toMatchObject({ state: "pending", title: "Re: budget" });
    expect(view.urgency).toBeUndefined();
    expect(view.url).toBeUndefined();
    expect(view.trace).toBeUndefined();
    expect(view.actor).toBeUndefined();
    expect(radarUpdateView(row({ status: "pending", state: "done" })).state).toBe("done");
  });
});

describe("radar feedback transitions", () => {
  const open = { state: "open", feedback: null };
  const until = new Date("2026-10-04T12:00:00Z");

  it("closes, snoozes and reopens as the owner says, keeping done updates done", () => {
    expect(feedbackChange(open, "done", now)).toMatchObject({ state: "done", feedback: "done" });
    expect(feedbackChange(open, "snooze", now, until)).toMatchObject({
      state: "snoozed",
      snoozedUntil: until,
    });
    expect(feedbackChange(open, "not_important", now)).toMatchObject({ state: "dismissed" });
    expect(feedbackChange(open, "mute_sender", now)).toMatchObject({ state: "dismissed" });
    expect(
      feedbackChange({ state: "dismissed", feedback: "not_important" }, "important", now),
    ).toMatchObject({ state: "open", feedback: "important", snoozedUntil: null });
    expect(feedbackChange({ state: "done", feedback: "done" }, "important", now)).toMatchObject({
      state: "done",
    });
  });

  it("records an open only when nothing explicit was said", () => {
    expect(feedbackChange(open, "opened", now)).toEqual({ feedback: "opened", feedbackAt: now });
    expect(feedbackChange({ state: "done", feedback: "done" }, "opened", now)).toEqual({});
  });
});
