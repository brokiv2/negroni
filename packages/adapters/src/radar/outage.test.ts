import { describe, expect, it } from "vitest";
import {
  describeModelFailure,
  MODEL_UNAVAILABLE,
  modelHealth,
  OUTAGE_FIRST_WAIT_MS,
  OUTAGE_MAX_WAIT_MS,
  outageWait,
  readOutage,
  withoutOutageWait,
} from "./outage.js";

const MINUTE = 60_000;
const withStatus = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

describe("why a model call got no answer", () => {
  it("names a refused request by its status", () => {
    expect(describeModelFailure(withStatus("Payment Required", 402))).toEqual({
      reason: "credit",
      status: 402,
    });
    expect(describeModelFailure(withStatus("Too Many Requests", 429))).toEqual({
      reason: "rate_limit",
      status: 429,
    });
    expect(describeModelFailure(withStatus("Unauthorized", 401)).reason).toBe("auth");
    expect(describeModelFailure(withStatus("Forbidden", 403)).reason).toBe("auth");
    for (const status of [500, 502, 503, 529])
      expect(describeModelFailure(withStatus("Upstream failed", status))).toEqual({
        reason: "server",
        status,
      });
    expect(describeModelFailure(withStatus("Gateway Time-out", 504)).reason).toBe("timeout");
    expect(describeModelFailure(withStatus("Request Timeout", 408)).reason).toBe("timeout");
  });

  it("finds the status on the response, on a cause, or in the message", () => {
    expect(describeModelFailure({ response: { status: 402 } })).toEqual({
      reason: "credit",
      status: 402,
    });
    expect(describeModelFailure(new Error("failed", { cause: { statusCode: 503 } }))).toEqual({
      reason: "server",
      status: 503,
    });
    expect(describeModelFailure(new Error("402 Payment Required: add credit"))).toEqual({
      reason: "credit",
      status: 402,
    });
    expect(describeModelFailure(new Error("Request failed with status code 429")).reason).toBe(
      "rate_limit",
    );
    expect(describeModelFailure("HTTP 401").reason).toBe("auth");
    // A number inside a longer one is not a status.
    expect(describeModelFailure(new Error("read 4290 bytes")).reason).toBe("unknown");
  });

  it("reads a balance message before the status, and keeps what it was given", () => {
    // Some providers answer 429 when the balance is empty.
    expect(
      describeModelFailure(withStatus("Insufficient balance or no resource package", 429)),
    ).toEqual({ reason: "credit", status: 429 });
    expect(describeModelFailure(new Error("a positive credit balance is required")).reason).toBe(
      "credit",
    );
    expect(describeModelFailure(new Error("You exceeded your current quota")).reason).toBe(
      "credit",
    );
    expect(describeModelFailure(new Error("Rate limit reached for requests")).reason).toBe(
      "rate_limit",
    );
    expect(describeModelFailure(new Error("Incorrect API key provided")).reason).toBe("auth");
    expect(describeModelFailure(new Error("overloaded_error")).reason).toBe("server");
  });

  it("recognizes timeouts and network failures", () => {
    expect(
      describeModelFailure(new DOMException("The operation timed out", "TimeoutError")).reason,
    ).toBe("timeout");
    expect(describeModelFailure(Object.assign(new Error("x"), { code: "ETIMEDOUT" })).reason).toBe(
      "timeout",
    );
    expect(describeModelFailure(new Error("Codex turn/start timed out")).reason).toBe("timeout");
    expect(
      describeModelFailure(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })).reason,
    ).toBe("network");
    expect(describeModelFailure(Object.assign(new Error("x"), { code: "ENOTFOUND" })).reason).toBe(
      "network",
    );
    expect(describeModelFailure(new Error("socket hang up")).reason).toBe("network");
  });

  it("recognizes what the Codex runtime reports in place of the provider's own error", () => {
    for (const message of [
      "Codex turn failed; check the selected model connection",
      "The model connection failed. Check its settings and retry.",
      "Model request failed",
      "Agent engine stopped unexpectedly (SIGKILL) before finishing the reply. Please try again.",
    ])
      expect(describeModelFailure(new Error(message)).reason).toBe("engine");
  });

  it("leaves what it cannot place as unknown", () => {
    expect(describeModelFailure(new Error("boom"))).toEqual({ reason: "unknown" });
    expect(describeModelFailure(undefined)).toEqual({ reason: "unknown" });
    expect(describeModelFailure({ message: 42 })).toEqual({ reason: "unknown" });
    // A cause that points back at its error must not loop.
    const loop: { cause?: unknown; message: string } = { message: "loop" };
    loop.cause = loop;
    expect(describeModelFailure(loop)).toEqual({ reason: "unknown" });
  });
});

