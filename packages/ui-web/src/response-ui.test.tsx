// @vitest-environment jsdom
import { ResponseUiBlock } from "@rakazo/contracts";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseUiView } from "./response-ui.js";

const block = ResponseUiBlock.parse({
  kind: "response_ui",
  id: "demo",
  summary: "Budget calculator",
  complete: true,
  spec: {
    root: "root",
    summary: "Budget calculator",
    state: { amount: 10, choice: "a", done: false },
    elements: {
      root: {
        type: "Card",
        props: { title: "Budget" },
        children: ["amount", "total", "choice", "done", "chart", "diagram", "action", "reset"],
      },
      amount: {
        type: "Input",
        props: { label: "Amount", input: "number", bind: "/amount", min: 0, max: 100 },
        children: [],
      },
      total: {
        type: "Metric",
        props: {
          label: "Total",
          value: { $calc: { op: "multiply", args: [{ $state: "/amount" }, 3] } },
          decimals: 2,
        },
        children: [],
      },
      choice: {
        type: "Select",
        props: {
          label: "Option",
          bind: "/choice",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        },
        children: [],
      },
      done: {
        type: "Checklist",
        props: { items: [{ label: "Reviewed", bind: "/done" }] },
        children: [],
      },
      chart: {
        type: "Chart",
        props: {
          title: "Estimate",
          style: "bar",
          series: [
            {
              label: "Budget",
              points: [
                { x: "Now", y: { $state: "/amount" } },
                { x: "Later", y: 40 },
              ],
            },
          ],
        },
        children: [],
      },
      diagram: {
        type: "Diagram",
        props: {
          title: "Flow",
          nodes: [
            { id: "start", label: "Review" },
            { id: "finish", label: "Approve" },
          ],
          edges: [{ from: "start", to: "finish" }],
        },
        children: [],
      },
      action: {
        type: "Button",
        props: { label: "Continue", action: { type: "follow_up", prompt: "Review this estimate" } },
        children: [],
      },
      reset: { type: "Button", props: { label: "Reset", action: { type: "reset" } }, children: [] },
    },
  },
});
afterEach(() => vi.unstubAllGlobals());
describe("declarative response rendering", () => {
  it("keeps an owned thumbnail beside prose without treating adjacent form controls as media", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:owned-preview"),
      revokeObjectURL: vi.fn(),
    });
    const mediaBlock = ResponseUiBlock.parse({
      ...block,
      spec: {
        ...block.spec,
        state: { ...block.spec.state, showPhoto: true },
        elements: {
          ...block.spec.elements,
          root: { type: "Stack", props: {}, children: ["intro", "media", "controls", "hide"] },
          intro: { type: "Text", props: { text: "Here is the workshop proposal." }, children: [] },
          media: {
            type: "Stack",
            props: { direction: "horizontal" },
            children: ["photo", "details"],
          },
          photo: {
            type: "Image",
            props: { artifactId: "owned-preview", alt: "Workshop preview", aspectRatio: 1 },
            visible: { $state: "/showPhoto" },
            children: [],
          },
          details: { type: "Stack", props: {}, children: ["title", "description"] },
          title: {
            type: "Text",
            props: { text: "Studio session", style: "heading" },
            children: [],
          },
          description: {
            type: "Text",
            props: { text: "A practical session with a small group and time for questions." },
            children: [],
          },
          controls: {
            type: "Stack",
            props: { direction: "horizontal" },
            children: ["amount", "total"],
          },
          hide: {
            type: "Button",
            props: {
              label: "Hide preview",
              action: { type: "set", path: "/showPhoto", value: false },
            },
            children: [],
          },
        },
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    const loadImage = vi.fn(async () => new Blob(["preview"], { type: "image/png" }));
    function Fixture() {
      const [state, change] = useState(mediaBlock.spec.state);
      return (
        <ResponseUiView
          block={mediaBlock}
          state={state}
          onStateChange={change}
          loadImage={loadImage}
          dataLabel="View data"
        />
      );
    }
    try {
      await act(async () => root.render(<Fixture />));
      const media = container.querySelector(".response-ui-media");
      expect(media?.firstElementChild?.querySelector("img")?.getAttribute("alt")).toBe(
        "Workshop preview",
      );
      expect(media?.lastElementChild?.querySelector("h3")?.textContent).toBe("Studio session");
      expect(media?.querySelector("input")).toBeNull();
      expect(container.querySelectorAll(".response-ui-horizontal")).toHaveLength(1);
      expect(container.textContent).toContain("Here is the workshop proposal.");
      expect(loadImage).toHaveBeenCalledExactlyOnceWith("owned-preview");
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector(".response-ui-media")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("Studio session");
      expect(container.querySelector('input[type="number"]')).not.toBeNull();
      expect(container.querySelector("output")?.textContent).toBe("30.00");
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("updates a financial metric and its two-column breakdown without losing long labels", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const label = "Workshop materials, room preparation, and accessibility arrangements";
    const financialBlock = ResponseUiBlock.parse({
      ...block,
      spec: {
        ...block.spec,
        elements: {
          ...block.spec.elements,
          root: {
            type: "Card",
            props: { title: "Workshop budget" },
            children: ["total", "breakdown", "amount"],
          },
          breakdown: {
            type: "Table",
            props: {
              columns: ["Category", "Estimate"],
              rows: [[label, { $calc: { op: "multiply", args: [{ $state: "/amount" }, 3] } }]],
            },
            children: [],
          },
        },
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    function Fixture() {
      const [state, change] = useState(financialBlock.spec.state);
      return (
        <ResponseUiView
          block={financialBlock}
          state={state}
          onStateChange={change}
          dataLabel="View data"
        />
      );
    }
    try {
      await act(async () => root.render(<Fixture />));
      const table = container.querySelector(".response-ui-breakdown table");
      expect(
        Array.from(table!.querySelectorAll('th[scope="col"]'), (cell) => cell.textContent),
      ).toEqual(["Category", "Estimate"]);
      const input = container.querySelector('input[type="number"]') as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "24",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.querySelector("output")?.textContent).toBe("72.00");
      expect(Array.from(table!.querySelectorAll("tbody td"), (cell) => cell.textContent)).toEqual([
        label,
        "72",
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("updates calculations and chart data without replacing the focused input, and only prefills follow-ups", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const followUp = vi.fn();
    function Fixture() {
      const [state, change] = useState(block.spec.state);
      return (
        <ResponseUiView
          block={block}
          state={state}
          onStateChange={change}
          onFollowUp={followUp}
          dataLabel="View data"
        />
      );
    }
    try {
      await act(async () => root.render(<Fixture />));
      const input = container.querySelector('input[type="number"]') as HTMLInputElement;
      input.focus();
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "20",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.querySelector("output")?.textContent).toBe("60.00");
      expect(container.querySelector('input[type="number"]')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(container.textContent).toContain("Budget: Now20");
      expect(container.querySelectorAll('svg[role="img"]')).toHaveLength(2);
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent === "Continue")!
          .click(),
      );
      expect(followUp).toHaveBeenCalledExactlyOnceWith("Review this estimate");
      await act(async () => {
        input.blur();
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent === "Reset")!
          .click();
      });
      expect(container.querySelector("output")?.textContent).toBe("30.00");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it("disables streaming controls and renders unsafe compositions as their summary", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const change = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ResponseUiView
            block={{ ...block, complete: false }}
            state={block.spec.state}
            onStateChange={change}
            dataLabel="View data"
          />,
        ),
      );
      expect(container.querySelector('input[type="number"]')?.hasAttribute("disabled")).toBe(true);
      expect(
        container.querySelector('[data-testid="response-ui"]')?.getAttribute("aria-busy"),
      ).toBe("true");
      const unsafe = {
        ...block,
        spec: {
          ...block.spec,
          elements: {
            root: {
              type: "Link",
              props: { label: "Unsafe", url: "javascript:alert(1)" },
              children: [],
            },
          },
        },
      };
      await act(async () =>
        root.render(
          <ResponseUiView
            block={unsafe as unknown as ResponseUiBlock}
            state={{}}
            onStateChange={change}
            dataLabel="View data"
          />,
        ),
      );
      expect(container.textContent).toBe(block.summary);
      expect(container.querySelector("a")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("loads only image blobs through the authorized loader and releases replaced images", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const create = vi.fn(() => "blob:owned-image");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const imageBlock = ResponseUiBlock.parse({
      ...block,
      spec: {
        ...block.spec,
        elements: {
          root: {
            type: "Image",
            props: {
              artifactId: "owned-image",
              alt: "Sample dinner",
              caption: "An attached image",
            },
            children: [],
          },
        },
      },
    });
    const load = vi.fn(async () => new Blob(["fixture"], { type: "image/png" }));
    const render = (loadImage?: (id: string) => Promise<Blob | null>) => (
      <ResponseUiView
        block={imageBlock}
        state={imageBlock.spec.state}
        onStateChange={vi.fn()}
        dataLabel="View data"
        loadImage={loadImage}
      />
    );
    try {
      await act(async () => root.render(render()));
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("Sample dinner");
      await act(async () => root.render(render(load)));
      expect(load).toHaveBeenCalledExactlyOnceWith("owned-image");
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:owned-image");
      expect(container.querySelector("img")?.getAttribute("alt")).toBe("Sample dinner");
      await act(async () =>
        root.render(render(async () => new Blob(["markup"], { type: "text/html" }))),
      );
      expect(container.querySelector("img")).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:owned-image");
      await act(async () =>
        root.render(
          render(async () => {
            throw new Error("Denied");
          }),
        ),
      );
      expect(container.textContent).toContain("Sample dinner");
      expect(container.textContent).toContain("An attached image");
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("does not retain a late image from a previous conversation and rejects oversized images", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const create = vi.fn(() => "blob:current-image");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const imageBlock = ResponseUiBlock.parse({
      ...block,
      spec: {
        ...block.spec,
        elements: {
          root: {
            type: "Image",
            props: { artifactId: "image", alt: "Sample image" },
            children: [],
          },
        },
      },
    });
    let receive: (blob: Blob) => void = () => {};
    const previous = () =>
      new Promise<Blob>((resolve) => {
        receive = resolve;
      });
    const current = async () => new Blob(["current"], { type: "image/png" });
    const render = (loadImage: (id: string) => Promise<Blob | null>) => (
      <ResponseUiView
        block={imageBlock}
        state={imageBlock.spec.state}
        onStateChange={vi.fn()}
        dataLabel="View data"
        loadImage={loadImage}
      />
    );
    try {
      await act(async () => root.render(render(previous)));
      await act(async () => root.render(render(current)));
      await act(async () => receive(new Blob(["previous"], { type: "image/png" })));
      expect(create).toHaveBeenCalledTimes(1);
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:current-image");
      await act(async () =>
        root.render(
          render(
            async () => new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: "image/png" }),
          ),
        ),
      );
      expect(create).toHaveBeenCalledTimes(1);
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("Sample image");
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:current-image");
      await act(async () => root.render(render(previous)));
      await act(async () => root.unmount());
      await act(async () => receive(new Blob(["after-unmount"], { type: "image/png" })));
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
