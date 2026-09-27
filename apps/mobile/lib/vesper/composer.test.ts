import { describe, expect, it } from "vitest";
import {
  composerAction,
  composerActionEnabled,
  composerHasContent,
  composerPlaceholder,
  composerQueueEnabled,
  composerReducer,
  composerSecondaryAction,
  initialComposerState,
  shouldQueueSubmit,
  type VesperComposerEvent,
  type VesperComposerState,
} from "./composer";

function reduce(state: VesperComposerState, ...events: VesperComposerEvent[]): VesperComposerState {
  return events.reduce(composerReducer, state);
}

const ready = reduce(initialComposerState, { kind: "ready", ready: true });

describe("composer action", () => {
  it("shows nothing to press on an empty composer", () => {
    expect(composerAction(ready)).toBe("none");
    expect(composerActionEnabled(ready)).toBe(false);
  });

  it("shows send once there is something to send", () => {
    const typed = reduce(ready, { kind: "draft", text: "hello" });
    expect(composerAction(typed)).toBe("send");
    expect(composerActionEnabled(typed)).toBe(true);
  });

  it("counts an attachment as content on its own", () => {
    const attached = reduce(ready, { kind: "attach", artifactIds: ["art_1"] });
    expect(composerHasContent(attached)).toBe(true);
    expect(composerAction(attached)).toBe("send");
  });

  it("treats whitespace as empty", () => {
    const typed = reduce(ready, { kind: "draft", text: "   " });
    expect(composerAction(typed)).toBe("none");
  });

  it("becomes stop during a run, in the same slot, whatever the draft says", () => {
    const running = reduce(ready, { kind: "run-started" });
    expect(composerAction(running)).toBe("stop");
    expect(composerActionEnabled(running)).toBe(true);
    const runningWithDraft = reduce(running, { kind: "draft", text: "one more thing" });
    expect(composerAction(runningWithDraft)).toBe("stop");
  });

  it("returns to send when the run ends", () => {
    const after = reduce(
      ready,
      { kind: "draft", text: "hi" },
      { kind: "run-started" },
      {
        kind: "run-ended",
      },
    );
    expect(composerAction(after)).toBe("send");
  });

  it("disables the button while the stop is in flight", () => {
    const stopping = reduce(ready, { kind: "run-started" }, { kind: "stop-requested" });
    expect(composerAction(stopping)).toBe("stop");
    expect(composerActionEnabled(stopping)).toBe(false);
  });

  it("stays disabled until the thread is ready", () => {
    const typed = reduce(initialComposerState, { kind: "draft", text: "hello" });
    expect(composerActionEnabled(typed)).toBe(false);
  });
});

describe("stop and the draft", () => {
  it("leaves the draft and attachments untouched", () => {
    const state = reduce(
      ready,
      { kind: "draft", text: "keep me" },
      { kind: "attach", artifactIds: ["art_1"] },
      { kind: "run-started" },
      { kind: "stop-requested" },
      { kind: "run-ended" },
    );
    expect(state.draft).toBe("keep me");
    expect(state.attachmentIds).toEqual(["art_1"]);
  });
});

