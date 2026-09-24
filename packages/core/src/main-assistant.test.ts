import { describe, expect, it } from "vitest";
import {
  assistantHierarchyIds,
  coordinationInstructionFor,
  MAIN_ASSISTANT_INSTRUCTION,
  mainAssistantBot,
  PERSONAL_ASSISTANT_INSTRUCTION,
  personalTabExplainer,
  runInteractionModeFor,
} from "./main-assistant.js";

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

describe("runInteractionModeFor", () => {
  it("runs Personal thread messages in personal mode", () => {
    expect(runInteractionModeFor({ threadKind: "personal" })).toBe("personal");
    expect(runInteractionModeFor({ requested: "chat", threadKind: "personal" })).toBe("personal");
  });

  it("keeps Team threads in chat and calls in voice", () => {
    expect(runInteractionModeFor({ threadKind: "team" })).toBe("chat");
    expect(runInteractionModeFor({})).toBe("chat");
    expect(runInteractionModeFor({ requested: "voice", threadKind: "personal" })).toBe("voice");
  });
});

describe("coordinationInstructionFor", () => {
  const base = { inGroup: false, isMainAssistant: true, parentBotId: null };

  it("makes the assistant own a personal run", () => {
    const prompt = coordinationInstructionFor({ ...base, interactionMode: "personal" });
    expect(prompt).toBe(PERSONAL_ASSISTANT_INSTRUCTION);
    expect(prompt).toMatch(/message_bot/);
    expect(prompt).toMatch(/run_subagent/);
    expect(prompt).toMatch(/Never ask the user to open or read another bot's chat/);
    expect(prompt).toMatch(/only when a decision or an approval is genuinely needed/);
  });

  it("keeps the Team roles for chat runs", () => {
    expect(coordinationInstructionFor({ ...base, interactionMode: "chat" })).toBe(
      MAIN_ASSISTANT_INSTRUCTION,
    );
    expect(
      coordinationInstructionFor({
        ...base,
        interactionMode: "chat",
        isMainAssistant: false,
        parentBotId: "chief",
      }),
    ).toMatch(/specialist.*chief/);
    expect(
      coordinationInstructionFor({ ...base, interactionMode: "chat", isMainAssistant: false }),
    ).toBeUndefined();
  });

  it("adds no role prompt inside a group", () => {
    expect(
      coordinationInstructionFor({ ...base, interactionMode: "personal", inGroup: true }),
    ).toBeUndefined();
  });
});

describe("personalTabExplainer", () => {
  it("gives every Personal tab one short line without em dashes", () => {
    for (const tab of ["for-you", "goals", "ideas", "activity", "memory"] as const) {
      const line = personalTabExplainer(tab, "Negroni");
      expect(line).toContain("Negroni");
      expect(line).not.toMatch(/—|\n/);
      expect(line.length).toBeLessThan(80);
    }
    expect(personalTabExplainer("goals", " ")).toContain("Your assistant");
  });
});
