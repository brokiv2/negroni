// @vitest-environment jsdom
import type { RadarStatus } from "@rakazo/contracts";
import {
  RADAR_PAUSED_UNTIL_RESUMED,
  RadarStatusSchema,
  RadarUpdateSchema,
} from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  configure: vi.fn(),
  source: vi.fn(),
  updates: vi.fn(),
  feedback: vi.fn(),
  rule: vi.fn(),
  person: vi.fn(),
  brief: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { radar: api } }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray | { message: string }, ...values: unknown[]) =>
      "raw" in strings ? String.raw(strings, ...values) : strings.message,
  }),
}));
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
}));

import { RadarPanel } from "./RadarPanel";
import { resetRadarStatusForTests } from "./radar-state";

const NOW = new Date("2026-10-04T03:00:00Z"); // 12:00 in Tokyo

function status(overrides: Record<string, unknown> = {}): RadarStatus {
  const { settings, ...rest } = overrides;
  return RadarStatusSchema.parse({
    settings: { enabled: true, timeZone: "Asia/Tokyo", ...(settings as object) },
    sources: [
      {
        connectionId: "connection-mail",
        source: "gmail",
        label: "Gmail",
        account: "owner@example.test",
        enabled: true,
        supported: true,
        state: "ok",
        seenToday: 4,
      },
      {
        connectionId: "connection-calendar",
        source: "googlecalendar",
        label: "Google Calendar",
        account: "owner@example.test",
        enabled: true,
        supported: true,
        state: "revoked",
        seenToday: 0,
      },
      {
        connectionId: "connection-notes",
        source: "notion",
        label: "Notion",
        enabled: false,
        supported: false,
        state: "unsupported",
        seenToday: 0,
      },
    ],
    today: { seen: 12, interrupted: 2, briefed: 5, skipped: 5, deferred: 0 },
    nextCycleAt: "2026-10-04T03:10:00.000Z",
    summary: "Leads a small design studio.",
    rules: [
      {
        id: "rule-invoices",
        kind: "digest",
        match: { sender: "billing@example.test" },
        origin: "learned",
        createdAt: "2026-10-02T08:00:00.000Z",
      },
    ],
    people: [
      {
        name: "Anna",
        addresses: ["anna@example.test"],
        relation: "manager",
        weight: 3,
        origin: "explicit",
      },
    ],
    ...rest,
  });
}

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => undefined);
function control(name: string): HTMLElement {
  const found = [...document.body.querySelectorAll("button, a, [role='switch']")].find(
    (element) =>
      element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`Missing control: ${name}`);
  return found as HTMLElement;
}
function menuItem(name: string): HTMLElement {
  const found = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent === name,
  );
  if (!found) throw new Error(`Missing menu item: ${name}`);
  return found as HTMLElement;
}
const click = (element: HTMLElement) => act(async () => element.click());
const line = () => container.querySelector('[data-testid="radar-status-line"]')?.textContent;

async function render(onOpenIntegrations = vi.fn()) {
  await act(async () => root.render(<RadarPanel onOpenIntegrations={onOpenIntegrations} />));
  await flush();
  return onOpenIntegrations;
}

