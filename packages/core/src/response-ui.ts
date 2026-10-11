import { createSpecStreamCompiler } from "@json-render/core";
import type { ResponseUiBlock, UiExpression, UiScalar, UiSpec } from "@rakazo/contracts";
import { boundedUiJson, parseUiSpec, RESPONSE_UI_MAX_BYTES } from "@rakazo/contracts";

export function formatUiScalar(value: UiScalar, decimals?: number): string {
  if (value === null) return "—";
  if (typeof value !== "number") return String(value);
  return value.toLocaleString(
    undefined,
    decimals === undefined
      ? { maximumSignificantDigits: 12 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  );
}

/** Portable, bounded arithmetic for calculators and conditional layouts. No eval or host calls. */
export function evaluateUiExpression(
  value: UiExpression,
  state: Record<string, UiScalar>,
  depth = 0,
): UiScalar {
  if (depth > 16) return null;
  if (value === null || typeof value !== "object") return value;
  if ("$state" in value) {
    const key = value.$state.slice(1);
    return Object.hasOwn(state, key) ? state[key]! : null;
  }
  const { op, args } = value.$calc;
  const values = args.map((v) => evaluateUiExpression(v, state, depth + 1));
  if (op === "equal") return values.length === 2 && values[0] === values[1];
  if (op === "not") return values.length === 1 ? !values[0] : null;
  if (op === "and") return values.every(Boolean);
  if (op === "or") return values.some(Boolean);
  if (!values.length || values.some((v) => typeof v !== "number")) return null;
  const numbers = values as number[];
  const a = numbers[0]!;
  const b = numbers[1]!;
  let result: number | boolean | null = null;
  switch (op) {
    case "add":
      result = numbers.reduce((sum, n) => sum + n, 0);
      break;
    case "multiply":
      result = numbers.reduce((product, n) => product * n, 1);
      break;
    case "subtract":
      result = numbers.length === 2 ? a - b : null;
      break;
    case "divide":
      result = numbers.length === 2 && b !== 0 ? a / b : null;
      break;
    case "power":
      result = numbers.length === 2 && Math.abs(b) <= 100 ? a ** b : null;
      break;
    case "round":
      result = numbers.length === 1 ? Math.round(a) : null;
      break;
    case "min":
      result = Math.min(...numbers);
      break;
    case "max":
      result = Math.max(...numbers);
      break;
    case "clamp":
      result = numbers.length === 3 ? Math.max(b, Math.min(numbers[2]!, a)) : null;
      break;
    case "greater":
      result = numbers.length === 2 ? a > b : null;
      break;
    case "less":
      result = numbers.length === 2 ? a < b : null;
      break;
  }
  return typeof result === "number" && !Number.isFinite(result) ? null : result;
}

export type ResponseUiStreamEvent =
  | { type: "text"; text: string }
  | { type: "ui"; block: ResponseUiBlock };
const FENCE = "```negroni-ui";
const PATCH_PATH =
  /^\/(?:root|summary|state(?:\/[A-Za-z][A-Za-z0-9_-]{0,63})?|elements(?:\/[A-Za-z][A-Za-z0-9_-]{0,63})?)$/;

/**
 * Plain prose streams immediately. Only an explicit fence enters the JSON compiler.
 * Each complete component can render before the following components are generated.
 */
export function createResponseUiStream() {
  let atLineStart = true;
  let prefix = "";
  let inUi = false;
  let line = "";
  let discardLine = false;
  let invalid = false;
  let bytes = 0;
  let patchCount = 0;
  let ordinal = 0;
  let compiler = createSpecStreamCompiler<UiSpec>();
  let emitted = false;
  let output: ResponseUiStreamEvent[] = [];
  let text = "";
  const flushText = () => {
    if (!text) return;
    output.push({ type: "text", text });
    text = "";
  };
  const publish = (complete: boolean) => {
    const spec = invalid ? null : parseUiSpec(compiler.getResult(), !complete);
    if (spec) {
      flushText();
      output.push({
        type: "ui",
        block: {
          kind: "response_ui",
          id: `ui_${ordinal}`,
          summary: spec.summary,
          spec,
          complete,
          revision: 0,
        },
      });
      emitted = true;
    } else if (complete) {
      const summary = compiler.getResult()?.summary;
      const fallback =
        typeof summary === "string" && summary.trim()
          ? summary.slice(0, 280)
          : "This interactive response could not be rendered.";
      // Replace a previously streamed composition instead of leaving its controls active.
      if (emitted) {
        const fallbackSpec: UiSpec = {
          root: "fallback",
          summary: fallback,
          state: {},
          elements: { fallback: { type: "Text", props: { text: fallback }, children: [] } },
        };
        output.push({
          type: "ui",
          block: {
            kind: "response_ui",
            id: `ui_${ordinal}`,
            summary: fallback,
            spec: fallbackSpec,
            complete: true,
            revision: 0,
          },
        });
      } else text += fallback;
    }
  };
  const processLine = () => {
    const current = line;
    line = "";
    if (current.trim() === "```" && !discardLine) {
      publish(true);
      inUi = false;
      atLineStart = true;
      return;
    }
    if (!invalid && !discardLine && current.trim()) {
      try {
        const patch: unknown = JSON.parse(current);
        if (!boundedUiJson(patch) || !patch || typeof patch !== "object")
          throw new Error("Invalid patch");
        const p = patch as { op?: unknown; path?: unknown; value?: unknown };
        if (
          !Object.keys(p).every((k) => ["op", "path", "value"].includes(k)) ||
          !["add", "replace", "remove"].includes(String(p.op)) ||
          typeof p.path !== "string" ||
          !PATCH_PATH.test(p.path) ||
          /\/(?:constructor|prototype)(?:\/|$)/.test(p.path) ||
          ++patchCount > 400
        )
          throw new Error("Unsupported patch");
        compiler.push(`${JSON.stringify(patch)}\n`);
        publish(false);
      } catch {
        invalid = true;
      }
    }
    discardLine = false;
  };
  const push = (chunk: string): ResponseUiStreamEvent[] => {
    output = [];
    text = "";
    for (const char of chunk) {
      if (inUi) {
        const point = char.codePointAt(0)!;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        if (bytes > RESPONSE_UI_MAX_BYTES) invalid = true;
        if (char === "\n") processLine();
        else if (!discardLine) {
          line += char;
          if (line.length > RESPONSE_UI_MAX_BYTES) {
            line = "";
            discardLine = true;
            invalid = true;
          }
        }
      } else if (atLineStart) {
        prefix += char;
        if (prefix === `${FENCE}\n` || prefix === `${FENCE}\r\n`) {
          flushText();
          inUi = true;
          prefix = "";
          bytes = 0;
          patchCount = 0;
          invalid = false;
          emitted = false;
          ordinal += 1;
          compiler = createSpecStreamCompiler<UiSpec>();
        } else if (!`${FENCE}\n`.startsWith(prefix) && !`${FENCE}\r\n`.startsWith(prefix)) {
          text += prefix;
          atLineStart = char === "\n";
          prefix = "";
        }
      } else {
        text += char;
        if (char === "\n") atLineStart = true;
      }
    }
    flushText();
    return output;
  };
  const finish = (): ResponseUiStreamEvent[] => {
    output = [];
    text = prefix;
    prefix = "";
    if (inUi) {
      // An unterminated fence is incomplete and its controls remain disabled.
      if (line.trim()) processLine();
      if (inUi) {
        invalid = true;
        publish(true);
        inUi = false;
      }
    }
    flushText();
    return output;
  };
  return { push, finish };
}
