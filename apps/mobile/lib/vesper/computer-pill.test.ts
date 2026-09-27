import type { ComputerStatus } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { computerPillLabel, computerPillOnline, computerPillState } from "./computer-pill";

function status(patch: Partial<ComputerStatus>): ComputerStatus {
  return {
    botId: "bot_1",
    mode: "browser",
    kind: "computer",
    state: "running",
    controlHolder: "none",
    controlBotId: null,
    takeoverRequested: false,
    screenAvailable: true,
    screenWidth: 1280,
    screenHeight: 800,
    homeRevision: null,
    busyBotName: null,
    canUpdate: false,
    ...patch,
  } as ComputerStatus;
}

describe("computer pill", () => {
  it("is offline before the status has arrived", () => {
    expect(computerPillState(null)).toBe("offline");
    expect(computerPillLabel("offline")).toBe("Computer · offline");
    expect(computerPillOnline("offline")).toBe(false);
  });

  it("is offline for every non-running machine state", () => {
    for (const state of ["stopped", "booting", "suspended", "error"] as const) {
      expect(computerPillState(status({ state })), state).toBe("offline");
    }
  });

  it("is ready when the machine is up and nobody is driving", () => {
    expect(computerPillState(status({}))).toBe("ready");
    expect(computerPillLabel("ready")).toBe("Computer · ready");
    expect(computerPillOnline("ready")).toBe(true);
  });

  it("offers to take control while the bot is driving", () => {
    expect(computerPillState(status({ controlHolder: "bot" }))).toBe("takeControl");
    expect(computerPillLabel("takeControl")).toBe("Computer · take control");
  });

  it("offers to take control the moment a takeover is requested", () => {
    expect(computerPillState(status({ takeoverRequested: true }))).toBe("takeControl");
  });

  it("stays ready while the person already holds control", () => {
    expect(computerPillState(status({ controlHolder: "user" }))).toBe("ready");
  });

  it("keeps the dot lit whenever the machine is up", () => {
    expect(computerPillOnline("takeControl")).toBe(true);
  });
});
