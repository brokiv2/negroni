import { describe, expect, it } from "vitest";
import {
  DEFAULT_VESPER_SECTION,
  isVesperSection,
  normalizeVesperSection,
  VESPER_SECTIONS,
  vesperSectionHeading,
  vesperSectionLabel,
} from "./nav";

describe("vesper navigation", () => {
  it("has the destinations in order, chat first", () => {
    expect([...VESPER_SECTIONS]).toEqual(["chat", "team", "activity", "ideas", "goals", "apps"]);
    expect(DEFAULT_VESPER_SECTION).toBe("chat");
  });

  it("recognizes only its own sections", () => {
    expect(isVesperSection("goals")).toBe(true);
    expect(isVesperSection("mail")).toBe(false);
    expect(isVesperSection(null)).toBe(false);
    expect(normalizeVesperSection("mail")).toBe("chat");
    expect(normalizeVesperSection("apps")).toBe("apps");
  });

  it("labels every nav item", () => {
    for (const section of VESPER_SECTIONS) {
      expect(vesperSectionLabel(section), section).toBeTruthy();
    }
    expect(vesperSectionLabel("chat")).toBe("Chat");
  });

  it("gives every section but chat a title and a subtitle", () => {
    expect(vesperSectionHeading("chat")).toBeNull();
    for (const section of VESPER_SECTIONS.filter((item) => item !== "chat")) {
      const heading = vesperSectionHeading(section);
      expect(heading?.title, section).toBeTruthy();
      if (section !== "team") expect(heading?.subtitle, section).toBeTruthy();
    }
    expect(vesperSectionHeading("activity")?.title).toBe("Activity");
  });
});
