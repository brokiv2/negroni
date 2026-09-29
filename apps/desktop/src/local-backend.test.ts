import { describe, expect, it } from "vitest";
import { isNegroniLocalUrl } from "./local-backend.js";

describe("installed local backend startup", () => {
  it("starts only the known local service, never remote servers or the managed Docker stack", () => {
    expect(isNegroniLocalUrl("http://127.0.0.1:5173")).toBe(true);
    expect(isNegroniLocalUrl("http://localhost:5173")).toBe(true);
    for (const url of [
      "https://example.com",
      "http://127.0.0.1:45173",
      "http://localhost.attacker.test:5173",
      "invalid",
    ])
      expect(isNegroniLocalUrl(url)).toBe(false);
  });
});
