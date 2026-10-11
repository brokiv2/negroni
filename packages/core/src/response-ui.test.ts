import type { UiExpression, UiSpec } from "@rakazo/contracts";
import {
  MessageBlock,
  parseUiSpec,
  responseUiCatalogPrompt,
  validateUiState,
} from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { RESPONSE_UI_FIXTURE } from "../../contracts/src/response-ui.fixture.js";
import { createResponseUiStream, evaluateUiExpression } from "./response-ui.js";

const calculator: UiSpec = {
  root: "root",
  summary: "Split the bill and adjust the tip.",
  state: { bill: 120, tip: 10, people: 3, checked: false },
  elements: {
    root: {
      type: "Card",
      props: { title: "Dinner" },
      children: ["bill", "tip", "people", "result", "checklist"],
    },
    bill: {
      type: "Input",
      props: { label: "Bill", input: "number", bind: "/bill", min: 0, max: 10000 },
      children: [],
    },
    tip: {
      type: "Slider",
      props: { label: "Tip %", bind: "/tip", min: 0, max: 30, step: 1 },
      children: [],
    },
    people: {
      type: "Input",
      props: { label: "People", input: "number", bind: "/people", min: 1, max: 50 },
      children: [],
    },
    result: {
      type: "Metric",
      props: {
        label: "Per person",
        value: {
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
              { $state: "/people" },
            ],
          },
        },
        decimals: 2,
      },
      children: [],
    },
    checklist: {
      type: "Checklist",
      props: { items: [{ label: "Paid", bind: "/checked" }] },
      children: [],
    },
  },
};
const patch = (path: string, value: unknown) => `${JSON.stringify({ op: "add", path, value })}\n`;
function streamSpec(spec = calculator) {
  return (
    "```negroni-ui\n" +
    patch("/summary", spec.summary) +
    patch("/state", spec.state) +
    patch("/root", spec.root) +
    Object.entries(spec.elements)
      .map(([id, element]) => patch(`/elements/${id}`, element))
      .join("") +
    "```\n"
  );
}

describe("composed response contracts and arithmetic", () => {
  it("shares the vocabulary and evaluates a reactive calculator without executing code", () => {
    const spec = parseUiSpec(calculator)!;
    expect(spec).not.toBeNull();
    const expression = spec.elements.result!.props.value as UiExpression;
    expect(evaluateUiExpression(expression, spec.state)).toBeCloseTo(44);
    expect(evaluateUiExpression(expression, { ...spec.state, people: 6 })).toBeCloseTo(22);
    expect(responseUiCatalogPrompt()).toContain("Diagram:");
  });
  it("rejects new state paths, changed types and values outside the authored input range", () => {
    expect(validateUiState(calculator, { ...calculator.state, tip: 20, checked: true })).toBe(true);
    expect(validateUiState(calculator, { ...calculator.state, tip: "20" })).toBe(false);
    expect(validateUiState(calculator, { ...calculator.state, tip: 50 })).toBe(false);
    expect(validateUiState(calculator, { ...calculator.state, injected: "send" })).toBe(false);
  });
  it("validates actions after applying input defaults regardless of element order", () => {
    const reordered = {
      ...RESPONSE_UI_FIXTURE,
      spec: {
        ...RESPONSE_UI_FIXTURE.spec,
        elements: Object.fromEntries(
          Object.entries(RESPONSE_UI_FIXTURE.spec.elements).sort(([a], [b]) =>
            a === "set" ? -1 : b === "set" ? 1 : a.localeCompare(b),
          ),
        ),
      },
    };
    expect(MessageBlock.safeParse(reordered).success).toBe(true);
    expect(validateUiState(reordered.spec, { ...reordered.spec.state, note: "Sample" })).toBe(true);
    const invalid = structuredClone(reordered);
    invalid.spec.elements.set!.props.action = { type: "set", path: "/people", value: 0 };
    expect(MessageBlock.safeParse(invalid).success).toBe(false);
  });
  it("rejects unknown components, executable props, graph cycles and missing children", () => {
    expect(
      parseUiSpec({
        ...calculator,
        elements: { root: { type: "HTML", props: { html: "<script/>" }, children: [] } },
      }),
    ).toBeNull();
    expect(
      parseUiSpec({
        ...calculator,
        elements: {
          ...calculator.elements,
          root: { ...calculator.elements.root!, props: { html: "<script/>" } },
        },
      }),
    ).toBeNull();
    const cycle = {
      ...calculator,
      elements: { root: { type: "Card", props: {}, children: ["root"] } },
    };
    expect(parseUiSpec(cycle, true)).toBeNull();
    const incomplete = { ...calculator, elements: { root: calculator.elements.root } };
    expect(parseUiSpec(incomplete)).toBeNull();
    expect(parseUiSpec(incomplete, true)).not.toBeNull();
  });
  it("keeps undefined arithmetic and invalid numeric results bounded", () => {
    expect(evaluateUiExpression({ $calc: { op: "divide", args: [10, 0] } }, {})).toBeNull();
    expect(evaluateUiExpression({ $state: "/constructor" }, {})).toBeNull();
    expect(evaluateUiExpression({ $calc: { op: "power", args: [10, 10000] } }, {})).toBeNull();
    expect(
      parseUiSpec({
        ...calculator,
        elements: { root: { type: "Text", props: { text: { $state: "/missing" } }, children: [] } },
      }),
    ).toBeNull();
  });
});

