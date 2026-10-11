// @vitest-environment jsdom
import { ResponseUiBlock } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpc } from "../lib/rpc";
import { ResponseUiMessage } from "./ResponseUiMessage";

vi.mock("@lingui/core/macro", () => ({ t: (parts: TemplateStringsArray) => parts.join("") }));
vi.mock("../lib/rpc", () => ({
  rpc: { threads: { responseUiState: vi.fn(), messages: vi.fn() } },
}));
const block = ResponseUiBlock.parse({
  kind: "response_ui",
  id: "demo",
  summary: "Budget",
  complete: true,
  spec: {
    root: "root",
    summary: "Budget",
    state: { amount: 2 },
    elements: {
      root: { type: "Stack", props: {}, children: ["amount", "total", "follow"] },
      amount: {
        type: "Input",
        props: { label: "Amount", input: "number", bind: "/amount", min: 0, max: 100 },
        children: [],
      },
      total: {
        type: "Metric",
        props: { label: "Total", value: { $state: "/amount" } },
        children: [],
      },
      follow: {
        type: "Button",
        props: { label: "Discuss", action: { type: "follow_up", prompt: "Discuss these values" } },
        children: [],
      },
    },
  },
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
async function edit(container: HTMLElement, value: string) {
  const input = container.querySelector('input[type="number"]') as HTMLInputElement;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
  return input;
}
describe("interactive response in a thread", () => {
  it.each([false, true])(
    "waits for state persistence before offering a follow-up (failure: %s)",
    async (failure) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      let resolve!: (value: ResponseUiBlock) => void;
      let reject!: (error: Error) => void;
      vi.mocked(rpc.threads.responseUiState).mockImplementation(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const onFollowUp = vi.fn();
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () =>
          root.render(
            <ResponseUiMessage
              messageId="reply"
              block={block}
              target={{ botId: "bot", threadKind: "personal" }}
              onFollowUp={onFollowUp}
            />,
          ),
        );
        await edit(container, "4");
        await act(async () =>
          Array.from(container.querySelectorAll("button"))
            .find((b) => b.textContent === "Discuss")!
            .click(),
        );
        expect(onFollowUp).not.toHaveBeenCalled();
        await act(async () => {
          if (failure) reject(new Error("offline"));
          else resolve({ ...block, revision: 1, state: { amount: 4 } });
        });
        if (failure) {
          expect(onFollowUp).not.toHaveBeenCalled();
          expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t save");
        } else expect(onFollowUp).toHaveBeenCalledExactlyOnceWith("Discuss these values");
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );
  it("saves values against the original message and preserves input identity across the server echo", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(rpc.threads.responseUiState).mockImplementation(async (input) => ({
      ...block,
      revision: input.revision + 1,
      state: input.state,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <ResponseUiMessage
            messageId="reply"
            block={block}
            target={{ botId: "bot", threadKind: "personal" }}
            onFollowUp={vi.fn()}
          />,
        ),
      );
      const input = await edit(container, "4");
      expect(rpc.threads.responseUiState).toHaveBeenCalledExactlyOnceWith({
        messageId: "reply",
        blockId: "demo",
        revision: 0,
        state: { amount: 4 },
      });
      await act(async () =>
        root.render(
          <ResponseUiMessage
            messageId="reply"
            block={{ ...block, revision: 1, state: { amount: 4 } }}
            target={{ botId: "bot", threadKind: "personal" }}
            onFollowUp={vi.fn()}
          />,
        ),
      );
      expect(container.querySelector('input[type="number"]')).toBe(input);
      expect(input.value).toBe("4");
      expect(container.querySelector("output")?.textContent).toBe("4");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it("keeps a conflicting local edit visible and reloads the exact Personal thread on request", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(rpc.threads.responseUiState).mockRejectedValue({ code: "CONFLICT" });
    vi.mocked(rpc.threads.messages).mockResolvedValue({
      threadId: "thread",
      olderCursor: null,
      messages: [
        {
          id: "reply",
          threadId: "thread",
          seq: 0,
          role: "bot",
          createdAt: "2026-10-01T10:00:00Z",
          blocks: [{ ...block, revision: 1, state: { amount: 9 } }],
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <ResponseUiMessage
            messageId="reply"
            block={block}
            target={{ botId: "bot", threadKind: "personal" }}
            onFollowUp={vi.fn()}
          />,
        ),
      );
      await edit(container, "4");
      expect(container.querySelector('input[type="number"]')?.getAttribute("value")).toBe("4");
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Your edits are unsaved",
      );
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent === "Refresh values")!
          .click(),
      );
      expect(rpc.threads.messages).toHaveBeenCalledWith({
        botId: "bot",
        threadKind: "personal",
        around: { messageId: "reply" },
      });
      expect(container.querySelector('input[type="number"]')?.getAttribute("value")).toBe("9");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(rpc.threads.responseUiState).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
