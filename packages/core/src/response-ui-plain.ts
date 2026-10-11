import type { ResponseUiBlock, UiExpression, UiProps } from "@rakazo/contracts";
import { parseUiSpec } from "@rakazo/contracts";
import { evaluateUiExpression, formatUiScalar } from "./response-ui.js";

/** Readable data fallback for clients without the declarative renderer. Never prints the DSL. */
export function responseUiPlainText(block: ResponseUiBlock): string {
  const spec = parseUiSpec(block.spec, !block.complete);
  if (!spec) return block.summary;
  const state = block.state ?? spec.state;
  const value = (expression: UiExpression) => {
    const result = evaluateUiExpression(expression, state);
    return formatUiScalar(result);
  };
  function render(id: string, depth = 0): string[] {
    const node = spec!.elements[id];
    if (
      !node ||
      depth > 20 ||
      (node.visible !== undefined && !evaluateUiExpression(node.visible, state))
    )
      return [];
    const children = () => node.children.flatMap((child) => render(child, depth + 1));
    switch (node.type) {
      case "Stack":
      case "Grid":
        return children();
      case "Card": {
        const p = node.props as UiProps<"Card">;
        return [
          ...(p.title ? [p.title] : []),
          ...(p.description ? [p.description] : []),
          ...children(),
        ];
      }
      case "Text":
        return [value((node.props as UiProps<"Text">).text)];
      case "Metric": {
        const p = node.props as UiProps<"Metric">;
        return [`${p.label}: ${value(p.value)}${p.unit ? ` ${p.unit}` : ""}`];
      }
      case "Link": {
        const p = node.props as UiProps<"Link">;
        return [`${p.label}: ${p.url}`];
      }
      case "Table": {
        const p = node.props as UiProps<"Table">;
        return [
          ...(p.caption ? [p.caption] : []),
          p.columns.join(" · "),
          ...p.rows.map((r) => r.map(value).join(" · ")),
        ];
      }
      case "Chart": {
        const p = node.props as UiProps<"Chart">;
        return [
          p.title,
          ...p.series.flatMap((s) => [
            s.label,
            ...s.points.map((point) => `${point.x}: ${value(point.y)}`),
          ]),
        ];
      }
      case "Diagram": {
        const p = node.props as UiProps<"Diagram">;
        const label = (id: string) => p.nodes.find((n) => n.id === id)?.label ?? id;
        return [
          ...(p.title ? [p.title] : []),
          ...p.nodes.map((n) => `${n.label}${n.detail ? `: ${n.detail}` : ""}`),
          ...p.edges.map(
            (e) => `${label(e.from)} → ${label(e.to)}${e.label ? `: ${e.label}` : ""}`,
          ),
        ];
      }
      case "Checklist":
        return (node.props as UiProps<"Checklist">).items.map(
          (i) => `${state[i.bind.slice(1)] ? "✓" : "☐"} ${i.label}`,
        );
      case "Input":
      case "Slider": {
        const p = node.props as UiProps<"Input">;
        return [`${p.label}: ${state[p.bind.slice(1)] ?? "—"}`];
      }
      case "Select": {
        const p = node.props as UiProps<"Select">;
        return [
          `${p.label}: ${p.options.find((o) => o.value === state[p.bind.slice(1)])?.label ?? "—"}`,
        ];
      }
      case "Disclosure":
        return [(node.props as UiProps<"Disclosure">).title, ...children()];
      case "Tabs": {
        const p = node.props as UiProps<"Tabs">;
        return node.children.flatMap((child, i) => [p.labels[i]!, ...render(child, depth + 1)]);
      }
      case "Progress": {
        const p = node.props as UiProps<"Progress">;
        return [`${p.label}: ${value(p.value)} / ${p.max}`];
      }
      case "Timeline":
        return (node.props as UiProps<"Timeline">).items.map(
          (i) => `${i.status === "done" ? "✓ " : ""}${i.label}${i.detail ? `: ${i.detail}` : ""}`,
        );
      case "Button":
        return []; // A fallback must never imply a functional control.
    }
  }
  return render(spec.root).join("\n").slice(0, 16_000) || block.summary;
}
