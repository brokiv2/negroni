import type { UiExpression } from "./response-ui.js";
import { ResponseUiBlock } from "./response-ui.js";

// Fictional conformance data shared by native validation and rendering previews.
const share = (people: UiExpression): UiExpression => ({
  $calc: {
    op: "divide",
    args: [
      {
        $calc: {
          op: "multiply",
          args: [
            { $state: "/bill" },
            {
              $calc: {
                op: "add",
                args: [1, { $calc: { op: "divide", args: [{ $state: "/tip" }, 100] } }],
              },
            },
          ],
        },
      },
      people,
    ],
  },
});
export const RESPONSE_UI_FIXTURE = ResponseUiBlock.parse({
  kind: "response_ui",
  id: "demo",
  summary: "Dinner budget",
  complete: true,
  spec: {
    root: "root",
    summary: "Dinner budget",
    state: {
      bill: 120,
      tip: 10,
      people: 3,
      checked: false,
      tab: 0,
      currency: "EUR",
      note: "",
      expanded: false,
    },
    elements: {
      root: {
        type: "Stack",
        props: {},
        children: [
          "intro",
          "calculator",
          "tabs",
          "select",
          "note",
          "link",
          "progress",
          "reset",
          "set",
          "followup",
        ],
      },
      select: {
        type: "Select",
        props: {
          label: "Currency",
          bind: "/currency",
          options: [
            { label: "Euro", value: "EUR" },
            { label: "Dollar", value: "USD" },
          ],
        },
        children: [],
      },
      note: { type: "Input", props: { label: "Note", bind: "/note" }, children: [] },
      link: {
        type: "Link",
        props: { label: "Example venue", url: "https://example.test/venue" },
        children: [],
      },
      progress: { type: "Progress", props: { label: "Planning", value: 50 }, children: [] },
      reset: { type: "Button", props: { label: "Reset", action: { type: "reset" } }, children: [] },
      set: {
        type: "Button",
        props: { label: "Four people", action: { type: "set", path: "/people", value: 4 } },
        children: [],
      },
      intro: {
        type: "Text",
        props: { text: "Adjust the bill, tip and group size to compare the cost per person." },
        children: [],
      },
      calculator: {
        type: "Card",
        props: { title: "Dinner budget" },
        children: ["inputs", "tip", "result", "checklist"],
      },
      inputs: { type: "Grid", props: { columns: 2 }, children: ["bill", "people"] },
      bill: {
        type: "Input",
        props: { label: "Bill", input: "number", bind: "/bill", min: 0, max: 10000 },
        children: [],
      },
      people: {
        type: "Input",
        props: { label: "People", input: "number", bind: "/people", min: 1, max: 50, step: 1 },
        children: [],
      },
      tip: {
        type: "Slider",
        props: { label: "Tip %", bind: "/tip", min: 0, max: 30, step: 1 },
        children: [],
      },
      result: {
        type: "Metric",
        props: { label: "Per person", value: share({ $state: "/people" }), unit: "€", decimals: 2 },
        children: [],
      },
      checklist: {
        type: "Checklist",
        props: { items: [{ label: "Budget reviewed", bind: "/checked" }] },
        children: [],
      },
      tabs: {
        type: "Tabs",
        props: { labels: ["Compare", "Plan"], bind: "/tab" },
        children: ["comparison", "plan"],
      },
      comparison: { type: "Stack", props: {}, children: ["chart", "table"] },
      chart: {
        type: "Chart",
        props: {
          title: "Cost by group size",
          style: "line",
          xLabel: "People",
          yLabel: "Cost per person (€)",
          series: [
            { label: "Including tip", points: [1, 2, 3, 4, 5, 6].map((x) => ({ x, y: share(x) })) },
          ],
        },
        children: [],
      },
      table: {
        type: "Table",
        props: { columns: ["People", "Per person (€)"], rows: [2, 3, 4].map((n) => [n, share(n)]) },
        children: [],
      },
      plan: { type: "Stack", props: {}, children: ["diagram", "timeline", "disclosure"] },
      diagram: {
        type: "Diagram",
        props: {
          title: "Next steps",
          nodes: [
            { id: "review", label: "Review the budget" },
            { id: "book", label: "Choose a restaurant" },
            { id: "confirm", label: "Confirm with the group" },
          ],
          edges: [
            { from: "review", to: "book" },
            { from: "book", to: "confirm" },
          ],
        },
        children: [],
      },
      timeline: {
        type: "Timeline",
        props: {
          items: [
            { label: "Estimate the total", status: "done" },
            { label: "Agree the budget", status: "active" },
            { label: "Book a table", status: "pending" },
          ],
        },
        children: [],
      },
      disclosure: {
        type: "Disclosure",
        props: { title: "Assumptions", bind: "/expanded" },
        children: ["assumption"],
      },
      assumption: {
        type: "Text",
        props: {
          text: "The estimate includes the selected tip and an equal split. Booking requires a separate confirmation.",
          style: "caption",
        },
        children: [],
      },
      followup: {
        type: "Button",
        props: {
          label: "Draft the next step",
          action: { type: "follow_up", prompt: "Help me choose a restaurant within this budget." },
        },
        children: [],
      },
    },
  },
});
