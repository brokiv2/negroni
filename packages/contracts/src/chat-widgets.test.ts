import { describe, expect, it } from "vitest";
import { EmailDraftWidget, parseEmailDraftReview, WeatherWidget } from "./chat-widgets.js";
import { MessageBlock } from "./events.js";

const draft = {
  account: "Demo mail",
  to: ["test@example.test"],
  cc: [],
  subject: "Agenda",
  body: "Hello",
};
const weather = {
  location: "Lisbon",
  temperature: 24,
  unit: "C",
  condition: "clear",
  description: "Sunny",
  observedAt: "2026-09-30T09:00:00Z",
  sourceUrl: "https://example.test/weather",
  forecast: [{ label: "14:00", temperature: 25, condition: "cloudy", precipitation: 10 }],
};
describe("chat widgets", () => {
  it("roundtrips typed weather while retaining a fallback for older clients", () => {
    expect(
      MessageBlock.parse({ kind: "card", lines: [{ k: "Sunny", v: "24°C" }], weather }),
    ).toHaveProperty("weather", weather);
  });
  it("rejects missing provenance, invalid units and impossible precipitation", () => {
    for (const patch of [
      { sourceUrl: "javascript:alert(1)" },
      { observedAt: "today" },
      { unit: "K" },
      { forecast: [{ ...weather.forecast[0], precipitation: 150 }] },
    ]) {
      expect(WeatherWidget.safeParse({ ...weather, ...patch }).success).toBe(false);
    }
  });
  it("preserves reviewed recipient and body edits without treating them as sent", () => {
    const review = parseEmailDraftReview(
      JSON.stringify({
        type: "email_review",
        action: "send",
        draft: { ...draft, body: "Edited body" },
      }),
    );
    expect(review.success && review.data.draft.body).toBe("Edited body");
    expect(
      MessageBlock.parse({ kind: "ask", text: "Agenda", emailDraft: draft, status: "pending" }),
    ).toHaveProperty("emailDraft", draft);
  });
  it("rejects malformed recipients and unrecognized structured actions", () => {
    expect(EmailDraftWidget.safeParse({ ...draft, to: ["not an address"] }).success).toBe(false);
    expect(parseEmailDraftReview('{"type":"email_review"}').success).toBe(false);
    expect(parseEmailDraftReview("yes").success).toBe(false);
  });
});