describe("submitting", () => {
  it("clears the composer optimistically and holds what was sent", () => {
    const state = reduce(
      ready,
      { kind: "draft", text: "hello" },
      { kind: "attach", artifactIds: ["art_1"] },
      { kind: "submit-started" },
    );
    expect(state.draft).toBe("");
    expect(state.attachmentIds).toEqual([]);
    expect(state.sending).toBe(true);
    expect(state.inFlight).toEqual({ draft: "hello", attachmentIds: ["art_1"] });
  });

  it("hands the text back when the send fails", () => {
    const state = reduce(
      ready,
      { kind: "draft", text: "hello" },
      { kind: "submit-started" },
      { kind: "submit-failed" },
    );
    expect(state.draft).toBe("hello");
    expect(state.sending).toBe(false);
    expect(state.inFlight).toBeNull();
  });

  it("does not clobber something typed while the send was in flight", () => {
    const state = reduce(
      ready,
      { kind: "draft", text: "hello" },
      { kind: "submit-started" },
      { kind: "draft", text: "a new thought" },
      { kind: "submit-failed" },
    );
    expect(state.draft).toBe("a new thought");
  });

  it("drops the held copy once the send lands", () => {
    const state = reduce(
      ready,
      { kind: "draft", text: "hello" },
      { kind: "submit-started" },
      { kind: "submit-succeeded" },
    );
    expect(state.inFlight).toBeNull();
    expect(state.sending).toBe(false);
  });

  it("does not duplicate an attachment added twice", () => {
    const state = reduce(
      ready,
      { kind: "attach", artifactIds: ["art_1"] },
      { kind: "attach", artifactIds: ["art_1", "art_2"] },
    );
    expect(state.attachmentIds).toEqual(["art_1", "art_2"]);
  });

  it("detaches by id", () => {
    const state = reduce(
      ready,
      { kind: "attach", artifactIds: ["art_1", "art_2"] },
      { kind: "detach", artifactId: "art_1" },
    );
    expect(state.attachmentIds).toEqual(["art_2"]);
  });
});

describe("routing a submit", () => {
  it("sends a new turn while idle", () => {
    expect(shouldQueueSubmit(reduce(ready, { kind: "draft", text: "hi" }))).toBe(false);
  });

  it("queues a follow-up while a run owns the turn", () => {
    expect(shouldQueueSubmit(reduce(ready, { kind: "run-started" }))).toBe(true);
    expect(
      shouldQueueSubmit(reduce(ready, { kind: "run-started" }, { kind: "stop-requested" })),
    ).toBe(true);
  });
});

describe("placeholder", () => {
  it("says what is happening rather than always inviting a message", () => {
    expect(composerPlaceholder({ ready: false, loading: true, error: false })).toBe("Connecting…");
    expect(composerPlaceholder({ ready: true, loading: true, error: false })).toBe(
      "Loading conversation…",
    );
    expect(composerPlaceholder({ ready: true, loading: false, error: true })).toBe(
      "Conversation unavailable",
    );
    expect(composerPlaceholder({ ready: true, loading: false, error: false })).toBe("Message…");
  });
});

describe("composerSecondaryAction", () => {
  const live: VesperComposerState = { ...initialComposerState, ready: true, phase: "running" };

  it("is nothing while idle, whatever is typed", () => {
    expect(composerSecondaryAction({ ...initialComposerState, draft: "hello" })).toBe("none");
  });

  it("is nothing during a run with an empty draft: the stop square stands alone", () => {
    expect(composerSecondaryAction(live)).toBe("none");
    expect(composerSecondaryAction({ ...live, draft: "   " })).toBe("none");
  });

  it("offers the queue arrow during a run once something is typed", () => {
    expect(composerSecondaryAction({ ...live, draft: "and also check Tuesday" })).toBe("queue");
  });

  it("does not offer to queue an attachment: followUp carries text only", () => {
    expect(composerSecondaryAction({ ...live, attachmentIds: ["art_1"] })).toBe("none");
    expect(composerSecondaryAction({ ...live, attachmentIds: ["art_1"], draft: "note" })).toBe(
      "queue",
    );
  });

  it("stays offered while a stop is in flight, so the draft is not stranded", () => {
    expect(composerSecondaryAction({ ...live, phase: "stopping", draft: "one more" })).toBe(
      "queue",
    );
  });
});

describe("composerQueueEnabled", () => {
  const live: VesperComposerState = {
    ...initialComposerState,
    ready: true,
    phase: "running",
    draft: "later",
  };

  it("needs the transport up and no send already in flight", () => {
    expect(composerQueueEnabled(live)).toBe(true);
    expect(composerQueueEnabled({ ...live, ready: false })).toBe(false);
    expect(composerQueueEnabled({ ...live, sending: true })).toBe(false);
    expect(composerQueueEnabled({ ...live, phase: "idle" })).toBe(false);
  });
});
