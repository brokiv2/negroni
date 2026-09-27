import { t } from "../i18n";

/**
 * Composer and run state for the Vesper chat.
 *
 * The right-hand button never moves: it is a send arrow while idle and a stop
 * square during a run, in the same 44×44 slot. Stopping is a run action, not a
 * composer action, so it never touches the draft — that is the rule this reducer
 * exists to make testable.
 */

export type VesperRunPhase = "idle" | "running" | "stopping";

export type VesperComposerState = {
  draft: string;
  attachmentIds: readonly string[];
  phase: VesperRunPhase;
  /** A send / follow-up call is in flight. */
  sending: boolean;
  /** The thread is loaded and the transport is up. */
  ready: boolean;
  /** Held so a failed submit can hand the text back rather than losing it. */
  inFlight: { draft: string; attachmentIds: readonly string[] } | null;
};

export const initialComposerState: VesperComposerState = {
  draft: "",
  attachmentIds: [],
  phase: "idle",
  sending: false,
  ready: false,
  inFlight: null,
};

export type VesperComposerEvent =
  | { kind: "ready"; ready: boolean }
  | { kind: "draft"; text: string }
  | { kind: "attach"; artifactIds: readonly string[] }
  | { kind: "detach"; artifactId: string }
  | { kind: "submit-started" }
  | { kind: "submit-succeeded" }
  | { kind: "submit-failed" }
  | { kind: "stop-requested" }
  | { kind: "run-started" }
  | { kind: "run-ended" };

export function composerReducer(
  state: VesperComposerState,
  event: VesperComposerEvent,
): VesperComposerState {
  switch (event.kind) {
    case "ready":
      return { ...state, ready: event.ready };
    case "draft":
      return { ...state, draft: event.text };
    case "attach": {
      const merged = [...state.attachmentIds];
      for (const id of event.artifactIds) if (!merged.includes(id)) merged.push(id);
      return { ...state, attachmentIds: merged };
    }
    case "detach":
      return {
        ...state,
        attachmentIds: state.attachmentIds.filter((id) => id !== event.artifactId),
      };
    case "submit-started":
      return {
        ...state,
        sending: true,
        draft: "",
        attachmentIds: [],
        inFlight: { draft: state.draft, attachmentIds: state.attachmentIds },
      };
    case "submit-succeeded":
      return { ...state, sending: false, inFlight: null };
    case "submit-failed":
      // Hand the text back only if nothing was typed in the meantime.
      return {
        ...state,
        sending: false,
        draft: state.draft || (state.inFlight?.draft ?? ""),
        attachmentIds: state.attachmentIds.length
          ? state.attachmentIds
          : (state.inFlight?.attachmentIds ?? []),
        inFlight: null,
      };
    case "stop-requested":
      // Deliberately leaves draft and attachments alone.
      return state.phase === "running" ? { ...state, phase: "stopping" } : state;
    case "run-started":
      return { ...state, phase: "running" };
    case "run-ended":
      return { ...state, phase: "idle" };
  }
}

export type VesperComposerAction = "send" | "stop" | "none";

export function composerHasContent(state: VesperComposerState): boolean {
  return state.draft.trim().length > 0 || state.attachmentIds.length > 0;
}

/** What the right-hand button does right now. */
export function composerAction(state: VesperComposerState): VesperComposerAction {
  if (state.phase !== "idle") return "stop";
  return composerHasContent(state) ? "send" : "none";
}

export function composerActionEnabled(state: VesperComposerState): boolean {
  if (state.phase === "running") return true;
  if (state.phase === "stopping") return false;
  return state.ready && !state.sending && composerHasContent(state);
}

/**
 * A submit while a run is live belongs in the follow-up queue; a submit while
 * idle goes straight out as a new turn.
 */
export function shouldQueueSubmit(state: VesperComposerState): boolean {
  return state.phase !== "idle";
}

/**
 * The second button, to the left of the stop square.
 *
 * While a run is live the primary slot is the stop square, which leaves nowhere
 * to put a typed follow-up. So the send arrow comes back beside it, and means
 * "send this when the run finishes". An empty draft gets the stop square alone,
 * exactly as before — the arrow only appears when there is something to send.
 *
 * Text only, deliberately: `threads.followUp` takes a string and nothing else,
 * so an attachment cannot be queued. It stays on the composer until the run ends
 * and goes out with the next real turn, rather than being silently dropped.
 */
export function composerSecondaryAction(state: VesperComposerState): "queue" | "none" {
  if (state.phase === "idle") return "none";
  return state.draft.trim().length > 0 ? "queue" : "none";
}

export function composerQueueEnabled(state: VesperComposerState): boolean {
  return composerSecondaryAction(state) === "queue" && state.ready && !state.sending;
}

export function composerPlaceholder(state: {
  ready: boolean;
  loading: boolean;
  error: boolean;
}): string {
  if (state.error) return t("Conversation unavailable");
  if (!state.ready) return t("Connecting…");
  if (state.loading) return t("Loading conversation…");
  return t("Message…");
}
