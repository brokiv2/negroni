import { describe, expect, it } from "vitest";
import {
  invertedChatDistanceFromLatest,
  invertedChatLatestOffset,
} from "./chat-keyboard";

describe("inverted chat keyboard offsets", () => {
  it("uses the negative effective top inset as the iOS latest offset", () => {
    const insets = { top: 264 };

    expect(invertedChatLatestOffset("ios", insets)).toBe(-264);
    expect(invertedChatDistanceFromLatest("ios", -264, insets)).toBe(0);
    expect(invertedChatDistanceFromLatest("ios", -80, insets)).toBe(184);
  });

  it("keeps Android's latest native offset at zero despite synthetic inset", () => {
    const insets = { top: 264 };

    expect(invertedChatLatestOffset("android", insets)).toBe(0);
    expect(invertedChatDistanceFromLatest("android", 0, insets)).toBe(0);
    expect(invertedChatDistanceFromLatest("android", 184, insets)).toBe(184);
  });
});
