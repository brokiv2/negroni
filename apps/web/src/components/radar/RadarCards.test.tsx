// @vitest-environment jsdom
import type { MessageBlock, RadarStatus } from "@rakazo/contracts";
import {
  MessageBlock as MessageBlockSchema,
  RadarGate,
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
  update: vi.fn(),
  feedback: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: {
    radar: { status: api.status, update: api.update, feedback: api.feedback },
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
vi.mock("@rakazo/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

import { RadarBriefCard, RadarUpdateCard } from "./RadarCards";
import { RadarDecision } from "./RadarDecision";
import { resetRadarStatusForTests } from "./radar-state";

type UpdateBlock = Extract<MessageBlock, { kind: "update" }>;
type BriefBlock = Extract<MessageBlock, { kind: "brief" }>;

const NOW = new Date("2026-10-04T03:00:00Z"); // 12:00 in Tokyo

function status(): RadarStatus {
  return RadarStatusSchema.parse({
    settings: { enabled: true, timeZone: "Asia/Tokyo" },
    sources: [
      {
        connectionId: "connection-mail",
        source: "gmail",
        label: "Gmail",
        account: "owner@example.test",
        enabled: true,
        supported: true,
        state: "ok",
        seenToday: 3,
      },
    ],
    today: { seen: 3, interrupted: 1, briefed: 1, skipped: 1, deferred: 0 },
    rules: [
      {
        id: "rule-anna",
        kind: "always",
        match: { sender: "anna@example.test" },
        origin: "explicit",
        createdAt: "2026-10-01T08:00:00.000Z",
      },
    ],
    people: [],
  });
}

function update(overrides: Partial<UpdateBlock> = {}): UpdateBlock {
  return MessageBlockSchema.parse({
    kind: "update",
    summary: "Anna asks to move the review",
    updateId: "update-anna",
    source: "gmail",
    account: "owner@example.test",
    title: "Anna asks to move the review to Thursday",
    actor: { name: "Anna", address: "anna@example.test" },
    why: "She needs an answer before 18:00 to book the room.",
    offer: "Draft a reply proposing 11:00?",
    evidence: "Could we move the review to Thursday? I need to book the room by 6pm.",
    urgency: "today",
    action: "reply",
    occurredAt: "2026-10-04T02:50:00.000Z",
    ...overrides,
  }) as UpdateBlock;
}

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

const buttons = () => [...document.body.querySelectorAll("button, a")] as HTMLElement[];
function control(name: string): HTMLElement {
  const found = buttons().find(
    (element) =>
      element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`Missing control: ${name}`);
  return found;
}
function menuItem(name: string): HTMLElement {
  const found = [...document.body.querySelectorAll('[role="menuitem"]')].find((element) =>
    element.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`Missing menu item: ${name}`);
  return found as HTMLElement;
}
const click = (element: HTMLElement) => act(async () => element.click());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetRadarStatusForTests();
  api.status.mockResolvedValue(status());
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

describe("Radar update card", () => {
  it("shows where it came from, keeps the quote folded and hands the offer to the personal chat", async () => {
    const onSent = vi.fn();
    api.send
      .mockRejectedValueOnce(new Error("Could not reach the server"))
      .mockResolvedValue({ runId: "run-1" });
    await render(<RadarUpdateCard block={update()} botId="bot-main" onSent={onSent} />);

    const card = container.querySelector('[data-testid="radar-update"]')!;
    expect(card.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Gmail");
    expect(card.textContent).toContain("owner@example.test · Anna · 10m ago");
    expect(card.textContent).toContain("Anna asks to move the review to Thursday");
    expect(card.textContent).toContain("She needs an answer before 18:00");
    expect(card.textContent).not.toContain("book the room by 6pm");

    await click(control("Show quote"));
    expect(card.textContent).toContain("book the room by 6pm");
    expect(control("Hide quote").getAttribute("aria-expanded")).toBe("true");

    await click(control("Draft a reply proposing 11:00?"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not reach the server",
    );
    await click(control("Draft a reply proposing 11:00?"));
    expect(api.send).toHaveBeenCalledTimes(2);
    const [first, second] = api.send.mock.calls.map(([input]) => input);
    expect(second).toEqual({
      botId: "bot-main",
      threadKind: "personal",
      text: "Draft a reply proposing 11:00?",
      radarUpdateId: "update-anna",
      clientNonce: first.clientNonce,
    });
    expect(container.querySelector('[data-testid="radar-resolved"]')?.textContent).toBe("On it");
    expect(onSent).toHaveBeenCalledOnce();
  });

  it("names the account the update carries, not one guessed from the watched sources", async () => {
    await render(
      <>
        <RadarUpdateCard
          block={update({ updateId: "update-other", account: "other@example.test" })}
          botId="bot-main"
        />
        <RadarUpdateCard
          block={update({ updateId: "update-bare", account: undefined })}
          botId="bot-main"
        />
      </>,
    );
    const [other, bare] = [...container.querySelectorAll('[data-testid="radar-update"]')];
    expect(other!.textContent).toContain("other@example.test · Anna · 10m ago");
    expect(other!.textContent).not.toContain("owner@example.test");
    expect(bare!.textContent).toContain("Anna · 10m ago");
    expect(bare!.textContent).not.toContain("owner@example.test");
  });

  it("brings an update back this evening in the Radar time zone", async () => {
    api.feedback.mockResolvedValue({});
    await render(<RadarUpdateCard block={update()} botId="bot-main" />);
    await click(control("Later"));
    expect(menuItem("In 1 hour").textContent).toBe("In 1 hour13:00");
    expect(menuItem("Tomorrow morning").textContent).toBe("Tomorrow morning08:30");
    await click(menuItem("This evening"));
    expect(api.feedback).toHaveBeenCalledWith({
      id: "update-anna",
      kind: "snooze",
      until: "2026-10-04T10:00:00.000Z",
    });
    expect(container.querySelector('[data-testid="radar-resolved"]')?.textContent).toBe(
      "Later · 19:00",
    );
  });

  it("works out the snooze times when the menu opens, not when the card was shown", async () => {
    await render(<RadarUpdateCard block={update()} botId="bot-main" />);
    vi.setSystemTime(new Date("2026-10-04T09:30:00Z")); // 18:30 in Tokyo
    await click(control("Later"));
    expect(
      [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ).toEqual(["In 1 hour19:30", "Tomorrow morning08:30"]);
  });

  it("teaches Radar about the sender from the overflow menu", async () => {
    api.feedback.mockResolvedValue({});
    await render(<RadarUpdateCard block={update()} botId="bot-main" />);
    await click(control("More actions"));
    await click(menuItem("Never about this"));
    expect(api.feedback).toHaveBeenCalledWith({ id: "update-anna", kind: "mute_sender" });
    expect(container.querySelector('[data-testid="radar-resolved"]')?.textContent).toBe(
      "Never about this",
    );
  });

  it("falls back by action and leaves out sender choices when there is no sender", async () => {
    await render(
      <>
        <RadarUpdateCard
          block={update({
            updateId: "update-invoice",
            offer: undefined,
            actor: undefined,
            action: "decide",
          })}
          botId="bot-main"
        />
        <RadarUpdateCard
          block={update({
            updateId: "update-doc",
            offer: undefined,
            action: "review",
            url: "https://docs.example.test/d/1",
          })}
          botId="bot-main"
        />
      </>,
    );
    expect(control("Handle it").tagName).toBe("BUTTON");
    const open = control("Open");
    expect(open.tagName).toBe("A");
    expect(open.getAttribute("href")).toBe("https://docs.example.test/d/1");
    const [withoutSender] = [...container.querySelectorAll('[data-testid="radar-update"]')];
    const more = withoutSender!.querySelector('[aria-label="More actions"]') as HTMLElement;
    await click(more);
    expect(document.body.textContent).toContain("Why this");
    expect(document.body.textContent).not.toContain("Never about this");
  });

  it("explains the decision from the stored trace and evidence", async () => {
    api.update.mockResolvedValue({
      id: "update-anna",
      source: "gmail",
      kind: "email",
      title: "Anna asks to move the review to Thursday",
      occurredAt: "2026-10-04T02:50:00.000Z",
      excerpt: "Could we move the review to Thursday?",
      evidence: "I need to book the room by 6pm.",
      state: "open",
      disposition: "interrupt",
      trace: {
        importance: 82,
        thresholds: { interrupt: 70, brief: 45 },
        thresholdOffset: -3,
        costOfDelay: "high",
        whoMustAct: "owner",
        confidence: 0.91,
        scores: {
          addressed: 3,
          actionRequired: 3,
          timePressure: 2,
          stakes: 1,
          relationship: 2,
          novelty: 3,
          linkage: 1,
          seen: 3,
        },
        rules: ["rule-anna", "rule-removed"],
        gates: ["quiet_hours", "unknown_gate"],
        result: "interrupt",
      },
    });
    await render(<RadarUpdateCard block={update()} botId="bot-main" />);
    await click(control("More actions"));
    await click(menuItem("Why this"));
    // A read of the stored decision, not feedback: nothing was opened.
    expect(api.update).toHaveBeenCalledWith({ id: "update-anna" });
    expect(api.feedback).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    const sentences = [...dialog.querySelectorAll("li")].map((item) => item.textContent);
    expect(sentences).toEqual([
      "Told you right away.",
      "Importance 82 of 100.",
      "I interrupt from 70 and brief from 45.",
      "Your feedback moved the bar by -3.",
      "Waiting until your next brief would cost you.",
      "You need to act.",
      "Counted for it: who it's addressed to, action needed, deadline, who it's from, how new it is, and whether you've seen it.",
      "Counted against it: stakes and your current work.",
      "Confidence 91%.",
      "Always tell me: anna@example.test",
      "It came in during quiet hours.",
    ]);
    expect(dialog.querySelector("blockquote")?.textContent).toBe(
      "“I need to book the room by 6pm.”",
    );
  });
});

describe("Radar decision gates", () => {
  const decision = (gates: string[]) =>
    RadarUpdateSchema.parse({
      id: "update-gates",
      source: "gmail",
      kind: "email",
      title: "Anything",
      occurredAt: "2026-10-04T02:50:00.000Z",
      excerpt: "",
      state: "open",
      trace: { gates },
    });
  const sentencesFor = async (gates: string[]) => {
    await render(<RadarDecision update={decision(gates)} rules={[]} />);
    return [...container.querySelectorAll("li")].map((item) => item.textContent ?? "");
  };

  it("gives every gate in the contract its own plain sentence", async () => {
    const sentences = await sentencesFor([...RadarGate.options]);
    expect(sentences).toHaveLength(RadarGate.options.length);
    expect(new Set(sentences).size).toBe(RadarGate.options.length);
    for (const sentence of sentences) {
      expect(sentence).toMatch(/^[A-Z].*[.]$/);
      expect(sentence).not.toMatch(/_/);
    }
  });

  it("says nothing for a gate it does not know and mentions a repeated gate once", async () => {
    expect(await sentencesFor(["from_a_newer_server", "paused", "paused", "Quiet Hours"])).toEqual([
      "Radar was paused.",
    ]);
  });
});

describe("Radar brief card", () => {
  function brief(count: number): BriefBlock {
    return MessageBlockSchema.parse({
      kind: "brief",
      summary: "Morning brief",
      briefId: "brief-1",
      period: "morning",
      title: "Morning brief",
      items: Array.from({ length: count }, (_, index) => ({
        updateId: `brief-item-${index + 1}`,
        title: `Item ${index + 1}`,
        why: index === 0 ? "Due today" : undefined,
        source: index === 0 ? "googlecalendar" : "gmail",
        action: index === 0 ? "reply" : undefined,
        // The second row names its sender and carries its own offer.
        ...(index === 1
          ? {
              offer: "Pay the invoice?",
              actor: { name: "Billing", address: "billing@example.test" },
            }
          : {}),
      })),
      agenda: [
        { title: "Design review", start: "2026-10-04T02:00:00.000Z" },
        { title: "Offsite", start: "2026-10-04T00:00:00.000Z", allDay: true },
      ],
    }) as BriefBlock;
  }

  it("shows the narrative, the agenda and seven items before folding the rest", async () => {
    api.feedback.mockResolvedValue({});
    await render(
      <RadarBriefCard
        block={brief(9)}
        narrative="A calm morning: one reply is due before lunch."
        botId="bot-main"
      />,
    );
    const card = container.querySelector('[data-testid="radar-brief"]')!;
    expect(card.textContent).toContain("A calm morning: one reply is due before lunch.");
    const agenda = card.querySelector('ul[aria-label="Your day"]')!;
    expect([...agenda.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "11:00Design review",
      "All dayOffsite",
    ]);
    expect(card.querySelectorAll('[data-testid="radar-brief-item"]')).toHaveLength(7);
    expect(control("Draft reply")).toBeTruthy();

    await click(control("2 more"));
    expect(card.querySelectorAll('[data-testid="radar-brief-item"]')).toHaveLength(9);

    const first = card.querySelector('[data-testid="radar-brief-item"]')!;
    const notImportant = [...first.querySelectorAll("button")].find(
      (button) => button.textContent === "Not important",
    )!;
    await click(notImportant);
    expect(api.feedback).toHaveBeenCalledWith({ id: "brief-item-1", kind: "not_important" });
    expect(first.textContent).toContain("Not important");
  });

  it("uses a row's own offer and teaches Radar about the sender the row names", async () => {
    api.feedback.mockResolvedValue({});
    await render(<RadarBriefCard block={brief(3)} narrative="" botId="bot-main" />);
    const rows = [...container.querySelectorAll('[data-testid="radar-brief-item"]')];
    expect(rows[1]!.textContent).toContain("Pay the invoice?");
    await click(rows[1]!.querySelector('[aria-label="More actions"]') as HTMLElement);
    expect(
      [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ).toEqual(["Never about this", "Always tell me", "Why this"]);
    await click(menuItem("Never about this"));
    expect(api.feedback).toHaveBeenCalledWith({ id: "brief-item-2", kind: "mute_sender" });
  });

  it("leaves out the sender choices on a row that names no sender", async () => {
    await render(<RadarBriefCard block={brief(3)} narrative="" botId="bot-main" />);
    const rows = [...container.querySelectorAll('[data-testid="radar-brief-item"]')];
    await click(rows[0]!.querySelector('[aria-label="More actions"]') as HTMLElement);
    expect(
      [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ).toEqual(["Why this"]);
  });
});