describe("streamed response composition", () => {
  it("streams prose immediately and never treats an ordinary JSON example as UI", () => {
    const stream = createResponseUiStream();
    expect(stream.push("Hello")).toEqual([{ type: "text", text: "Hello" }]);
    expect(stream.push('\n```json\n{"op":"add","path":"/root","value":"x"}\n```\n')).toEqual([
      { type: "text", text: '\n```json\n{"op":"add","path":"/root","value":"x"}\n```\n' },
    ]);
  });
  it("renders complete components before the rest of the response and keeps prose around them", () => {
    const stream = createResponseUiStream();
    const events = [...stream.push(`Before\n${streamSpec()}After`), ...stream.finish()];
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe("Before\nAfter");
    const ui = events.filter((e) => e.type === "ui");
    expect(ui.length).toBeGreaterThan(1);
    expect(ui[0]!.block.complete).toBe(false);
    expect(ui.at(-1)!.block.complete).toBe(true);
    expect(ui.at(-1)!.block.spec.elements).toHaveProperty("result");
  });
  it("accepts every character boundary, including split fence and patch tokens", () => {
    const stream = createResponseUiStream();
    const events = [...streamSpec()].flatMap((c) => stream.push(c));
    events.push(...stream.finish());
    const final = events.filter((e) => e.type === "ui").at(-1)!;
    expect(final.block.complete).toBe(true);
    expect(final.block.spec.root).toBe("root");
    expect(events.filter((e) => e.type === "text")).toEqual([]);
  });
  it("rejects prototype paths and suppresses invalid JSON instead of exposing it", () => {
    const stream = createResponseUiStream();
    const events = stream.push(
      "```negroni-ui\n" +
        patch("/summary", "Use the saved result.") +
        patch("/elements/constructor", { polluted: true }) +
        "```\n",
    );
    expect(events).toEqual([{ type: "text", text: "Use the saved result." }]);
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });
  it("replaces incomplete interactive output with a safe fallback when the stream ends", () => {
    const stream = createResponseUiStream();
    const events = [...stream.push(streamSpec().slice(0, -4)), ...stream.finish()];
    const final = events.filter((e) => e.type === "ui").at(-1)!;
    expect(final.block.complete).toBe(true);
    expect(final.block.spec.elements).toHaveProperty("fallback");
    expect(final.block.spec.state).toEqual({});
  });
  it("replaces a previously valid partial composition if a later component is invalid", () => {
    const stream = createResponseUiStream();
    const body =
      streamSpec().slice(0, -4) +
      patch("/elements/root", { type: "Script", props: { code: "doSomething()" }, children: [] }) +
      "```\n";
    const events = stream.push(body);
    const final = events.filter((e) => e.type === "ui").at(-1)!;
    expect(final.block.spec.elements).toHaveProperty("fallback");
    expect(final.block.spec.state).toEqual({});
  });
});
