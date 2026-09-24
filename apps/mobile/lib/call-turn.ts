/** End a spoken turn after sustained speech followed by a pause. */
export class CallTurnDetector {
  private speechMs = 0;
  private lastSpeechAt = 0;
  private lastSampleAt = 0;

  sample(elapsedMs: number, decibels: number | undefined): "listen" | "send" | "restart" {
    const delta = Math.max(0, Math.min(250, elapsedMs - this.lastSampleAt));
    this.lastSampleAt = elapsedMs;
    if (decibels !== undefined && Number.isFinite(decibels) && decibels > -38) {
      this.speechMs += delta;
      this.lastSpeechAt = elapsedMs;
    }
    const spoken = this.speechMs >= 300;
    if (spoken && elapsedMs - this.lastSpeechAt >= 1100) return "send";
    if (elapsedMs >= 30_000) return spoken ? "send" : "restart";
    return "listen";
  }
}

export function callDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Call ended"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Call ended"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function checkCallActive(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Call ended");
}
