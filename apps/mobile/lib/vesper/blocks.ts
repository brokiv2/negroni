import type { MessageBlock } from "@rakazo/contracts";

/**
 * The transcript's dispatch point.
 *
 * Negroni's server pre-shapes everything into `MessageBlock`s, so Vesper renders
 * a block kind rather than a tool name. A new kind slots in by adding an entry
 * to `VESPER_BLOCK_RENDERERS` and a component beside the others; the map is
 * complete by construction, so a kind with no entry is a compile error rather
 * than a silent unstyled default.
 */

export type VesperBlockRenderer =
  /** Markdown body in a bubble. */
  | "text"
  /** Key/value card — the generic tool-result surface. */
  | "card"
  /** Plan or checklist with per-step labels. */
  | "steps"
  /** "Working…" line with the tools in flight. */
  | "progress"
  /** A question that round-trips through `threads.answer`. */
  | "ask"
  /** Connector / OAuth prompt. */
  | "connect"
  /** Computer state line, with the take-control affordance. */
  | "computer"
  /** Quiet system aside. */
  | "meta"
  /** Collapsed delegation chip — subagents, child bots, handoffs, peer messages. */
  | "delegation"
  /** Inline image. */
  | "image"
  /** File / artifact row. */
  | "file"
  /** Chart artifact. */
  | "chart"
  /** A page the bot visited: screenshot plus a hand-off to the live computer. */
  | "browser"
  /** A mail search count, or one thread. */
  | "mail"
  /** Document preview. Structurally a superset of `file`. */
  | "pdf"
  /** Durable multi-step work with per-step status. Not `steps`. */
  | "plan"
  /** The dark finance summary. */
  | "finance"
  /** A kind newer than this build; say so rather than dropping it. */
  | "unknown";

/**
 * Every block kind the contract defines today, mapped to a renderer family.
 * Listed explicitly so a new contract kind is a compile error here (see
 * `assertExhaustive` below) rather than a silent unstyled default at runtime.
 */
export const VESPER_BLOCK_RENDERERS = {
  text: "text",
  card: "card",
  ask: "ask",
  choice: "ask",
  app_connect: "connect",
  connect: "connect",
  computer: "computer",
  meta: "meta",
  progress: "progress",
  steps: "steps",
  subagent: "delegation",
  child_bot: "delegation",
  cloud_agent: "delegation",
  skill_draft: "card",
  mcp_approval: "ask",
  image: "image",
  file: "file",
  handoff: "delegation",
  channel_message: "delegation",
  bot_message_sent: "delegation",
  bot_message_received: "delegation",
  chart: "chart",
  browser: "browser",
  mail: "mail",
  pdf: "pdf",
  plan: "plan",
  finance: "finance",
} as const satisfies Record<MessageBlock["kind"], VesperBlockRenderer>;

/**
 * Compile-time completeness guard. A new `MessageBlock` kind that has no entry
 * above makes this line fail to typecheck.
 */
type UnmappedBlockKind = Exclude<MessageBlock["kind"], keyof typeof VESPER_BLOCK_RENDERERS>;
const _allBlockKindsMapped: UnmappedBlockKind extends never ? true : never = true;
void _allBlockKindsMapped;

export function vesperBlockRenderer(kind: string): VesperBlockRenderer {
  return (VESPER_BLOCK_RENDERERS as Record<string, VesperBlockRenderer>)[kind] ?? "unknown";
}

/** Renderers that draw their own surface, so the bubble must not wrap them. */
const STANDALONE: ReadonlySet<VesperBlockRenderer> = new Set([
  "card",
  "steps",
  "ask",
  "connect",
  "computer",
  "image",
  "file",
  "chart",
  "delegation",
  "browser",
  "mail",
  "pdf",
  "plan",
  "finance",
]);

/** True when the block draws its own card and should sit outside the bubble. */
export function isStandaloneBlock(kind: string): boolean {
  return STANDALONE.has(vesperBlockRenderer(kind));
}

/** Blocks that carry conversational prose and belong inside the bubble. */
export function isBubbleBlock(kind: string): boolean {
  const renderer = vesperBlockRenderer(kind);
  return renderer === "text" || renderer === "progress" || renderer === "meta";
}