describe("the wait after a failure", () => {
  it("starts at ten minutes, doubles, and stops at two hours", () => {
    expect([1, 2, 3, 4, 5, 6, 20, 1000].map((failures) => outageWait(failures) / MINUTE)).toEqual([
      10, 20, 40, 80, 120, 120, 120, 120,
    ]);
    expect(outageWait(0)).toBe(OUTAGE_FIRST_WAIT_MS);
    expect(OUTAGE_MAX_WAIT_MS).toBe(120 * MINUTE);
  });

  it("reads a stored outage and refuses anything else", () => {
    const stored = { failures: 3, until: "2026-10-05T10:00:00.000Z" };
    expect(readOutage(stored)).toEqual(stored);
    expect(readOutage({ failures: 500, until: stored.until })?.failures).toBe(20);
    for (const value of [
      undefined,
      null,
      "x",
      {},
      { failures: 0, until: stored.until },
      { failures: 1.5, until: stored.until },
      { failures: "2", until: "not a date" },
      { failures: 2 },
    ])
      expect(readOutage(value)).toBeUndefined();
  });

  it("ends when the owner asks for a check, but keeps the count", () => {
    const now = new Date("2026-10-05T10:05:00Z");
    const counters = {
      date: "2026-10-05",
      passes: 4,
      outage: { failures: 2, until: "2026-10-05T10:30:00.000Z" },
    };
    expect(withoutOutageWait(counters, now)).toEqual({
      ...counters,
      outage: { failures: 2, until: now.toISOString() },
    });
    // A wait that has run out is left as it is, and nothing waiting means nothing to change.
    const over = { failures: 1, until: "2026-10-05T10:00:00.000Z" };
    expect(withoutOutageWait({ outage: over }, now)).toEqual({ outage: over });
    expect(withoutOutageWait({ date: "2026-10-05", passes: 1 }, now)).toBeUndefined();
    expect(withoutOutageWait(null, now)).toBeUndefined();
  });
});

describe("the model's health over a cycle", () => {
  const now = new Date("2026-10-05T10:00:00Z");
  const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE).toISOString();
  const refused = new Error("402 Payment Required");

  it("waits ten minutes after the first failure and holds until then", () => {
    const health = modelHealth(now, undefined);
    expect(health.holding()).toBe(false);
    expect(health.outage).toBeUndefined();
    health.failed(refused);
    expect(health.outage).toEqual({ failures: 1, until: at(10) });
    expect(health.holding()).toBe(true);
    expect(health.until()?.toISOString()).toBe(at(10));
    // The next cycle starts later, from what was stored.
    expect(modelHealth(new Date(at(9)), health.outage).holding()).toBe(true);
    expect(modelHealth(new Date(at(10)), health.outage).holding()).toBe(false);
    expect(modelHealth(new Date(at(10)), health.outage).until()).toBeUndefined();
  });

  it("doubles the wait while the failures follow each other", () => {
    let stored = modelHealth(now, undefined);
    stored.failed(refused);
    const waits: number[] = [];
    let clock = now;
    for (let round = 0; round < 6; round += 1) {
      const outage = stored.outage!;
      clock = new Date(outage.until);
      stored = modelHealth(clock, outage);
      expect(stored.holding()).toBe(false);
      stored.failed(refused);
      waits.push((Date.parse(stored.outage!.until) - clock.getTime()) / MINUTE);
    }
    expect(waits).toEqual([20, 40, 80, 120, 120, 120]);
  });

  it("ignores a second failure while it is already waiting", () => {
    const health = modelHealth(now, undefined);
    health.failed(refused);
    health.failed(refused);
    expect(health.outage).toEqual({ failures: 1, until: at(10) });
  });

  it("ends on the first answer, usable or not, and starts over after one", () => {
    const health = modelHealth(new Date(at(10)), { failures: 4, until: at(10) });
    expect(health.track({ status: "invalid" })).toEqual({ status: "invalid" });
    expect(health.outage).toBeUndefined();
    // A later failure in the same cycle is a new series, not the fifth in a row.
    health.failed(refused);
    expect(health.outage?.failures).toBe(1);

    const answered = modelHealth(new Date(at(10)), { failures: 2, until: at(10) });
    answered.track({ status: "ok", value: {} });
    expect(answered.outage).toBeUndefined();
  });

  it("counts a failed pass as a failure and nothing else", () => {
    const health = modelHealth(now, undefined);
    const failed = { status: "failed" as const, error: refused };
    expect(health.track(failed)).toBe(failed);
    expect(health.outage?.failures).toBe(1);
  });

  it("starts over once a series has been quiet for longer than the longest wait", () => {
    const stored = { failures: 5, until: at(0) };
    const soon = modelHealth(new Date(at(119)), stored);
    soon.failed(refused);
    expect(soon.outage?.failures).toBe(6);
    const later = modelHealth(new Date(at(121)), stored);
    later.failed(refused);
    expect(later.outage?.failures).toBe(1);
  });

  it("tells the owner the model is unavailable without naming a cause", () => {
    expect(MODEL_UNAVAILABLE).toBe(
      "The model is unavailable. If this lasts, check the provider's credit or key.",
    );
    expect(MODEL_UNAVAILABLE).not.toMatch(/[‒-―]/);
  });
});
