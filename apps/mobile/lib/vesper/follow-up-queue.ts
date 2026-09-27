/**
 * The visible follow-up queue.
 *
 * Built over Negroni's durable `threads.followUp`, not a client-held outbox: once
 * an entry is submitted the server owns it, so it leaves the queue and appears in
 * the transcript. What stays here is only what has not been submitted yet, which
 * is why the queue can pause and why a failed submit is held rather than dropped.
 *
 * The pause / never-resend-implicitly semantics follow OpenMuse's
 * `ConversationQueue` (MIT, CopilotKit/openmuse); the durable half is ours.
 */

export type VesperQueueEntryStatus = "pending" | "failed";

export type VesperQueueEntry = {
  id: string;
  text: string;
  status: VesperQueueEntryStatus;
  /** Why the last submit failed. Present only on a failed entry. */
  error?: string;
};

export type VesperQueueSnapshot = {
  entries: readonly VesperQueueEntry[];
  /** A flush is in progress. */
  draining: boolean;
  /** Held: nothing submits until the person resumes. */
  paused: boolean;
};

const EMPTY: VesperQueueSnapshot = { entries: [], draining: false, paused: false };

export class VesperFollowUpQueue {
  private state: VesperQueueSnapshot = EMPTY;
  private listeners = new Set<() => void>();

  getSnapshot = (): VesperQueueSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<VesperQueueSnapshot>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  enqueue(entry: { id: string; text: string }): void {
    this.update({
      entries: [...this.state.entries, { id: entry.id, text: entry.text, status: "pending" }],
    });
  }

  remove(id: string): void {
    const entries = this.state.entries.filter((entry) => entry.id !== id);
    if (entries.length === this.state.entries.length) return;
    this.update({ entries });
  }

  pause(): void {
    if (this.state.paused) return;
    this.update({ paused: true });
  }

  resume(): void {
    if (!this.state.paused) return;
    this.update({ paused: false });
  }

  /** Clear the failure so the next flush picks the entry up again. */
  retry(id: string): void {
    this.update({
      entries: this.state.entries.map((entry) =>
        entry.id === id ? { id: entry.id, text: entry.text, status: "pending" } : entry,
      ),
      paused: false,
    });
  }

  clear(): void {
    this.update({ entries: [], paused: false });
  }

  hasPending(): boolean {
    return this.state.entries.some((entry) => entry.status === "pending");
  }

  /**
   * Submit pending entries in order. A failure holds the queue and marks that one
   * entry failed — a follow-up that threw may or may not have committed, so it is
   * never resubmitted without the person asking.
   */
  async flush(submit: (entry: VesperQueueEntry) => Promise<void>): Promise<void> {
    if (this.state.draining || this.state.paused) return;
    this.update({ draining: true });
    try {
      for (;;) {
        if (this.state.paused) return;
        const next = this.state.entries.find((entry) => entry.status === "pending");
        if (!next) return;
        try {
          await submit(next);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.update({
            paused: true,
            entries: this.state.entries.map((entry) =>
              entry.id === next.id ? { ...entry, status: "failed", error: message } : entry,
            ),
          });
          throw error;
        }
        // Removed only after the server accepted it: from here it is durable.
        this.remove(next.id);
      }
    } finally {
      this.update({ draining: false });
    }
  }
}
