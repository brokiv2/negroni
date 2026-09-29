import { describe, expect, it } from "vitest";
import { FeedProfilePatch } from "./personal-feed.js";

describe("feed settings patches", () => {
  it("preserves omitted settings instead of inserting profile defaults", () => {
    expect(FeedProfilePatch.parse({ sourceDomains: [] })).toEqual({ sourceDomains: [] });
    expect(FeedProfilePatch.parse({ learningEnabled: true })).toEqual({ learningEnabled: true });
    expect(FeedProfilePatch.parse({ maxItems: 3 })).toEqual({ maxItems: 3 });
    expect(FeedProfilePatch.parse({})).toEqual({});
  });
});
