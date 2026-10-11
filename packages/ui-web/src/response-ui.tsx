import type { ResponseUiBlock, UiExpression, UiProps, UiScalar, UiSpec } from "@rakazo/contracts";
import { parseUiSpec, validateUiState } from "@rakazo/contracts";
import { evaluateUiExpression, formatUiScalar } from "@rakazo/core";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Checkbox } from "./components/ui/checkbox.js";
import { Input } from "./components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { cn } from "./lib/utils.js";

type State = Record<string, UiScalar>;
type Context = {
  spec: UiSpec;
  state: State;
  disabled: boolean;
  change: (state: State) => void;
  followUp?: (text: string) => void;
  dataLabel: string;
};
const GAPS = { small: "gap-2", medium: "gap-4", large: "gap-6" };
const COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-1 @sm:grid-cols-2",
  3: "grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3",
  4: "grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-4",
};
const read = (ctx: Context, path: string) => ctx.state[path.slice(1)];
function set(ctx: Context, path: string, value: UiScalar) {
  const state = { ...ctx.state, [path.slice(1)]: value };
  if (!ctx.disabled && validateUiState(ctx.spec, state)) ctx.change(state);
}
const resolveValue = (ctx: Context, value: UiExpression) => evaluateUiExpression(value, ctx.state);
function textOf(ctx: Context, value: UiExpression, decimals?: number) {
  const resolved = resolveValue(ctx, value);
  return formatUiScalar(resolved, decimals);
}

/** Renders only the shared component vocabulary, with no generated code or HTML. */
export function ResponseUiView({
  block,
  state,
  disabled = false,
  onStateChange,
  onFollowUp,
  dataLabel,
}: {
  block: ResponseUiBlock;
  state: State;
  disabled?: boolean;
  onStateChange: (state: State) => void;
  onFollowUp?: (text: string) => void;
  dataLabel: string;
}) {
  const spec = useMemo(
    () => parseUiSpec(block.spec, !block.complete),
    [block.spec, block.complete],
  );
  if (!spec) return <p className="whitespace-pre-wrap text-sm">{block.summary}</p>;
  const ctx: Context = {
    spec,
    state,
    disabled: disabled || !block.complete,
    change: onStateChange,
    followUp: onFollowUp,
    dataLabel,
  };
  return (
    <div
      className="@container w-full min-w-0 text-foreground"
      data-testid="response-ui"
      aria-busy={!block.complete}
    >
      <UiNode id={spec.root} ctx={ctx} />
    </div>
  );
}

