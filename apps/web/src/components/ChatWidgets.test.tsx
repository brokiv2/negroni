// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EmailDraftCard, WeatherCard } from "./ChatWidgets";

const draft = {
  account: "Demo mail",
  to: ["test@example.test"],
  cc: [],
  subject: "Agenda",
  body: "Hello",
};
describe("chat widgets", () => {
  it("submits edited text and preserves it on a failed request without duplicate sending", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const answer = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const click = async (text: string) =>
      act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent === text)!
          .click();
      });
    try {
      await act(async () =>
        root.render(<EmailDraftCard draft={draft} canAnswer onAnswer={answer} />),
      );
      await click("Edit & send");
      const body = container.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          body,
          "Reviewed body",
        );
        body.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click("Send");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(body.value).toBe("Reviewed body");
      await click("Send");
      expect(answer).toHaveBeenCalledTimes(2);
      expect(JSON.parse(answer.mock.calls[1]![0])).toMatchObject({
        action: "send",
        draft: { body: "Reviewed body" },
      });
      await act(async () =>
        root.render(
          <EmailDraftCard
            draft={draft}
            status="answered"
            answer="send"
            canAnswer
            onAnswer={answer}
          />,
        ),
      );
      expect(container.textContent).toContain("Send requested");
      expect(container.textContent).not.toContain("Edit & send");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
  it("shows forecast values and a source link", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <WeatherCard
            weather={{
              location: "Lisbon",
              temperature: 24,
              unit: "C",
              condition: "clear",
              description: "Sunny",
              observedAt: "2026-09-30T09:00:00Z",
              sourceUrl: "https://example.test/weather",
              forecast: [],
            }}
          />,
        ),
      );
      expect(container.textContent).toContain("24°C");
      expect(container.querySelector("a")?.href).toBe("https://example.test/weather");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
