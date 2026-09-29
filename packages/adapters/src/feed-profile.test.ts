import { FeedProfileSchema } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { eligibleFeedInterests, observeFeedInterest, updateFeedInterest } from "./feed-profile.js";

const base = () => FeedProfileSchema.parse({ learningEnabled: true });
const input = {
  topic: "AI agents",
  reason: "Repeated public research interest",
  evidence: "I study AI agents",
  confidence: 0.9,
};
const source = (id: string) => ({ id, text: "I study AI agents regularly" });
describe("selective feed learning", () => {
  it("keeps single observations out of curation and requires independent evidence", () => {
    const first = observeFeedInterest(base(), input, source("one"));
    expect(eligibleFeedInterests(first)).toHaveLength(0);
    const replay = observeFeedInterest(first, input, source("one"));
    expect(replay.interests[0]!.evidenceIds).toHaveLength(1);
    const second = observeFeedInterest(first, input, source("two"));
    expect(eligibleFeedInterests(second)).toHaveLength(1);
  });
  it("ignores a fabricated quote and disabled learning", () => {
    expect(observeFeedInterest(base(), input, { id: "one", text: "Hello" }).interests).toHaveLength(
      0,
    );
    expect(
      observeFeedInterest({ ...base(), learningEnabled: false }, input, source("one")).interests,
    ).toHaveLength(0);
  });
  it("rejects low confidence rather than silently treating it as an interest", () => {
    expect(() =>
      observeFeedInterest(base(), { ...input, confidence: 0.4 }, source("one")),
    ).toThrow();
  });
  it("never overrides an exclusion and allows deliberate refollow", () => {
    const excluded = updateFeedInterest(base(), "AI agents", "exclude");
    expect(observeFeedInterest(excluded, input, source("one")).interests).toHaveLength(0);
    const followed = updateFeedInterest(excluded, "AI agents", "follow");
    expect(eligibleFeedInterests(followed)).toHaveLength(1);
    expect(followed.excludedTopics).toEqual([]);
  });
  it("records no raw conversation and caps inference at one topic per message", () => {
    const p = observeFeedInterest(base(), input, source("one"));
    expect(JSON.stringify(p)).not.toContain(input.evidence);
    expect(
      observeFeedInterest(p, { ...input, topic: "Another topic" }, source("one")).interests,
    ).toHaveLength(1);
  });
  it("expires inferred topics and requires fresh repeated evidence", () => {
    const date = new Date(Date.now() - 40 * 86400000);
    const first = observeFeedInterest(base(), input, source("one"), date);
    const old = observeFeedInterest(first, input, source("two"), date);
    expect(eligibleFeedInterests(old)).toHaveLength(0);
    const fresh = observeFeedInterest(old, input, source("three"));
    expect(eligibleFeedInterests(fresh)).toHaveLength(0);
    expect(fresh.interests[0]!.evidenceIds).toEqual(["three"]);
  });
  it("explicit preferences persist until edited and can be forgotten", () => {
    const p = updateFeedInterest(base(), "AI agents", "follow");
    expect(eligibleFeedInterests(p, Date.now() + 365 * 86400000)).toHaveLength(1);
    expect(updateFeedInterest(p, "AI agents", "forget").interests).toHaveLength(0);
  });
});
