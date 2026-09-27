import type { Routine, ScratchpadItem } from "@rakazo/contracts";
import { presetFromCron } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import {
  completedGoalItems,
  cronForTrackingFrequency,
  goalCategoryLabel,
  goalItems,
  goalPlanPrompt,
  goalStatusLabel,
  isTrackingUrl,
  sortScratchpadItems,
  trackingPrompt,
  trackingRoutines,
  trackingScheduleLabel,
  VESPER_GOAL_CATEGORIES,
  VESPER_TRACKING_FREQUENCIES,
} from "./goals";

function item(over: Partial<ScratchpadItem> & { id: string }): ScratchpadItem {
  return {
    botId: "bot",
    title: "Goal",
    status: "open",
    notes: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as ScratchpadItem;
}

function routine(over: Partial<Routine> & { id: string }): Routine {
  return {
    botId: "bot",
    name: "Check",
    prompt: "look",
    crons: ["0 * * * *"],
    timezone: "UTC",
    active: true,
    notify: true,
    webhookEnabled: false,
    githubEnabled: false,
    messageProvider: null,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as Routine;
}

describe("sortScratchpadItems", () => {
  it("puts the most recently touched item first", () => {
    const sorted = sortScratchpadItems([
      item({ id: "a", updatedAt: "2026-09-01T00:00:00.000Z" }),
      item({ id: "b", updatedAt: "2026-09-09T00:00:00.000Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("collapses the duplicate a hierarchy fanout can return", () => {
    expect(sortScratchpadItems([item({ id: "a" }), item({ id: "a" })])).toHaveLength(1);
  });
});

describe("goalItems", () => {
  it("keeps open items and leaves parked ideas and finished goals out", () => {
    const items = [
      item({ id: "open" }),
      item({ id: "idea", status: "parked" }),
      item({ id: "done", status: "done" }),
    ];
    expect(goalItems(items).map((entry) => entry.id)).toEqual(["open"]);
    expect(completedGoalItems(items).map((entry) => entry.id)).toEqual(["done"]);
  });
});

describe("goalStatusLabel", () => {
  it("names every scratchpad status", () => {
    expect(goalStatusLabel("open")).toBe("In progress");
    expect(goalStatusLabel("done")).toBe("Complete");
    expect(goalStatusLabel("parked")).toBe("Parked");
  });
});

describe("goalPlanPrompt", () => {
  it("asks for next steps on a bare goal", () => {
    expect(goalPlanPrompt({ title: "Run a 10k", notes: "" })).toBe(
      "Help me make progress on this goal: Run a 10k\n\nSuggest the next three concrete steps.",
    );
  });

  it("carries the notes across when there are any", () => {
    expect(goalPlanPrompt({ title: "Run a 10k", notes: "  Knee is dodgy  " })).toContain(
      "What I have written down so far:\nKnee is dodgy",
    );
  });
});

describe("goal categories", () => {
  it("labels all four starting points", () => {
    expect(VESPER_GOAL_CATEGORIES.map(goalCategoryLabel)).toEqual([
      "Health",
      "Relationships",
      "Finances",
      "Something else",
    ]);
  });
});

describe("cronForTrackingFrequency", () => {
  it("produces a cron every offered schedule round-trips", () => {
    for (const frequency of VESPER_TRACKING_FREQUENCIES) {
      const cron = cronForTrackingFrequency(frequency);
      expect(cron.split(/\s+/)).toHaveLength(5);
      expect(presetFromCron(cron).freq).not.toBe("Advanced");
    }
  });

  it("uses a minute step that actually divides an hour", () => {
    expect(cronForTrackingFrequency("quarter-hourly")).toBe("*/15 * * * *");
  });
});

describe("trackingRoutines", () => {
  it("sorts active checks above paused ones, then by name", () => {
    const sorted = trackingRoutines([
      routine({ id: "z", name: "Zebra" }),
      routine({ id: "p", name: "Alpha", active: false }),
      routine({ id: "a", name: "Aardvark" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "z", "p"]);
  });
});

describe("trackingScheduleLabel", () => {
  it("says it is paused rather than describing a schedule it is not running", () => {
    expect(trackingScheduleLabel({ active: false, crons: ["*/15 * * * *"] })).toBe("Paused");
  });

  it("reads back the interval", () => {
    expect(trackingScheduleLabel({ active: true, crons: ["*/15 * * * *"] })).toBe(
      "Checking every 15 minutes",
    );
    expect(trackingScheduleLabel({ active: true, crons: ["0 * * * *"] })).toBe(
      "Checking every hour",
    );
    expect(trackingScheduleLabel({ active: true, crons: ["0 */6 * * *"] })).toBe(
      "Checking every 6 hours",
    );
  });

  it("describes a daily and a weekday schedule with its time", () => {
    expect(trackingScheduleLabel({ active: true, crons: ["0 9 * * *"] })).toBe(
      "Checking every day at 9:00 AM",
    );
    expect(trackingScheduleLabel({ active: true, crons: ["0 9 * * 1-5"] })).toBe(
      "Checking on weekdays at 9:00 AM",
    );
  });

  it("does not pretend to read a cron made somewhere else", () => {
    expect(trackingScheduleLabel({ active: true, crons: ["7 3 2 4 *"] })).toBe(
      "Checking on a custom schedule",
    );
  });

  it("says so when a routine has no schedule at all", () => {
    expect(trackingScheduleLabel({ active: true, crons: [] })).toBe("No schedule yet");
  });
});

describe("trackingPrompt", () => {
  it("asks only for changes, so a check does not repeat itself every hour", () => {
    const prompt = trackingPrompt({ watching: "a table at Bar Alto" });
    expect(prompt).toContain("Check on this for me: a table at Bar Alto");
    expect(prompt).toContain("only when something has actually changed");
    expect(prompt).not.toContain("Look at");
  });

  it("names the page when there is one", () => {
    expect(trackingPrompt({ watching: "the price", url: "https://example.com/x" })).toContain(
      "Look at https://example.com/x.",
    );
  });
});

describe("isTrackingUrl", () => {
  it("accepts http and https and nothing else", () => {
    expect(isTrackingUrl(" https://example.com/x ")).toBe(true);
    expect(isTrackingUrl("http://example.com")).toBe(true);
    expect(isTrackingUrl("example.com")).toBe(false);
    expect(isTrackingUrl("javascript:alert(1)")).toBe(false);
  });
});
