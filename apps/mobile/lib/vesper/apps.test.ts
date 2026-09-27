import { describe, expect, it } from "vitest";
import {
  filterAppRows,
  leavesVesper,
  VESPER_APP_ROWS,
  VESPER_HIDDEN_SURFACES,
  vesperAppRoute,
  vesperAppRowCopy,
} from "./apps";

describe("VESPER_APP_ROWS", () => {
  it("shows the six surfaces the port spec settled on, plus the way back", () => {
    expect([...VESPER_APP_ROWS]).toEqual([
      "context",
      "connectors",
      "models",
      "voice",
      "approvals",
      "account",
      "negroni",
    ]);
  });

  it("hides the team-shaped and operator-shaped surfaces", () => {
    expect([...VESPER_HIDDEN_SURFACES]).toEqual([
      "spaces",
      "bots",
      "groups",
      "skills",
      "mcp",
      "messaging",
      "usage",
      "deployment",
    ]);
    for (const hidden of VESPER_HIDDEN_SURFACES) {
      expect(VESPER_APP_ROWS).not.toContain(hidden);
    }
  });

  it("gives every row a title and a line of detail", () => {
    for (const row of VESPER_APP_ROWS) {
      const copy = vesperAppRowCopy(row);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("vesperAppRoute", () => {
  it("reuses the Negroni screen where one already exists", () => {
    expect(vesperAppRoute("connectors")).toBe("/integrations");
    expect(vesperAppRoute("models")).toBe("/models");
    expect(vesperAppRoute("voice")).toBe("/voice");
    expect(vesperAppRoute("account")).toBe("/account");
  });

  it("keeps the two surfaces Negroni has no screen for inside Vesper", () => {
    expect(vesperAppRoute("context")).toBe("/(vesper)/personal-context");
    expect(vesperAppRoute("approvals")).toBe("/(vesper)/approvals");
  });

  it("has no route for the shell switch, which is not a navigation", () => {
    expect(vesperAppRoute("negroni")).toBeNull();
  });
});

describe("leavesVesper", () => {
  it("is true only for the rows that hand over to a Negroni screen", () => {
    expect(leavesVesper("models")).toBe(true);
    expect(leavesVesper("context")).toBe(false);
    expect(leavesVesper("negroni")).toBe(false);
  });
});

describe("filterAppRows", () => {
  it("returns everything for an empty query", () => {
    expect(filterAppRows(VESPER_APP_ROWS, "   ")).toEqual(VESPER_APP_ROWS);
  });

  it("matches on the words a person can read", () => {
    expect(filterAppRows(VESPER_APP_ROWS, "memory")).toEqual(["context"]);
    expect(filterAppRows(VESPER_APP_ROWS, "PASSWORD")).toEqual(["account"]);
  });

  it("returns nothing rather than everything when there is no match", () => {
    expect(filterAppRows(VESPER_APP_ROWS, "deployment")).toEqual([]);
  });
});
