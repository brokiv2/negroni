import { z } from "zod";

export const RESPONSE_UI_MAX_BYTES = 128_000;
export const RESPONSE_UI_MAX_ELEMENTS = 160;
const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const StatePath = z.string().regex(/^\/[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Label = z.string().max(200);
const Text = z.string().max(12_000);
const Scalar = z.union([z.string().max(4_000), z.number().finite(), z.boolean(), z.null()]);
export type UiScalar = z.infer<typeof Scalar>;
export type UiExpression =
  | UiScalar
  | { $state: string }
  | { $calc: { op: UiCalculation; args: UiExpression[] } };
export type UiCalculation =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "power"
  | "round"
  | "min"
  | "max"
  | "clamp"
  | "equal"
  | "greater"
  | "less"
  | "and"
  | "or"
  | "not";
const Calculation = z.enum([
  "add",
  "subtract",
  "multiply",
  "divide",
  "power",
  "round",
  "min",
  "max",
  "clamp",
  "equal",
  "greater",
  "less",
  "and",
  "or",
  "not",
]);
const StateReference = z.strictObject({ $state: StatePath });
const CalculationExpression = z.lazy(() =>
  z.strictObject({
    $calc: z.strictObject({ op: Calculation, args: z.array(Expression).min(1).max(8) }),
  }),
);
const Expression: z.ZodType<UiExpression> = z.lazy(() =>
  z.union([Scalar, StateReference, CalculationExpression]),
);
const DynamicText = z.union([Text, Expression]);
const DynamicNumber = z.union([z.number().finite(), StateReference, CalculationExpression]);
const Action = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("follow_up"), prompt: z.string().min(1).max(4_000) }),
  z.strictObject({ type: z.literal("reset") }),
  z.strictObject({ type: z.literal("set"), path: StatePath, value: Scalar }),
]);
const ChildLayout = z.strictObject({
  gap: z.enum(["small", "medium", "large"]).default("medium"),
});

/** Shared declarative vocabulary. Renderers never evaluate generated source code. */
export const UiComponentProps = {
  Stack: ChildLayout.extend({ direction: z.enum(["vertical", "horizontal"]).default("vertical") }),
  Grid: ChildLayout.extend({ columns: z.number().int().min(1).max(4).default(2) }),
  Card: z.strictObject({ title: Label.optional(), description: Text.optional() }),
  Text: z.strictObject({
    text: DynamicText,
    style: z.enum(["body", "heading", "caption"]).default("body"),
  }),
  Metric: z.strictObject({
    label: Label,
    value: DynamicText,
    unit: Label.optional(),
    decimals: z.number().int().min(0).max(6).optional(),
  }),
  Link: z.strictObject({
    label: Label,
    url: z.url().refine((v) => /^https?:$/.test(new URL(v).protocol)),
  }),
  Table: z.strictObject({
    columns: z.array(Label).min(1).max(12),
    rows: z.array(z.array(DynamicText).max(12)).max(200),
    caption: Label.optional(),
  }),
  Chart: z.strictObject({
    title: Label,
    style: z.enum(["bar", "line", "scatter"]),
    xLabel: Label.optional(),
    yLabel: Label.optional(),
    series: z
      .array(
        z.strictObject({
          label: Label,
          points: z
            .array(z.strictObject({ x: z.union([Label, z.number().finite()]), y: DynamicNumber }))
            .max(256),
        }),
      )
      .min(1)
      .max(6),
  }),
  Diagram: z.strictObject({
    title: Label.optional(),
    nodes: z
      .array(z.strictObject({ id: Key, label: Label, detail: Text.optional() }))
      .min(1)
      .max(24),
    edges: z.array(z.strictObject({ from: Key, to: Key, label: Label.optional() })).max(48),
  }),
  Checklist: z.strictObject({
    items: z
      .array(z.strictObject({ label: Label, bind: StatePath }))
      .min(1)
      .max(64),
  }),
  Input: z.strictObject({
    label: Label,
    bind: StatePath,
    input: z.enum(["text", "number"]).default("text"),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
    placeholder: Label.optional(),
  }),
  Slider: z.strictObject({
    label: Label,
    bind: StatePath,
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().default(1),
  }),
  Select: z.strictObject({
    label: Label,
    bind: StatePath,
    options: z
      .array(z.strictObject({ label: Label, value: Scalar }))
      .min(1)
      .max(30),
  }),
  Button: z.strictObject({ label: Label, action: Action }),
  Disclosure: z.strictObject({ title: Label, bind: StatePath.optional() }),
  Tabs: z.strictObject({ labels: z.array(Label).min(1).max(8), bind: StatePath.optional() }),
  Progress: z.strictObject({
    label: Label,
    value: DynamicNumber,
    max: z.number().positive().default(100),
  }),
  Timeline: z.strictObject({
    items: z
      .array(
        z.strictObject({
          label: Label,
          detail: Text.optional(),
          status: z.enum(["pending", "active", "done"]).default("pending"),
        }),
      )
      .min(1)
      .max(64),
  }),
} as const;
export type UiProps<T extends keyof typeof UiComponentProps> = z.infer<
  (typeof UiComponentProps)[T]
