import { describe, expect, it, vi } from "vitest";
import {
  authorizeConnection,
  CONNECTION_RETURN_URL,
  parseConnectionReturn,
} from "./connection-auth.js";

describe("parseConnectionReturn", () => {
  it("reads the connection id and status from the callback deep link", () => {
    expect(
      parseConnectionReturn("negroni://integrations?connection=conn-1&status=connected"),
    ).toEqual({ connectionId: "conn-1", status: "connected" });
    expect(parseConnectionReturn("negroni://integrations/?connection=c&status=weird")).toEqual({
      connectionId: "c",
      status: null,
    });
    expect(parseConnectionReturn("https://example.test/?connection=c")).toEqual({
      connectionId: null,
      status: null,
    });
  });
});

describe("authorizeConnection", () => {
  it("opens the auth session with the app return url and confirms immediately", async () => {
    const openAuthSession = vi.fn().mockResolvedValue({ type: "success" });
    const complete = vi.fn().mockResolvedValue({ status: "connected" });
    const phases: string[] = [];
    await expect(
      authorizeConnection({
        connectionId: "conn-1",
        authorizationUrl: "https://auth.test/consent",
        openAuthSession,
        complete,
        signal: new AbortController().signal,
        onPhase: (phase) => phases.push(phase),
      }),
    ).resolves.toBe("connected");
    expect(openAuthSession).toHaveBeenCalledWith(
      "https://auth.test/consent",
      CONNECTION_RETURN_URL,
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["authorizing", "confirming"]);
  });

  it("keeps polling after a dismissed session and reports pending when it never connects", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ status: "pending" });
    await expect(
      authorizeConnection({
        connectionId: "conn-1",
        authorizationUrl: "https://auth.test/consent",
        openAuthSession: async () => ({ type: "dismiss" }),
        complete,
        signal: new AbortController().signal,
        attempts: 3,
        intervalMs: 1,
      }),
    ).resolves.toBe("pending");
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("skips the browser for no-auth apps and stops when aborted", async () => {
    const openAuthSession = vi.fn();
    const controller = new AbortController();
    const complete = vi.fn(async () => {
      controller.abort();
      return { status: "pending" };
    });
    await expect(
      authorizeConnection({
        connectionId: "conn-1",
        authorizationUrl: null,
        openAuthSession,
        complete,
        signal: controller.signal,
        intervalMs: 1,
      }),
    ).resolves.toBe("aborted");
    expect(openAuthSession).not.toHaveBeenCalled();
  });
});
