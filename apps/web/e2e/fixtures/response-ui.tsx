import type { UiExpression } from "@rakazo/contracts";
import { ResponseUiBlock } from "@rakazo/contracts";
import { createResponseUiStateSession } from "@rakazo/core";
import { ResponseUiView } from "@rakazo/ui-web";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

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
const initial = ResponseUiBlock.parse({
  kind: "response_ui",
  id: "demo",
  summary: "Dinner budget",
  complete: true,
  spec: {
    root: "root",
    summary: "Dinner budget",
    state: { bill: 120, tip: 10, people: 3, checked: false, tab: 0 },
    elements: {
      root: { type: "Stack", props: {}, children: ["intro", "calculator", "tabs", "followup"] },
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
      disclosure: { type: "Disclosure", props: { title: "Assumptions" }, children: ["assumption"] },
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
const storageKey = "response-ui-demo";
function storedBlock() {
  try {
    return ResponseUiBlock.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return initial;
  }
}
function Fixture() {
  const [block, setBlock] = useState(storedBlock);
  const [draft, setDraft] = useState("");
  const [session] = useState(() =>
    createResponseUiStateSession(block, async ({ revision, state }) => {
      const next = ResponseUiBlock.parse({ ...initial, revision: revision + 1, state });
      localStorage.setItem(storageKey, JSON.stringify(next));
      setBlock(next);
      return next;
    }),
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    session.receive(block);
  }, [block, session]);
  useEffect(() => () => session.close(), [session]);
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <p className="text-xs text-muted-foreground">
        Interactive response fixture · sample data · local persistence
      </p>
      <ResponseUiView
        block={block}
        state={snapshot.state}
        onStateChange={session.change}
        onFollowUp={setDraft}
        dataLabel="View data"
      />
      <label className="flex flex-col gap-2 text-sm">
        Message
        <textarea
          aria-label="Message"
          className="rounded-lg border border-input bg-background p-3"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <output data-testid="saved-revision" className="sr-only">
        {block.revision}
      </output>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
