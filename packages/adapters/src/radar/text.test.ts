import { describe, expect, it } from "vitest";
import { plainDashes } from "./text.js";

const EM = "\u2014";
const EN = "\u2013";

describe("plain dashes", () => {
  it("turns a spaced long dash into a spaced hyphen and an unspaced one into a hyphen", () => {
    expect(plainDashes(`Budget ${EM} due Friday`)).toBe("Budget - due Friday");
    expect(plainDashes(`Budget ${EN} due Friday`)).toBe("Budget - due Friday");
    expect(plainDashes(`Budget${EM}due Friday`)).toBe("Budget-due Friday");
    expect(plainDashes(`7${EN}8 October, 10:00${EN}11:00`)).toBe("7-8 October, 10:00-11:00");
    expect(plainDashes(`10:00 ${EN} 11:00`)).toBe("10:00 - 11:00");
    expect(plainDashes(`Бюджет ${EM} сдача до 16-го`)).toBe("Бюджет - сдача до 16-го");
  });

  it("counts a dash with a space on one side as spaced", () => {
    expect(plainDashes(`wait${EM} what`)).toBe("wait - what");
    expect(plainDashes(`wait ${EM}what`)).toBe("wait - what");
    expect(plainDashes(`wait\t${EM}\twhat`)).toBe("wait - what");
  });

  it("leaves no stray space at the start or the end of a line", () => {
    expect(plainDashes(`${EM} first\n${EM} second`)).toBe("- first\n- second");
    expect(plainDashes(`Hold on ${EM}\nthen go ${EM}`)).toBe("Hold on -\nthen go -");
  });

  it("covers the other long dashes and collapses a run of them", () => {
    expect(plainDashes("a \u2012 b \u2015 c")).toBe("a - b - c");
    expect(plainDashes(`a ${EM}${EM} b`)).toBe("a - b");
    expect(plainDashes(`a${EM}${EN}b`)).toBe("a-b");
  });

  it("changes nothing else and is idempotent", () => {
    for (const text of [
      "A well-known co-op - nothing to change.",
      "Plain text, with: punctuation; and a minus -3.",
      "Привет, мир!",
      "",
    ])
      expect(plainDashes(text)).toBe(text);
    const messy = `x ${EM} y${EN}z\n${EM} w ${EM}`;
    expect(plainDashes(plainDashes(messy))).toBe(plainDashes(messy));
  });
});
