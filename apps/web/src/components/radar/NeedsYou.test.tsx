// @vitest-environment jsdom
import type { RadarStatus, RadarUpdate } from "@rakazo/contracts";
import { RadarStatusSchema, RadarUpdateSchema } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  configure: vi.fn(),
  check: vi.fn(),
  updates: vi.fn(),
  feedback: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: {
    radar: {
      status: api.status,
      configure: api.configure,
      check: api.check,
      updates: api.updates,
      feedback: api.feedback,
    },
    threads: { send: api.send },
  },
}));
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

import { NeedsYou } from "./NeedsYou";
import { resetRadarStatusForTests } from "./radar-state";

const NOW = new Date("2026-10-04T03:00:00Z"); // 12:00 in Tokyo

function status(overrides: Record<string, unknown> = {}): RadarStatus {
  return RadarStatusSchema.parse({
    settings: { enabled: true, timeZone: "Asia/Tokyo" },
    sources: [],
    today: { seen: 0, interrupted: 0, briefed: 0, skipped: 0, deferred: 0 },
    rules: [],
    people: [],
    ...overrides,
  });
}

function update(id: string, overrides: Record<string, unknown> = {}): RadarUpdate {
  return RadarUpdateSchema.parse({
    id,
    source: "gmail",
    kind: "email",
    title: `Title ${id}`,
    actor: { name: "Anna", address: "anna@example.test" },
    occurredAt: "2026-10-04T02:30:00.000Z",
    excerpt: "Excerpt",
    why: `Why ${id}`,
    state: "open",
    disposition: "interrupt",
    ...overrides,
  });
}

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => undefined);
function control(name: string, scope: ParentNode = document.body): HTMLElement {
  const found = [...scope.querySelectorAll("button, a")].find(
    (element) =>
      element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`Missing control: ${name}`);
  return found as HTMLElement;
}
const click = (element: HTMLElement) => act(async () => element.click());
const rows = () => [...container.querySelectorAll('[data-testid="radar-needs-you-row"]')];

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

describe("Needs you", () => {
  it("asks when to interrupt while Radar is off, then turns it on and takes a first look", async () => {
    const off = status({ settings: { enabled: false } });
    const on = status({ settings: { enabled: true, level: "urgent" } });
    api.status.mockResolvedValue(off);
    api.configure.mockResolvedValue(on);
    api.check.mockResolvedValue(on);
    api.updates.mockResolvedValue({ items: [] });
    await act(async () =>
      root.render(<NeedsYou botId="bot-main" revision={0} onOpenChat={vi.fn()} />),
    );
    await flush();
    expect(container.textContent).toContain("When should I interrupt you?");
    expect(api.updates).not.toHaveBeenCalled();

    await click(control("Only urgent"));
    await flush();
    expect(api.configure).toHaveBeenCalledWith({
      enabled: true,
      level: "urgent",
      timeZone: expect.any(String),
    });
    expect(api.check).toHaveBeenCalledOnce();
    expect(api.updates).toHaveBeenCalledWith({ view: "open", limit: 20 }, expect.anything());
    expect(container.textContent).not.toContain("When should I interrupt you?");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Taking a look around. I'll follow up shortly.",
    );
  });

  it("lists open updates with Done, Later and Not important and links the latest brief", async () => {
    const onOpenChat = vi.fn();
    api.status.mockResolvedValue(status({ lastBriefAt: "2026-10-03T23:30:00.000Z" }));
    api.updates.mockResolvedValue({ items: [update("first"), update("second")] });
    api.feedback.mockImplementation(async ({ id, kind }) => update(id, { state: kind }));
    await act(async () =>
      root.render(<NeedsYou botId="bot-main" revision={0} onOpenChat={onOpenChat} />),
    );
    await flush();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain("Title first");
    expect(rows()[0]!.textContent).toContain("Why first");
    for (const name of ["Done", "Later", "Not important"]) {
      expect(control(name, rows()[0]!)).toBeTruthy();
    }

    await click(control("Done", rows()[0]!));
    expect(api.feedback).toHaveBeenCalledWith({ id: "first", kind: "done" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("Title second");

    await click(control("Latest brief · 08:30"));
    expect(onOpenChat).toHaveBeenCalledWith({ botId: "bot-main" });
  });

  it("opens the details, explains the decision and replies in the personal chat", async () => {
    const onOpenChat = vi.fn();
    const item = update("detail", {
      url: "https://mail.example.test/thread/1",
      evidence: "Can you confirm by noon?",
      offer: "Draft a reply confirming?",
    });
    api.status.mockResolvedValue(status());
    api.updates.mockResolvedValue({ items: [item] });
    api.feedback.mockResolvedValue({
      ...item,
      trace: { importance: 76, result: "interrupt", whoMustAct: "owner" },
    });
    api.send.mockResolvedValue({ runId: "run-1" });
    await act(async () =>
      root.render(
        <NeedsYou botId="bot-main" assistantName="Negroni" revision={0} onOpenChat={onOpenChat} />,
      ),
    );
    await flush();
    await click(rows()[0]!.querySelector("button")!);
    await flush();
    expect(api.feedback).toHaveBeenCalledWith({ id: "detail", kind: "opened" });
    const dialog = document.body.querySelector('[data-testid="radar-needs-you-detail"]')!;
    expect(dialog.textContent).toContain("Title detail");
    expect(dialog.textContent).toContain("Why detail");
    expect(dialog.querySelector("blockquote")?.textContent).toBe("“Can you confirm by noon?”");
    expect(dialog.querySelector("details")?.textContent).toContain("Importance 76 of 100.");
    const open = control("Open in Gmail ↗", dialog);
    expect(open.getAttribute("href")).toBe("https://mail.example.test/thread/1");
    expect(control("Draft a reply confirming?", dialog)).toBeTruthy();

    const reply = dialog.querySelector("textarea")!;
    expect(reply.getAttribute("placeholder")).toBe("Tell Negroni…");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        reply,
        "Say yes, but ask for 12:30",
      );
      reply.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(control("Send", dialog));
    expect(api.send).toHaveBeenCalledWith({
      botId: "bot-main",
      threadKind: "personal",
      text: "Say yes, but ask for 12:30",
      radarUpdateId: "detail",
      clientNonce: expect.any(String),
    });
    expect(onOpenChat).toHaveBeenCalledWith({ botId: "bot-main" });
  });
});
