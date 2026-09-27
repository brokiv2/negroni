import { describe, expect, it } from "vitest";
import {
  hasStatusAttention,
  leadingStatusRun,
  statusSnippet,
  type VesperStatusRun,
  vesperStatusLine,
} from "./status-line";

function run(status: string, promptSnippet = ""): VesperStatusRun {
  return { status, promptSnippet } as VesperStatusRun;
}

describe("vesperStatusLine", () => {
  it("is quietly available when nothing is running", () => {
    expect(vesperStatusLine([])).toBe("Here when you need me");
  });

  it("ignores runs that have already finished", () => {
    expect(vesperStatusLine([run("completed", "old"), run("cancelled")])).toBe(
      "Here when you need me",
    );
  });

  it("says what a running turn is doing", () => {
    expect(vesperStatusLine([run("running", "Book the Lisbon flights")])).toBe(
      "Book the Lisbon flights",
    );
  });

  it("falls back when a running turn has no prompt to show", () => {
    expect(vesperStatusLine([run("running")])).toBe("Working on it…");
  });

  it("leads with the run that needs the person", () => {
    expect(
      vesperStatusLine([run("running", "Reading email"), run("waiting_input", "Which card?")]),
    ).toBe("Needs your input · Which card?");
  });

  it("puts input above takeover", () => {
    expect(
      vesperStatusLine([run("waiting_takeover", "Sign in"), run("waiting_input", "Which card?")]),
    ).toBe("Needs your input · Which card?");
  });

  it("names a takeover when that is the loudest thing", () => {
    expect(vesperStatusLine([run("waiting_takeover", "Sign in to the bank")])).toBe(
      "Ready for you at the computer · Sign in to the bank",
    );
  });

  it("says it is picking up the next task when only queued work is left", () => {
    expect(vesperStatusLine([run("queued", "Later")])).toBe("Picking up your next task…");
  });
});

describe("leadingStatusRun", () => {
  it("returns null when every run is terminal", () => {
    expect(leadingStatusRun([run("failed"), run("completed")])).toBeNull();
  });

  it("keeps the first of two equally urgent runs", () => {
    const first = run("running", "one");
    expect(leadingStatusRun([first, run("running", "two")])).toBe(first);
  });
});

describe("statusSnippet", () => {
  it("collapses whitespace", () => {
    expect(statusSnippet("  book   the\nflights ")).toBe("book the flights");
  });

  it("trims a long prompt at a word boundary", () => {
    const snippet = statusSnippet(
      "Compare every flight from Lisbon to Reykjavik in March and rank them by total travel time",
    );
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(61);
    expect(snippet).not.toMatch(/ …$/);
  });

  it("leaves a short prompt alone", () => {
    expect(statusSnippet("Book the flights")).toBe("Book the flights");
  });
});

describe("hasStatusAttention", () => {
  it("is true only when a run is waiting on the person", () => {
    expect(hasStatusAttention([run("running")])).toBe(false);
    expect(hasStatusAttention([run("waiting_input")])).toBe(true);
    expect(hasStatusAttention([run("waiting_takeover")])).toBe(true);
  });
});
