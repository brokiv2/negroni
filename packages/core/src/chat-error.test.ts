import { describe, expect, it } from "vitest";
import { friendlyChatError } from "./chat-error.js";

describe("friendlyChatError", () => {
  it("gives an explicit recovery action for expired sessions", () => {
    expect(friendlyChatError("SESSION_EXPIRED")).toBe("Your session has expired. Sign in again to continue.");
  });
  it("does not expose provider diagnostics", () => {
    expect(friendlyChatError(new Error("provider rejected request: status 500, api_key=secret")))
      .toBe("Something went wrong. Please try again.");
  });

  it("gives a useful message for a connection failure", () => {
    expect(friendlyChatError(new Error("ECONNREFUSED 127.0.0.1:3100")))
      .toBe("Can't reach Negroni right now. Check your connection and try again.");
  });
});
