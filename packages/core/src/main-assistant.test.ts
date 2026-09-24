import { describe, expect, it } from "vitest";
import { assistantHierarchyIds, mainAssistantBot } from "./main-assistant.js";

describe("mainAssistantBot", () => {
  it("uses the pinned root for the shared assistant conversation", () => {
    const bots = [
      { id: "child", parentBotId: "chief", pinned: true, createdAt: "2026-01-01" },
      { id: "other", parentBotId: null, pinned: false, createdAt: "2026-01-01" },
      { id: "chief", parentBotId: null, pinned: true, createdAt: "2026-02-01" },
    ];
    expect(mainAssistantBot(bots)?.id).toBe("chief");
  });

  it("does not route to an archived bot", () => {
    expect(mainAssistantBot([
      { id: "old", pinned: true, parentBotId: null, archivedAt: "2026-01-01" },
      { id: "active", pinned: false, parentBotId: null, archivedAt: null },
    ])?.id).toBe("active");
  });
});

describe("assistantHierarchyIds", () => {
  it("includes nested delegated bots without pulling in another root's work", () => {
    const bots = [
      { id: "grandchild", parentBotId: "child" },
      { id: "other-child", parentBotId: "other" },
      { id: "child", parentBotId: "chief" },
      { id: "other", parentBotId: null },
    ];
    expect([...assistantHierarchyIds("chief", bots)].sort()).toEqual(["chief", "child", "grandchild"]);
  });
});
