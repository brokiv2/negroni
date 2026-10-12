// @vitest-environment jsdom
import { ResponseUiBlock } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  save: vi.fn(),
  image: vi.fn(),
}));
vi.mock("../lib/rpc", () => ({
  selectedSpaceId: () => "sample-space",
  rpc: {
    feed: { list: api.list },
    threads: { get: api.get, send: api.send, responseUiState: api.save },
    artifacts: { get: api.image },
  },
}));
vi.mock("../lib/auth", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "sample-user" } } }) },
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));
vi.mock("@lingui/core/macro", () => ({ t: (parts: TemplateStringsArray) => parts.join("") }));
vi.mock("@rakazo/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("./radar/NeedsYou", () => ({ NeedsYou: () => null }));
vi.mock("./radar/RadarPanel", () => ({ RadarPanelDialog: () => null }));
vi.mock("./FeedSettings", () => ({ FeedSettings: () => null }));
vi.mock("./AskCard", () => ({ AskCard: () => null }));

import { PersonalWorkspace } from "./PersonalWorkspace";

it("keeps an interactive feed answer editable, saves values, and only sends its drafted reply after confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const block = ResponseUiBlock.parse({
    kind: "response_ui",
    id: "budget",
    summary: "Feed budget",
    complete: true,
    spec: {
      root: "root",
      summary: "Feed budget",
      state: { amount: 10 },
      elements: {
        root: { type: "Stack", props: {}, children: ["amount", "total", "image", "followup"] },
        amount: {
          type: "Input",
          props: { label: "Amount", input: "number", bind: "/amount" },
          children: [],
        },
        total: {
          type: "Metric",
          props: {
            label: "Total",
            value: { $calc: { op: "multiply", args: [{ $state: "/amount" }, 3] } },
          },
          children: [],
        },
        image: {
          type: "Image",
          props: { artifactId: "owned-image", alt: "Sample image" },
          children: [],
        },
        followup: {
          type: "Button",
          props: {
            label: "Draft next step",
            action: { type: "follow_up", prompt: "Use this budget" },
          },
          children: [],
        },
      },
    },
  });
  const snapshot = {
    messages: [{ id: "original-message", role: "assistant", blocks: [block] }],
    run: null,
  };
  api.list.mockResolvedValue([
    {
      id: "sample-post",
      kind: "article",
      title: "Sample post",
      summary: "Sample research",
      url: "https://example.test/post",
      createdAt: "2026-01-01",
    },
  ]);
  api.get.mockResolvedValue(snapshot);
  api.image.mockRejectedValue(new Error("Missing image"));
  api.save.mockImplementation(async ({ state, revision }) => ({
    ...block,
    state,
    revision: revision + 1,
  }));
  api.send.mockResolvedValue({});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PersonalWorkspace
          botId="sample-bot"
          botIds={[]}
          onClose={() => {}}
          onOpenChat={() => {}}
        />,
      ),
    );
    const post = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Sample post"),
    )!;
    await act(async () => post.click());
    expect(api.get).toHaveBeenCalledWith({ feedItemId: "sample-post" });
    expect(api.image).toHaveBeenCalledWith(
      { feedItemId: "sample-post", artifactId: "owned-image" },
      { context: { spaceId: "sample-space" } },
    );
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("output")?.textContent).toBe("60");
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Draft next step")!
        .click(),
    );
    expect(api.save).toHaveBeenCalledWith({
      messageId: "original-message",
      blockId: "budget",
      revision: 0,
      state: { amount: 20 },
    });
    expect(api.send).not.toHaveBeenCalled();
    const composer = container.querySelector(
      'textarea[aria-label="Ask about this post"]',
    ) as HTMLTextAreaElement;
    expect(composer.value).toBe("Use this budget");
    expect(document.activeElement).toBe(composer);
    expect(container.querySelector('[aria-label="Cancel reply"]')).not.toBeNull();
    await act(async () =>
      composer
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(api.send).toHaveBeenCalledWith({
      feedItemId: "sample-post",
      text: "Use this budget",
      replyToMessageId: "original-message",
      clientNonce: expect.any(String),
    });
    expect(composer.value).toBe("");
    expect(container.querySelector('[aria-label="Cancel reply"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
