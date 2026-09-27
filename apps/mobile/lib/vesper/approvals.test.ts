import { describe, expect, it } from "vitest";
import { approvalNotes, approvalRows } from "./approvals";

const detail = "Recipient is not in this thread\nto: ada@example.com\nsubject: Itinerary";

describe("approvalRows", () => {
  it("keeps the exact recipient and action as labelled rows", () => {
    expect(approvalRows(detail)).toEqual([
      { k: "to", v: "ada@example.com" },
      { k: "subject", v: "Itinerary" },
    ]);
  });

  it("is empty with no detail", () => {
    expect(approvalRows(undefined)).toEqual([]);
    expect(approvalRows("")).toEqual([]);
  });

  it("does not mistake a sentence with a colon for a field", () => {
    expect(approvalRows("Note: this is prose, and that is fine")).toEqual([
      { k: "Note", v: "this is prose, and that is fine" },
    ]);
    expect(approvalRows("https://example.com/x")).toEqual([]);
  });
});

describe("approvalNotes", () => {
  it("keeps the prose reason and leaves the fields to approvalRows", () => {
    expect(approvalNotes(detail)).toEqual(["Recipient is not in this thread"]);
  });

  it("is empty with no detail", () => {
    expect(approvalNotes(undefined)).toEqual([]);
  });
});
