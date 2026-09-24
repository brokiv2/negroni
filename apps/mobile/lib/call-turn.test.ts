import { describe, expect, it, vi } from "vitest";
import { CallTurnDetector, callDelay } from "./call-turn";

describe("hands-free turn detection", () => {
  it("does not send silence, missing metering, or a short noise", () => {
    const detector = new CallTurnDetector();
    expect(detector.sample(100, -10)).toBe("listen");
    expect(detector.sample(1300, -70)).toBe("listen");
    expect(detector.sample(1500, undefined)).toBe("listen");
    expect(detector.sample(30_000, Number.NaN)).toBe("restart");
  });
  it("keeps short pauses and sends after a spoken phrase and silence", () => {
    const detector = new CallTurnDetector();
    for (let time = 100; time <= 700; time += 100)
      expect(detector.sample(time, -20)).toBe("listen");
    expect(detector.sample(1500, -70)).toBe("listen");
    expect(detector.sample(1600, -20)).toBe("listen");
    expect(detector.sample(2700, -70)).toBe("send");
  });
  it("bounds continuous speech recordings", () => {
    const detector = new CallTurnDetector();
    for (let time = 100; time < 30_000; time += 100) detector.sample(time, -20);
    expect(detector.sample(30_000, -20)).toBe("send");
  });
  it("cancels a pending wait immediately", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const result = callDelay(30_000, controller.signal);
      const rejection = expect(result).rejects.toThrow("Call ended");
      controller.abort();
      await rejection;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
