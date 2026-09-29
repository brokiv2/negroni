import { UpdateAssistantWorkInput } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import {
  completionMarksUnread,
  runAllowsSilentEmpty,
  runPromotesMidTurnNarration,
} from "./executor.js";
import { filterBuiltinToolsForRun } from "./schedule-tools.js";

describe("ongoing work boundaries", () => {
  it.each(["routine", "work", "bot_message", "webhook"])(
    "does not let %s start or reactivate responsibilities",
    (trigger) => {
      const names = filterBuiltinToolsForRun(builtinAgentTools, trigger).map((tool) => tool.name);
      expect(names).not.toContain("work_create");
      expect(names).not.toContain("work_control");
      expect(names).toContain("work_update");
    },
  );
  it("keeps work wakes quiet when they have no result", () => {
    expect(runAllowsSilentEmpty("work")).toBe(true);
    expect(runPromotesMidTurnNarration("work")).toBe(false);
    expect(completionMarksUnread("work", "")).toBe(false);
    expect(completionMarksUnread("work", "A verified change")).toBe(true);
  });
  it("requires completion evidence and an explicit waiting time", () => {
    const base = { workId: "work", version: 1, wakeReason: "Check" };
    expect(UpdateAssistantWorkInput.safeParse({ ...base, status: "completed" }).success).toBe(
      false,
    );
    expect(UpdateAssistantWorkInput.safeParse({ ...base, status: "waiting" }).success).toBe(false);
    expect(
      UpdateAssistantWorkInput.safeParse({
        ...base,
        status: "completed",
        result: "Verified receipt",
        nextWakeAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
