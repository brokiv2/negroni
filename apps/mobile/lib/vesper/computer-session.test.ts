import { describe, expect, it } from "vitest";
import {
  canDriveScreen,
  computerControl,
  computerControlLabel,
  computerTabLabel,
  isComputerEvent,
  isRunActivityEvent,
  primaryControlAction,
  releaseChoices,
  VESPER_COMPUTER_TABS,
  type VesperComputerSession,
} from "./computer-session";

function session(patch: Partial<NonNullable<VesperComputerSession>> = {}) {
  return {
    state: "running" as const,
    controlHolder: "none" as const,
    controlBotId: null,
    takeoverRequested: false,
    busyBotName: null,
    ...patch,
  };
}

describe("computerControl", () => {
  it("reads a missing status as offline", () => {
    expect(computerControl(null, "bot_1")).toBe("offline");
  });

  it("maps the lifecycle states before it looks at control", () => {
    expect(computerControl(session({ state: "booting" }), "bot_1")).toBe("booting");
    expect(computerControl(session({ state: "suspended" }), "bot_1")).toBe("asleep");
    expect(computerControl(session({ state: "error" }), "bot_1")).toBe("failed");
    expect(computerControl(session({ state: "stopped" }), "bot_1")).toBe("offline");
  });

  it("only calls it yours when the lease is on this bot", () => {
    const held = session({ controlHolder: "user", controlBotId: "bot_1" });
    expect(computerControl(held, "bot_1")).toBe("youDriving");
    expect(computerControl(held, "bot_2")).toBe("busy");
  });

  it("puts a pending handoff ahead of the bot simply driving", () => {
    expect(computerControl(session({ controlHolder: "bot" }), "bot_1")).toBe("botDriving");
    expect(
      computerControl(session({ controlHolder: "bot", takeoverRequested: true }), "bot_1"),
    ).toBe("handoffRequested");
  });

  it("is idle when it is up and nobody is holding it", () => {
    expect(computerControl(session(), "bot_1")).toBe("idle");
  });
});

describe("computerControlLabel", () => {
  it("names the bot that is busy when the backend knows it", () => {
    expect(computerControlLabel("botDriving", "Scout")).toBe("Scout is working on it");
    expect(computerControlLabel("botDriving", null)).toBe("Your agent is working on it");
  });

  it("has a line for every control state", () => {
    for (const control of [
      "offline",
      "booting",
      "asleep",
      "failed",
      "busy",
      "handoffRequested",
      "botDriving",
      "youDriving",
      "idle",
    ] as const) {
      expect(computerControlLabel(control)).not.toBe("");
    }
  });
});

describe("canDriveScreen", () => {
  it("accepts touches only while this person holds the lease", () => {
    expect(canDriveScreen("youDriving")).toBe(true);
    expect(canDriveScreen("handoffRequested")).toBe(false);
    expect(canDriveScreen("idle")).toBe(false);
  });
});

describe("releaseChoices", () => {
  it("offers a single hand-back when nothing asked for the keyboard", () => {
    expect(releaseChoices(false)).toEqual([{ id: "release", label: "Hand it back" }]);
  });

  it("keeps skip and done distinct when a takeover is pending", () => {
    const choices = releaseChoices(true);
    expect(choices.map((choice) => choice.reason)).toEqual(["skipped", "done"]);
    expect(choices.find((choice) => choice.primary)?.reason).toBe("done");
  });
});

describe("primaryControlAction", () => {
  it("offers nothing while this person already drives or the box is coming up", () => {
    expect(primaryControlAction("youDriving")).toBeNull();
    expect(primaryControlAction("booting")).toBeNull();
    expect(primaryControlAction("busy")).toBeNull();
  });

  it("wakes a suspended box and starts a stopped one", () => {
    expect(primaryControlAction("asleep")?.id).toBe("wake");
    expect(primaryControlAction("offline")?.id).toBe("start");
    expect(primaryControlAction("failed")?.id).toBe("start");
  });

  it("takes control of a running one", () => {
    expect(primaryControlAction("idle")?.id).toBe("take");
    expect(primaryControlAction("handoffRequested")?.id).toBe("take");
    expect(primaryControlAction("botDriving")?.id).toBe("take");
  });
});

describe("event predicates", () => {
  it("catches every computer event the contract emits", () => {
    for (const type of [
      "computer.status",
      "computer.takeover.requested",
      "computer.takeover.granted",
      "computer.takeover.released",
    ]) {
      expect(isComputerEvent(type)).toBe(true);
    }
    expect(isComputerEvent("thread.message.created")).toBe(false);
  });

  it("treats run lifecycle and the thread computer block as activity", () => {
    expect(isRunActivityEvent("run.started")).toBe(true);
    expect(isRunActivityEvent("run.waiting_input")).toBe(true);
    expect(isRunActivityEvent("thread.computer")).toBe(true);
    expect(isRunActivityEvent("thread.message.created")).toBe(false);
  });
});

describe("computer tabs", () => {
  it("ships the two tabs Negroni can back today", () => {
    expect([...VESPER_COMPUTER_TABS]).toEqual(["screen", "files"]);
  });

  it("labels every tab", () => {
    for (const tab of VESPER_COMPUTER_TABS) expect(computerTabLabel(tab)).not.toBe("");
  });
});
