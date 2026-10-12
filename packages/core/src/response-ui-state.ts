import type { UiScalar } from "@rakazo/contracts";
import { ResponseUiBlock, validateUiState } from "@rakazo/contracts";

type State = Record<string, UiScalar>;
type Attempt = { revision: number; state: State };
export type ResponseUiStateSnapshot = {
  state: State;
  saving: boolean;
  error: "save" | "conflict" | null;
  dirty: boolean;
};
export class ResponseUiSaveConflict extends Error {}
const sameState = (a: State, b: State) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** Serializes full-state writes, including retries whose first acknowledgement was lost. */
export function createResponseUiStateSession(
  initial: ResponseUiBlock,
  save: (attempt: Attempt) => Promise<ResponseUiBlock>,
) {
  let accepted = initial;
  let desired = initial.state ?? initial.spec.state;
  let remote = initial;
  let error: ResponseUiStateSnapshot["error"] = null;
  let failed: Attempt | null = null;
  let flight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  let snapshot: ResponseUiStateSnapshot = { state: desired, saving: false, error, dirty: false };
  const dirty = () => !sameState(desired, accepted.state ?? accepted.spec.state);
  function publish() {
    snapshot = { state: desired, saving: Boolean(flight), error, dirty: dirty() };
    for (const listener of listeners) listener();
  }
  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function receive(block: ResponseUiBlock) {
    if (block.id === accepted.id && !accepted.complete) {
      accepted = block;
      remote = block;
      desired = block.state ?? block.spec.state;
      publish();
      return;
    }
    if (
      block.id !== accepted.id ||
      block.revision <= accepted.revision ||
      block.revision < remote.revision
    )
      return;
    remote = block;
    if (flight) return; // Our own event may arrive before the request acknowledgement.
    clearTimer();
    if (
      failed &&
      block.revision === failed.revision + 1 &&
      sameState(block.state ?? block.spec.state, failed.state)
    ) {
      accepted = block;
      failed = null;
      error = null;
      publish();
      if (dirty())
        timer = setTimeout(() => {
          void flush();
        }, 250);
      return;
    }
    if (dirty()) error = "conflict";
    else {
      accepted = block;
      desired = block.state ?? block.spec.state;
    }
    publish();
  }
  async function flush(): Promise<void> {
    clearTimer();
    if (flight) return flight;
    if (error || !accepted.complete || (!failed && !dirty())) return;
    const attempt = failed ?? { revision: accepted.revision, state: { ...desired } };
    // Defer the call by one microtask so synchronous adapters cannot race flight assignment.
    flight = Promise.resolve().then(async () => {
      try {
        const result = ResponseUiBlock.parse(await save(attempt));
        if (result.id !== accepted.id || result.revision !== attempt.revision + 1)
          throw new Error("Invalid response state acknowledgement");
        accepted = result;
        failed = null;
        if (remote.revision > result.revision) {
          if (dirty()) error = "conflict";
          else {
            accepted = remote;
            desired = remote.state ?? remote.spec.state;
          }
        }
      } catch (cause) {
        failed = attempt;
        error = cause instanceof ResponseUiSaveConflict ? "conflict" : "save";
      } finally {
        flight = null;
        publish();
      }
      if (!error && dirty()) await flush();
    });
    publish();
    return flight;
  }
  function change(state: State) {
    if (!accepted.complete || !validateUiState(accepted.spec, state)) return false;
    desired = { ...state };
    publish();
    clearTimer();
    if (!error)
      timer = setTimeout(() => {
        void flush();
      }, 250);
    return true;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receive,
    change,
    flush,
    async retry() {
      if (error !== "save") return;
      error = null;
      publish();
      await flush();
    },
    /** Explicitly discard the local draft after the user has refreshed the message. */
    reload(block: ResponseUiBlock) {
      if (flight || block.id !== accepted.id) return;
      clearTimer();
      accepted = block;
      remote = block;
      desired = block.state ?? block.spec.state;
      failed = null;
      error = null;
      publish();
    },
    close() {
      clearTimer();
      void flush();
    },
  };
}