function UiNode({ id, ctx }: { id: string; ctx: Context }) {
  const node = ctx.spec.elements[id];
  if (!node || (node.visible !== undefined && !resolveValue(ctx, node.visible))) return null;
  const children = node.children.map((child) => <UiNode key={child} id={child} ctx={ctx} />);
  switch (node.type) {
    case "Stack": {
      const p = node.props as UiProps<"Stack">;
      return (
        <div
          className={cn(
            "flex min-w-0",
            p.direction === "horizontal" ? "flex-row flex-wrap items-start" : "flex-col",
            GAPS[p.gap],
          )}
        >
          {children}
        </div>
      );
    }
    case "Grid": {
      const p = node.props as UiProps<"Grid">;
      return (
        <div
          className={cn("grid min-w-0", COLUMNS[p.columns as keyof typeof COLUMNS], GAPS[p.gap])}
        >
          {children}
        </div>
      );
    }
    case "Card": {
      const p = node.props as UiProps<"Card">;
      return (
        <Card className="min-w-0">
          {p.title || p.description ? (
            <CardHeader>
              {p.title ? <CardTitle dir="auto">{p.title}</CardTitle> : null}
              {p.description ? (
                <CardDescription className="whitespace-pre-wrap" dir="auto">
                  {p.description}
                </CardDescription>
              ) : null}
            </CardHeader>
          ) : null}
          <CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent>
        </Card>
      );
    }
    case "Text": {
      const p = node.props as UiProps<"Text">;
      const text = textOf(ctx, p.text);
      return p.style === "heading" ? (
        <h3 className="text-base font-semibold" dir="auto">
          {text}
        </h3>
      ) : (
        <p
          className={cn(
            "whitespace-pre-wrap wrap-anywhere",
            p.style === "caption" ? "text-xs text-muted-foreground" : "text-sm leading-relaxed",
          )}
          dir="auto"
        >
          {text}
        </p>
      );
    }
    case "Metric": {
      const p = node.props as UiProps<"Metric">;
      return (
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground" dir="auto">
            {p.label}
          </div>
          <output className="block text-2xl font-semibold tabular-nums" aria-label={p.label}>
            {textOf(ctx, p.value, p.decimals)}
            {p.unit ? (
              <span className="ml-1 text-sm font-normal text-muted-foreground">{p.unit}</span>
            ) : null}
          </output>
        </div>
      );
    }
    case "Link": {
      const p = node.props as UiProps<"Link">;
      return (
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline underline-offset-4 focus-visible:outline-ring"
          dir="auto"
        >
          {p.label}
        </a>
      );
    }
    case "Table": {
      const p = node.props as UiProps<"Table">;
      return (
        <DataTable
          columns={p.columns}
          rows={p.rows.map((row) => row.map((cell) => textOf(ctx, cell)))}
          caption={p.caption}
        />
      );
    }
    case "Chart":
      return <ResponseChart props={node.props as UiProps<"Chart">} ctx={ctx} />;
    case "Diagram":
      return <ResponseDiagram props={node.props as UiProps<"Diagram">} dataLabel={ctx.dataLabel} />;
    case "Checklist": {
      const p = node.props as UiProps<"Checklist">;
      return (
        <div className="flex flex-col gap-3">
          {p.items.map((item, i) => (
            <ChecklistItem key={`${item.bind}:${i}`} item={item} ctx={ctx} />
          ))}
        </div>
      );
    }
    case "Input":
      return <ResponseInput props={node.props as UiProps<"Input">} ctx={ctx} />;
    case "Slider": {
      const p = node.props as UiProps<"Slider">;
      return <ResponseSlider props={p} ctx={ctx} />;
    }
    case "Select":
      return <ResponseSelect props={node.props as UiProps<"Select">} ctx={ctx} />;
    case "Button": {
      const p = node.props as UiProps<"Button">;
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit max-w-full whitespace-normal"
          disabled={ctx.disabled || (p.action.type === "follow_up" && !ctx.followUp)}
          onClick={() => {
            if (p.action.type === "follow_up") ctx.followUp?.(p.action.prompt);
            else if (p.action.type === "reset") ctx.change({ ...ctx.spec.state });
            else set(ctx, p.action.path, p.action.value);
          }}
        >
          {p.label}
        </Button>
      );
    }
    case "Disclosure":
      return (
        <ResponseDisclosure props={node.props as UiProps<"Disclosure">} ctx={ctx}>
          {children}
        </ResponseDisclosure>
      );
    case "Tabs":
      return (
        <ResponseTabs props={node.props as UiProps<"Tabs">} ctx={ctx}>
          {children}
        </ResponseTabs>
      );
    case "Progress": {
      const p = node.props as UiProps<"Progress">;
      const raw = resolveValue(ctx, p.value);
      const value = typeof raw === "number" ? Math.max(0, Math.min(p.max, raw)) : 0;
      return (
        <label className="flex flex-col gap-2 text-sm" dir="auto">
          {p.label}
          <progress
            className="h-2 w-full accent-primary"
            value={value}
            max={p.max}
            aria-label={p.label}
          />
        </label>
      );
    }
    case "Timeline": {
      const p = node.props as UiProps<"Timeline">;
      return (
        <ol className="flex flex-col gap-3 border-l border-border pl-4">
          {p.items.map((item, i) => (
            <li key={i} className="text-sm" dir="auto">
              <div className="flex items-center gap-2">
                <span
                  role="img"
                  aria-label={item.status}
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    item.status === "done"
                      ? "bg-success"
                      : item.status === "active"
                        ? "bg-primary"
                        : "bg-muted-foreground/30",
                  )}
                />
                {item.label}
              </div>
              {item.detail ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  {item.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      );
    }
  }
}

function ChecklistItem({
  item,
  ctx,
}: {
  item: UiProps<"Checklist">["items"][number];
  ctx: Context;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-sm" dir="auto">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={read(ctx, item.bind) === true}
        disabled={ctx.disabled}
        onCheckedChange={(checked) => set(ctx, item.bind, checked)}
      />
      <label htmlFor={id}>{item.label}</label>
    </div>
  );
}

function ResponseInput({ props: p, ctx }: { props: UiProps<"Input">; ctx: Context }) {
  const id = useId();
  const value = read(ctx, p.bind);
  // Keep intermediate numeric text (empty, minus, decimal) while editing.
  const [editing, setEditing] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm" dir="auto">
        {p.label}
      </label>
      <Input
        id={id}
        type={p.input === "number" ? "number" : "text"}
        inputMode={p.input === "number" ? "decimal" : undefined}
        value={editing ?? String(value ?? "")}
        min={p.min}
        max={p.max}
        step={p.step ?? "any"}
        maxLength={4000}
        disabled={ctx.disabled}
        placeholder={p.placeholder}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const text = event.target.value;
          setEditing(text);
          const next = p.input === "number" ? (text.trim() ? Number(text) : NaN) : text;
          const state = { ...ctx.state, [p.bind.slice(1)]: next };
          const valid = validateUiState(ctx.spec, state);
          setInvalid(!valid);
          if (valid) ctx.change(state);
        }}
        onBlur={() => {
          setEditing(null);
          setInvalid(false);
        }}
      />
    </div>
  );
}
function ResponseSlider({ props: p, ctx }: { props: UiProps<"Slider">; ctx: Context }) {
  const id = useId();
  const value = Number(read(ctx, p.bind));
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex justify-between gap-3 text-sm" dir="auto">
        {p.label}
        <span className="tabular-nums">{value}</span>
      </label>
      <input
        id={id}
        className="h-6 w-full accent-primary"
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={value}
        disabled={ctx.disabled}
        onChange={(e) => set(ctx, p.bind, Number(e.target.value))}
      />
    </div>
  );
}
function ResponseSelect({ props: p, ctx }: { props: UiProps<"Select">; ctx: Context }) {
  const id = useId();
  const index = p.options.findIndex((o) => o.value === read(ctx, p.bind));
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm" dir="auto">
        {p.label}
      </label>
      <NativeSelect
        id={id}
        value={index}
        disabled={ctx.disabled}
        className="w-full"
        onChange={(e) => {
          const option = p.options[Number(e.target.value)];
          if (option) set(ctx, p.bind, option.value);
        }}
      >
        {p.options.map((option, i) => (
          <NativeSelectOption key={i} value={i}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
function ResponseDisclosure({
  props: p,
  ctx,
  children,
}: {
  props: UiProps<"Disclosure">;
  ctx: Context;
  children: ReactNode;
}) {
  const [local, setLocal] = useState(false);
  const id = useId();
  const open = p.bind ? read(ctx, p.bind) === true : local;
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-full whitespace-normal"
        aria-expanded={open}
        aria-controls={id}
        disabled={Boolean(p.bind && ctx.disabled)}
        onClick={() => (p.bind ? set(ctx, p.bind, !open) : setLocal(!open))}
      >
        {p.title}
      </Button>
      <div id={id} hidden={!open} className="mt-2 flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}
function ResponseTabs({
  props: p,
  ctx,
  children,
}: {
  props: UiProps<"Tabs">;
  ctx: Context;
  children: ReactNode[];
}) {
  const [local, setLocal] = useState(0);
  const selected = p.bind ? Number(read(ctx, p.bind)) : local;
  return (
    <Tabs
      value={selected}
      onValueChange={(value) => {
        if (typeof value === "number") {
          if (p.bind) set(ctx, p.bind, value);
          else setLocal(value);
        }
      }}
    >
      <TabsList
        activateOnFocus
        className="h-auto max-w-full flex-wrap"
        aria-label={ctx.spec.summary}
      >
        {p.labels.map((label, i) => (
          <TabsTrigger key={i} value={i} disabled={Boolean(p.bind && ctx.disabled)}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children.map((child, i) => (
        <TabsContent key={i} value={i}>
          {child}
        </TabsContent>
      ))}
    </Tabs>
  );
}
function DataTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: string[][];
  caption?: string;
}) {
  return (
    <section
      aria-label={caption ?? columns.join(", ")}
      className="max-w-full overflow-x-auto rounded-lg border border-border"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The overflow region needs keyboard scrolling.
      tabIndex={0}
    >
      <table className="w-full border-collapse text-left text-sm">
        {caption ? (
          <caption className="px-3 py-2 text-left text-xs text-muted-foreground">{caption}</caption>
        ) : null}
        <thead className="bg-muted/50">
          <tr>
            {columns.map((column, i) => (
              <th key={i} scope="col" className="px-3 py-2 font-medium" dir="auto">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {row.map((cell, j) => (
                <td key={j} className="max-w-80 px-3 py-2 tabular-nums" dir="auto">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ResponseChart({ props: p, ctx }: { props: UiProps<"Chart">; ctx: Context }) {
  const titleId = useId();
  const series = p.series.map((s) => ({
    label: s.label,
    points: s.points.flatMap((point) => {
      const y = resolveValue(ctx, point.y);
      return typeof y === "number" ? [{ x: point.x, y }] : [];
    }),
  }));
  const points = series.flatMap((s) => s.points);
  const categories = [...new Set(points.map((point) => String(point.x)))];
  const numericX =
    p.style !== "bar" && points.length > 0 && points.every((point) => typeof point.x === "number");
  const maxAbsY = Math.max(1, ...points.map((point) => Math.abs(point.y)));
  const minY = Math.min(0, ...points.map((point) => point.y / maxAbsY));
  const maxY = Math.max(0, ...points.map((point) => point.y / maxAbsY));
  const scaleY = (y: number) => 210 - ((y / maxAbsY - minY) / (maxY - minY || 1)) * 180;
  const maxAbsX = numericX ? Math.max(1, ...points.map((point) => Math.abs(Number(point.x)))) : 1;
  const minX = numericX ? Math.min(...points.map((point) => Number(point.x) / maxAbsX)) : 0;
  const maxX = numericX
    ? Math.max(...points.map((point) => Number(point.x) / maxAbsX))
    : categories.length;
  const scaleX = (x: string | number) =>
    numericX
      ? 58 + ((Number(x) / maxAbsX - minX) / (maxX - minX || 1)) * 424
      : 58 + ((categories.indexOf(String(x)) + 0.5) / Math.max(1, categories.length)) * 424;
  const barWidth = Math.min(50, 330 / Math.max(1, categories.length) / series.length);
  const zeroY = scaleY(0);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium" dir="auto">
        {p.title}
      </figcaption>
      <svg
        className="h-auto w-full text-foreground"
        viewBox="0 0 520 260"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{p.title}</title>
        {[minY, (minY + maxY) / 2, maxY].map((value, i) => (
          <g key={i}>
            <line
              x1={58}
              x2={482}
              y1={scaleY(value * maxAbsY)}
              y2={scaleY(value * maxAbsY)}
              stroke="currentColor"
              opacity={0.12}
            />
            <text
              x={50}
              y={scaleY(value * maxAbsY) + 4}
              textAnchor="end"
              fill="currentColor"
              fontSize={10}
            >
              {(value * maxAbsY).toLocaleString(undefined, { maximumSignificantDigits: 3 })}
            </text>
          </g>
        ))}
        {series.map((s, index) => (
          <g key={index} opacity={1 - index * 0.12}>
            {p.style === "line" ? (
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray={index ? `${index * 3} 3` : undefined}
                points={s.points
                  .map((point) => `${scaleX(point.x).toFixed(2)},${scaleY(point.y).toFixed(2)}`)
                  .join(" ")}
              />
            ) : null}
            {s.points.map((point, i) =>
              p.style === "bar" ? (
                <rect
                  key={i}
                  x={scaleX(point.x) - (series.length * barWidth) / 2 + index * barWidth}
                  y={Math.min(zeroY, scaleY(point.y))}
                  width={Math.max(1, barWidth - 2)}
                  height={Math.abs(zeroY - scaleY(point.y))}
                  fill="currentColor"
                >
                  <title>{`${s.label}: ${point.x}, ${formatUiScalar(point.y)}`}</title>
                </rect>
              ) : (
                <circle
                  key={i}
                  cx={scaleX(point.x)}
                  cy={scaleY(point.y)}
                  r={p.style === "scatter" ? 3.5 : 2.5}
                  fill="currentColor"
                >
                  <title>{`${s.label}: ${point.x}, ${formatUiScalar(point.y)}`}</title>
                </circle>
              ),
            )}
          </g>
        ))}
        {numericX
          ? [minX, maxX].map((value, i) => (
              <text
                key={i}
                x={i ? 482 : 58}
                y={229}
                textAnchor={i ? "end" : "start"}
                fill="currentColor"
                fontSize={10}
              >
                {(value * maxAbsX).toLocaleString(undefined, { maximumSignificantDigits: 3 })}
              </text>
            ))
          : categories.map((value, i) =>
              categories.length <= 8 || i === 0 || i === categories.length - 1 ? (
                <text
                  key={i}
                  x={scaleX(value)}
                  y={229}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize={10}
                >
                  {value.length > 12 ? `${value.slice(0, 11)}…` : value}
                </text>
              ) : null,
            )}
        {p.xLabel ? (
          <text x={270} y={252} textAnchor="middle" fill="currentColor" fontSize={11}>
            {p.xLabel}
          </text>
        ) : null}
      </svg>
      {p.yLabel ? (
        <div className="text-xs text-muted-foreground" dir="auto">
          {p.yLabel}
        </div>
      ) : null}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <svg width={20} height={8} className="text-foreground" aria-hidden="true">
              <line
                x1={0}
                x2={20}
                y1={4}
                y2={4}
                stroke="currentColor"
                strokeWidth={2}
                opacity={1 - i * 0.12}
                strokeDasharray={i ? `${i * 3} 3` : undefined}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <details className="mt-2 text-xs">
        <summary className="w-fit cursor-pointer text-muted-foreground">{ctx.dataLabel}</summary>
        <div className="mt-2">
          <DataTable
            columns={[p.xLabel ?? "x", p.yLabel ?? "y"]}
            rows={series.flatMap((s) =>
              s.points.map((point) => [`${s.label}: ${point.x}`, formatUiScalar(point.y)]),
            )}
            caption={p.title}
          />
        </div>
      </details>
    </figure>
  );
}
function ResponseDiagram({
  props: p,
  dataLabel,
}: {
  props: UiProps<"Diagram">;
  dataLabel: string;
}) {
  const marker = useId();
  const title = useId();
  const cols = p.nodes.length === 1 ? 1 : 2;
  const rows = Math.ceil(p.nodes.length / cols);
  const width = 520;
  const height = rows * 100 + 20;
  const positions = new Map(
    p.nodes.map((node, i) => [
      node.id,
      { x: 20 + (i % cols) * 260, y: 10 + Math.floor(i / cols) * 100 },
    ]),
  );
  return (
    <figure className="min-w-0">
      {p.title ? (
        <figcaption className="mb-2 text-sm font-medium" dir="auto">
          {p.title}
        </figcaption>
      ) : null}
      <svg
        className="h-auto w-full text-foreground"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={title}
      >
        <title id={title}>{p.title ?? p.nodes.map((n) => n.label).join(", ")}</title>
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {p.edges.map((edge, i) => {
          const a = positions.get(edge.from)!;
          const b = positions.get(edge.to)!;
          const horizontal = a.y === b.y;
          const forward = b.x > a.x;
          const down = b.y > a.y;
          const x1 = horizontal ? a.x + (forward ? 200 : 0) : a.x + 100;
          const y1 = horizontal ? a.y + 32 : a.y + (down ? 65 : 0);
          const x2 = horizontal ? b.x + (forward ? 0 : 200) : b.x + 100;
          const y2 = horizontal ? b.y + 32 : b.y + (down ? 0 : 65);
          return (
            <g key={i}>
              <path
                d={
                  horizontal
                    ? `M ${x1} ${y1} L ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${x1} ${y1 + (down ? 20 : -20)}, ${x2} ${y2 + (down ? -20 : 20)}, ${x2} ${y2}`
                }
                fill="none"
                stroke="currentColor"
                opacity={0.5}
                markerEnd={`url(#${marker})`}
              >
                <title>{`${p.nodes.find((n) => n.id === edge.from)?.label} → ${p.nodes.find((n) => n.id === edge.to)?.label}${edge.label ? `: ${edge.label}` : ""}`}</title>
              </path>
              {edge.label ? (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2}
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize={10}
                >
                  {edge.label.slice(0, 30)}
                </text>
              ) : null}
            </g>
          );
        })}
        {p.nodes.map((node) => {
          const { x, y } = positions.get(node.id)!;
          const lines = node.label.match(/.{1,28}(?:\s|$)|.{1,28}/g)?.slice(0, 2) ?? [node.label];
          return (
            <g key={node.id}>
              <rect
                x={x}
                y={y}
                width={200}
                height={65}
                rx={8}
                fill="var(--card)"
                stroke="currentColor"
                opacity={0.8}
              />
              <text x={x + 100} y={y + 28} textAnchor="middle" fill="currentColor" fontSize={12}>
                {lines.map((line, i) => (
                  <tspan key={i} x={x + 100} dy={i ? 16 : 0}>
                    {line.trim()}
                  </tspan>
                ))}
              </text>
              <title>{node.label}</title>
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-xs">
        <summary className="w-fit cursor-pointer text-muted-foreground">{dataLabel}</summary>
        <ul className="mt-2 flex flex-col gap-2">
          {p.nodes.map((n) => (
            <li key={n.id}>
              <span className="font-medium">{n.label}</span>
              {n.detail ? (
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{n.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
        <ul className="mt-2 flex flex-col gap-1">
          {p.edges.map((e, i) => (
            <li key={i}>
              {p.nodes.find((n) => n.id === e.from)?.label} →{" "}
              {p.nodes.find((n) => n.id === e.to)?.label}
              {e.label ? `: ${e.label}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