async function changeTime(label: string, value: string) {
  const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetRadarStatusForTests();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Radar panel", () => {
  it("says what Radar is doing and pauses it until resumed", async () => {
    const reconnected = status({
      sources: [status().sources[0]!],
    });
    api.status.mockResolvedValue(reconnected);
    api.configure
      .mockResolvedValueOnce(
        status({
          sources: [status().sources[0]!],
          settings: { pausedUntil: RADAR_PAUSED_UNTIL_RESUMED },
        }),
      )
      .mockResolvedValueOnce(reconnected);
    await render();
    expect(line()).toBe("Watching · next check 12:10");

    await click(control("Pause"));
    expect(
      [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ).toEqual(["1 hour", "Until tomorrow 08:00", "Until resumed"]);
    await click(menuItem("Until resumed"));
    expect(api.configure).toHaveBeenCalledWith({ pausedUntil: RADAR_PAUSED_UNTIL_RESUMED });
    expect(line()).toBe("Paused");

    await click(control("Resume"));
    expect(api.configure).toHaveBeenLastCalledWith({ pausedUntil: null });
    expect(line()).toBe("Watching · next check 12:10");
  });

  it("shows a timed pause and turns Radar off", async () => {
    api.status.mockResolvedValue(status({ settings: { pausedUntil: "2026-10-04T23:00:00.000Z" } }));
    api.configure.mockResolvedValue(status({ settings: { enabled: false } }));
    await render();
    expect(line()).toBe("Paused until Mon 08:00");
    await click(control("Radar"));
    expect(api.configure).toHaveBeenCalledWith({ enabled: false });
    expect(line()).toBe("Off");
    expect(() => control("Pause")).toThrow();
  });

  it("lists sources with switches, sends reconnects to integrations and folds other apps", async () => {
    api.status.mockResolvedValue(status());
    api.source.mockResolvedValue(
      status({
        sources: status().sources.map((source) =>
          source.connectionId === "connection-mail" ? { ...source, enabled: false } : source,
        ),
      }),
    );
    const onOpenIntegrations = await render();
    expect(line()).toBe("Needs reconnect");
    const sources = [...container.querySelectorAll('[data-testid="radar-source"]')];
    expect(sources.map((source) => source.textContent)).toEqual([
      "Gmailowner@example.test",
      "Google Calendarowner@example.testNeeds reconnectReconnect",
    ]);
    const other = container.querySelector("details")!;
    expect(other.textContent).toBe("Other appsNotion");

    await click(control("Reconnect"));
    expect(onOpenIntegrations).toHaveBeenCalledOnce();

    const mail = control("Gmail · owner@example.test");
    expect(mail.getAttribute("aria-checked")).toBe("true");
    await click(mail);
    expect(api.source).toHaveBeenCalledWith({ connectionId: "connection-mail", enabled: false });
    expect(control("Gmail · owner@example.test").getAttribute("aria-checked")).toBe("false");
  });

  it("saves the level, quiet hours, briefs and meeting prep as they change", async () => {
    api.status.mockResolvedValue(status());
    api.configure.mockImplementation(async (patch) => status({ settings: patch }));
    api.brief.mockResolvedValue(status());
    await render();

    await click(control("More"));
    expect(api.configure).toHaveBeenLastCalledWith({ level: "more" });
    expect(control("More").getAttribute("aria-pressed")).toBe("true");

    await changeTime("Quiet hours start", "23:30");
    expect(api.configure).toHaveBeenLastCalledWith({ quietHours: { start: "23:30" } });

    await click(control("Evening brief"));
    expect(api.configure).toHaveBeenLastCalledWith({ eveningBrief: { enabled: true } });

    await click(control("Meeting prep"));
    expect(api.configure).toHaveBeenLastCalledWith({ meetingPrep: false });

    await click(control("Send a brief now"));
    expect(api.brief).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("On its way");
  });

  it("shows what Radar has learned and removes a rule", async () => {
    api.status.mockResolvedValue(status());
    api.rule.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain("Leads a small design studio.");
    expect(container.querySelector('ul[aria-label="People"]')?.textContent).toBe("Anna · manager");
    const rule = container.querySelector('[data-testid="radar-rule"]')!;
    expect(rule.textContent).toBe("Brief only: billing@example.testLearned");
    await click(control("Remove rule"));
    expect(api.rule).toHaveBeenCalledWith({ removeId: "rule-invoices" });
    expect(container.querySelector('[data-testid="radar-rule"]')).toBeNull();
  });

  it("forgets a person by address, or by name when there is no address", async () => {
    api.status.mockResolvedValue(
      status({
        people: [
          {
            name: "Anna",
            addresses: ["anna@example.test", "anna@work.example.test"],
            relation: "manager",
            weight: 3,
            origin: "explicit",
          },
          { name: "Dr. Lee", addresses: [], relation: "", weight: 1, origin: "learned" },
        ],
      }),
    );
    api.person
      .mockResolvedValueOnce([
        { name: "Dr. Lee", addresses: [], relation: "", weight: 1, origin: "learned" },
      ])
      .mockResolvedValueOnce([]);
    await render();
    const people = () =>
      [...container.querySelectorAll('[data-testid="radar-person"]')].map(
        (item) => item.textContent,
      );
    expect(people()).toEqual(["Anna · manager", "Dr. Lee"]);

    await click(control("Remove Anna"));
    expect(api.person).toHaveBeenLastCalledWith({ address: "anna@example.test" });
    expect(people()).toEqual(["Dr. Lee"]);

    await click(control("Remove Dr. Lee"));
    expect(api.person).toHaveBeenLastCalledWith({ name: "Dr. Lee" });
    expect(container.querySelector('ul[aria-label="People"]')).toBeNull();
  });

  it("keeps the person and says so when forgetting fails", async () => {
    api.status.mockResolvedValue(status());
    api.person.mockRejectedValue(new Error("Could not reach the server"));
    await render();
    await click(control("Remove Anna"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not reach the server",
    );
    expect(container.querySelector('ul[aria-label="People"]')?.textContent).toBe("Anna · manager");
  });

  it("lists skipped updates with the reason and takes back a wrong call", async () => {
    api.status.mockResolvedValue(status());
    const skipped = RadarUpdateSchema.parse({
      id: "skipped-1",
      source: "gmail",
      kind: "email",
      title: "Newsletter from the gym",
      account: "owner@example.test",
      actor: { name: "The gym" },
      occurredAt: "2026-10-04T01:00:00.000Z",
      excerpt: "Classes this week",
      reason: "Bulk mail from a sender you never reply to.",
      state: "open",
      disposition: "silent",
    });
    api.updates.mockResolvedValue({ items: [skipped] });
    api.feedback.mockResolvedValue({ ...skipped, feedback: "important" });
    await render();
    await click(control("5Skipped"));
    await flush();
    expect(api.updates).toHaveBeenCalledWith({ view: "skipped", limit: 30 }, expect.anything());
    const row = container.querySelector('[data-testid="radar-skipped-row"]')!;
    expect(row.textContent).toContain("Newsletter from the gym");
    expect(row.textContent).toContain("Bulk mail from a sender you never reply to.");
    expect(row.textContent).toContain("owner@example.test · The gym · 2h ago");

    await click(control("This was important"));
    expect(api.feedback).toHaveBeenCalledWith({ id: "skipped-1", kind: "important" });
    expect(row.textContent).toContain("Marked important");

    await click(control("Back"));
    expect(line()).toBe("Needs reconnect");
  });
});