>;
export const UiComponentType = z.enum([
  "Stack",
  "Grid",
  "Card",
  "Text",
  "Metric",
  "Link",
  "Table",
  "Chart",
  "Diagram",
  "Checklist",
  "Input",
  "Slider",
  "Select",
  "Button",
  "Disclosure",
  "Tabs",
  "Progress",
  "Timeline",
]);
export const UiElement = z.strictObject({
  type: UiComponentType,
  props: z.record(z.string(), z.json()),
  children: z.array(Key).max(64).default([]),
  visible: Expression.optional(),
});
export type UiElement = z.infer<typeof UiElement>;
const UiSpecBase = z.strictObject({
  root: Key,
  elements: z.record(Key, UiElement),
  state: z.record(Key, Scalar).default({}),
  summary: z.string().min(1).max(280),
});
export type UiSpec = z.infer<typeof UiSpecBase>;
const CONTAINERS = new Set(["Stack", "Grid", "Card", "Disclosure", "Tabs"]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function boundedUiJson(value: unknown, depth = 0): boolean {
  if (depth > 24) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= RESPONSE_UI_MAX_BYTES;
  if (Array.isArray(value))
    return value.length <= 1_000 && value.every((v) => boundedUiJson(v, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(
    ([k, v]) => !UNSAFE_KEYS.has(k) && boundedUiJson(v, depth + 1),
  );
}

/** Full and incremental documents use the same vocabulary; only dangling children may stream. */
export function parseUiSpec(value: unknown, partial = false): UiSpec | null {
  if (
    !boundedUiJson(value) ||
    new TextEncoder().encode(JSON.stringify(value)).length > RESPONSE_UI_MAX_BYTES
  )
    return null;
  const parsed = UiSpecBase.safeParse(value);
  if (!parsed.success) return null;
  const spec = parsed.data;
  const entries = Object.entries(spec.elements);
  if (entries.length > RESPONSE_UI_MAX_ELEMENTS || Object.keys(spec.state).length > 64) return null;
  // JSONB can reorder elements. Apply every component's defaults before
  // validating actions against inputs elsewhere in the composition.
  for (const [, element] of entries) {
    const props = UiComponentProps[element.type].safeParse(element.props);
    if (!props.success || (element.children.length && !CONTAINERS.has(element.type))) return null;
    element.props = props.data;
  }
  for (const [id, element] of entries) {
    if (!partial && !referencesExist([element.props, element.visible], spec.state)) return null;
    if (
      element.type === "Table" &&
      (element.props.rows as unknown[][]).some(
        (row) => row.length !== (element.props.columns as string[]).length,
      )
    )
      return null;
    if (!partial && element.type === "Button") {
      const action = element.props.action as { type: string; path?: string; value?: UiScalar };
      if (
        action.type === "set" &&
        !validateUiState(spec, { ...spec.state, [action.path!.slice(1)]: action.value! })
      )
        return null;
    }
    if (
      element.type === "Tabs" &&
      (element.props.labels as string[]).length !== element.children.length
    )
      return null;
    if (element.type === "Diagram") {
      const nodes = element.props.nodes as { id: string }[];
      const keys = new Set(nodes.map((n) => n.id));
      if (
        keys.size !== nodes.length ||
        (element.props.edges as { from: string; to: string }[]).some(
          (e) => !keys.has(e.from) || !keys.has(e.to),
        )
      )
        return null;
    }
    if (!partial && element.children.some((child) => !spec.elements[child])) return null;
    if (id === "constructor" || id === "prototype") return null;
  }
  const visiting = new Set<string>();
  const heights = new Map<string, number>();
  const height = (id: string, depth: number): number => {
    if (depth > 20 || visiting.has(id)) return 100;
    const cached = heights.get(id);
    if (cached !== undefined) return cached;
    const node = spec.elements[id];
    if (!node) return partial ? 0 : 100;
    visiting.add(id);
    const result = 1 + Math.max(0, ...node.children.map((child) => height(child, depth + 1)));
    visiting.delete(id);
    heights.set(id, result);
    return result;
  };
  if (!spec.elements[spec.root] || height(spec.root, 0) > 20) return null;
  // Validate disconnected nodes too; a later patch may attach them to the root.
  for (const [id] of entries) if (height(id, 0) > 20) return null;
  if (!validateUiState(spec, spec.state, partial)) return null;
  return spec;
}

function referencesExist(value: unknown, state: Record<string, UiScalar>): boolean {
  if (!value || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every((v) => referencesExist(v, state));
  const object = value as Record<string, unknown>;
  if (typeof object.$state === "string" && !Object.hasOwn(state, object.$state.slice(1)))
    return false;
  return Object.values(object).every((v) => referencesExist(v, state));
}

/** State writes cannot introduce new paths or change input types/ranges. */
export function validateUiState(
  spec: UiSpec,
  state: Record<string, UiScalar>,
  partial = false,
): boolean {
  if (Object.keys(state).length !== Object.keys(spec.state).length) return false;
  for (const [key, initial] of Object.entries(spec.state)) {
    if (
      !Object.hasOwn(state, key) ||
      typeof state[key] !== typeof initial ||
      !Scalar.safeParse(state[key]).success
    )
      return false;
  }
  const read = (path: unknown) => (typeof path === "string" ? state[path.slice(1)] : undefined);
  for (const element of Object.values(spec.elements)) {
    const p = element.props;
    const value = read(p.bind);
    if (["Input", "Slider", "Select"].includes(element.type) && value === undefined) {
      if (partial) continue;
      return false;
    }
    if (element.type === "Input" || element.type === "Slider") {
      if (element.type === "Input" && (p.input ?? "text") === "text") {
        if (typeof value !== "string") return false;
      } else if (
        typeof value !== "number" ||
        (typeof p.min === "number" && value < p.min) ||
        (typeof p.max === "number" && value > p.max)
      )
        return false;
      if (typeof p.min === "number" && typeof p.max === "number" && p.min > p.max) return false;
    }
    if (
      element.type === "Select" &&
      !(p.options as { value: UiScalar }[]).some((o) => o.value === value)
    )
      return false;
    if (
      element.type === "Checklist" &&
      (p.items as { bind: string }[]).some((i) => typeof read(i.bind) !== "boolean")
    )
      return false;
    if (p.bind && element.type === "Disclosure" && typeof value !== "boolean") return false;
    if (
      p.bind &&
      element.type === "Tabs" &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value >= (p.labels as string[]).length)
    )
      return false;
  }
  return true;
}

export const ResponseUiBlock = z
  .object({
    kind: z.literal("response_ui"),
    id: Key,
    summary: z.string().min(1).max(280),
    spec: UiSpecBase.refine(
      (spec) => Boolean(parseUiSpec(spec, true)),
      "Invalid response composition",
    ),
    revision: z.number().int().nonnegative().default(0),
    complete: z.boolean().default(true),
    state: z.record(Key, Scalar).optional(),
  })
  .superRefine((block, ctx) => {
    if (
      !parseUiSpec(block.spec, !block.complete) ||
      (block.state && !validateUiState(block.spec, block.state, !block.complete))
    )
      ctx.addIssue({ code: "custom", message: "Invalid response state or incomplete composition" });
  });
export type ResponseUiBlock = z.infer<typeof ResponseUiBlock>;
export const UpdateResponseUiStateInput = z
  .strictObject({
    messageId: z.string().min(1).max(200),
    blockId: Key,
    revision: z.number().int().nonnegative(),
    state: z.record(Key, Scalar),
  })
  .refine((v) => Object.keys(v.state).length <= 64, "Too many state values");

export function responseUiCatalogPrompt() {
  const schema = z.toJSONSchema(z.strictObject(UiComponentProps), {
    io: "input",
    reused: "ref",
  });
  return JSON.stringify({ $defs: schema.$defs, components: schema.properties });
}

/** Native clients generate validation schemas from the same component definitions. */
export function responseUiComponentSchemas() {
  return {
    components: Object.fromEntries(
      Object.entries(UiComponentProps).map(([name, props]) => [
        name,
        z.toJSONSchema(props, { io: "input" }),
      ]),
    ),
    expression: z.toJSONSchema(Expression, { io: "input" }),
  };
}
