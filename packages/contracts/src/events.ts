import * as z from "zod";
import { ARTIFACT_NAME_MAX_LENGTH } from "./attachments.js";
import { botSecretDestinationSchema } from "./bot-secrets.js";
import { EmailDraftWidget, WeatherWidget } from "./chat-widgets.js";
import { Id } from "./ids.js";
import { McpTransportSchema } from "./mcp.js";

export const ProductEventType = z.enum([
  "thread.message.created",
  "thread.cleared",
  "thread.message.updated",
  "thread.message.reaction",
  "thread.progress",
  "thread.artifact",
  "thread.ask",
  "thread.choice",
  "thread.meta",
  "thread.computer",
  "thread.subagent",
  "thread.cloud_agent",
  "run.started",
  "run.checkpointed",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "computer.status",
  "computer.takeover.requested",
  "computer.takeover.granted",
  "computer.takeover.released",
  "memory.revised",
  "routine.created",
  "routine.updated",
  "routine.fired",
  "skill.teaching.started",
  "skill.teaching.stopped",
  "skill.draft.created",
  "skill.saved",
  "effect.recorded",
  "agent.tool.called",
  "agent.tool.completed",
  "effect.reconciled",
  "usage.recorded",
  "bot.spawned",
  "bot.updated",
  "bot.archived",
  "bot.deleted",
  "group.created",
  "group.updated",
  "group.handoff",
]);
export type ProductEventType = z.infer<typeof ProductEventType>;

export const MessageRole = z.enum(["user", "bot", "system"]);
export const BotMessageIntent = z.enum([
  "request",
  "result",
  "question",
  "status",
  "fyi",
  "blocker",
]);
export type BotMessageIntent = z.infer<typeof BotMessageIntent>;

export const MAX_CHART_DATA_ROWS = 5_000;

const ChartSpec = z.record(z.string(), z.any());

function embeddedChartRowCount(spec: Record<string, unknown>): number {
  const specData = Array.isArray(spec.data) ? spec.data.length : 0;
  const markData = Array.isArray(spec.marks)
    ? spec.marks.reduce((total, mark) => {
        if (!mark || typeof mark !== "object" || !Array.isArray(mark.data)) return total;
        return total + mark.data.length;
      }, 0)
    : 0;
  return specData + markData;
}

const ChartBlock = z
  .object({
    kind: z.literal("chart"),
    name: z.string(),
    /** Declarative Observable Plot spec, validated by render_plot before publish.
        z.any keeps the inferred type JSON-assignable for persistence. */
    spec: ChartSpec,
    data: z.array(z.any()).max(MAX_CHART_DATA_ROWS),
  })
  .superRefine((block, ctx) => {
    if (block.data.length + embeddedChartRowCount(block.spec) <= MAX_CHART_DATA_ROWS) return;
    ctx.addIssue({
      code: "custom",
      message: `Chart data exceeds the ${MAX_CHART_DATA_ROWS.toLocaleString("en-US")}-row limit`,
    });
  });

export const SecretAskPurpose = z.enum(["otp", "password", "api_key"]);
export type SecretAskPurpose = z.infer<typeof SecretAskPurpose>;

/* ------------------------------------------------------------------ *
 * Rich tool-result cards
 *
 * Every card block persists inside a message row and is replayed on
 * every snapshot, so each one is bounded the same way `chart` is: the
 * transcript is not a place to stream unbounded payloads. Binary
 * content (screenshots, page previews) is never inlined — it is stored
 * as an artifact and referenced by id, so replay re-fetches through the
 * existing authorized artifact path instead of carrying base64 or a
 * signed URL that outlives its lease.
 * ------------------------------------------------------------------ */

/** One-line plain-language fallback carried by every card block. */
export const TOOL_CARD_SUMMARY_MAX_LENGTH = 280;
/** Excerpts, notes and error strings inside a card. */
export const TOOL_CARD_TEXT_MAX_LENGTH = 2_000;
export const TOOL_CARD_URL_MAX_LENGTH = 4_096;
export const MAX_PLAN_STEPS = 64;
export const MAX_PDF_FORM_FIELDS = 32;
export const MAX_FINANCE_CATEGORIES = 32;
export const MAX_FINANCE_TRANSACTIONS = 200;

/**
 * Required on every card kind. A client that does not know the kind —
 * an older build, a notification preview, an agent-history transcript —
 * renders this string instead of nothing. Emitters must write it.
 */
const ToolCardSummary = z.string().min(1).max(TOOL_CARD_SUMMARY_MAX_LENGTH);
const ToolCardText = z.string().max(TOOL_CARD_TEXT_MAX_LENGTH);
const ToolCardUrl = z.string().max(TOOL_CARD_URL_MAX_LENGTH);

/**
 * An image held as an artifact. `width`/`height` let a card reserve its
 * box before the bytes arrive, so a screenshot does not reflow the
 * transcript on load.
 */
export const CardImageRef = z.object({
  artifactId: Id,
  mimeType: z.string().max(128),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CardImageRef = z.infer<typeof CardImageRef>;

export const BrowserCardStatus = z.enum(["loading", "ready", "error"]);
export type BrowserCardStatus = z.infer<typeof BrowserCardStatus>;

export const MailCardMode = z.enum(["search", "thread"]);
export type MailCardMode = z.infer<typeof MailCardMode>;

export const PdfFormFieldType = z.enum(["text", "checkbox", "unsupported"]);
export type PdfFormFieldType = z.infer<typeof PdfFormFieldType>;

/**
 * Card-level vocabulary, not `RunStatus`. A plan card outlives the run
 * that produced it and has to say "waiting for you" in terms a reader
 * understands; `RunStatus` maps onto it (waiting_takeover → waiting_input,
 * completed → succeeded, leased → running).
 */
export const PlanCardStatus = z.enum([
  "queued",
  "running",
  "waiting_input",
  "waiting_approval",
  "scheduled",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type PlanCardStatus = z.infer<typeof PlanCardStatus>;

export const PlanCardStepStatus = z.enum([
  "pending",
  "running",
  "waiting",
  "done",
  "failed",
  "skipped",
]);
export type PlanCardStepStatus = z.infer<typeof PlanCardStepStatus>;

export const PlanCardStep = z.object({
  /** Stable across updates so a renderer can animate a step rather than rebuild the list. */
  id: z.string().max(128).optional(),
  title: z.string().min(1).max(TOOL_CARD_SUMMARY_MAX_LENGTH),
  status: PlanCardStepStatus,
  detail: ToolCardText.optional(),
});
export type PlanCardStep = z.infer<typeof PlanCardStep>;

export const FinanceCardCategory = z.object({
  name: z.string().min(1).max(120),
  amount: z.number().finite(),
});
export type FinanceCardCategory = z.infer<typeof FinanceCardCategory>;

export const FinanceCardTransaction = z.object({
  id: z.string().max(128).optional(),
  /** ISO date or the source file's own date string; renderers must not assume parseability. */
  date: z.string().max(64),
  description: z.string().max(280),
  category: z.string().max(120).optional(),
  amount: z.number().finite(),
});
export type FinanceCardTransaction = z.infer<typeof FinanceCardTransaction>;

export const MessageBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("card"),
    weather: WeatherWidget.optional(),
    lines: z.array(z.object({ k: z.string(), v: z.string() })),
    /** Optional heading above the rows. Older emitters omit both; a renderer
        must still lay out a bare `lines` list. */
    title: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH).optional(),
    subtitle: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH).optional(),
  }),
  z.object({
    kind: z.literal("ask"),
    emailDraft: EmailDraftWidget.optional(),
    text: z.string(),
    approvalEffectId: Id.optional(),
    detail: z.string().optional(),
    input: z.enum(["text", "secret"]).optional(),
    /** Why the secret is needed; drives field label on the masked card. */
    purpose: SecretAskPurpose.optional(),
    // Records what the runtime could produce under either deployment mode, so
    // an ask persisted before an owner toggles the private-HTTP flag still
    // validates on replay.
    credential: botSecretDestinationSchema({ allowPrivateHttpOrigin: true }).optional(),
    status: z.enum(["pending", "answered"]).optional(),
    answer: z.string().optional(),
    actions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          outcome: z.enum(["created", "cancelled"]).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    question: z.string(),
    subtitle: z.string().optional(),
    options: z.array(z.object({ id: z.string(), letter: z.string(), label: z.string() })),
    /** Set once the user picks an option; renders the picker as answered. */
    answerId: z.string().optional(),
  }),
  z.object({
    /** Inline app authorization card (Composio-backed): logo, name, one-line
        description, and an Authorize button that flips to connected. */
    kind: z.literal("app_connect"),
    /** Run requesting access; absent for onboarding cards. */
    requestId: z.string().optional(),
    sourceMessageId: z.string().optional(),
    connectorId: z.string().optional(),
    provider: z.string(),
    name: z.string(),
    description: z.string(),
    logo: z.string().nullable(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("connect"),
    name: z.string(),
    initial: z.string(),
    color: z.string(),
    status: z.enum(["pending", "connected"]),
  }),
  z.object({
    kind: z.literal("computer"),
    state: z.string(),
    text: z.string(),
  }),
  z.object({ kind: z.literal("meta"), text: z.string() }),
  z.object({
    kind: z.literal("progress"),
    text: z.string(),
    /** Provider-generated tool status rather than assistant-authored narration. */
    activity: z.literal(true).optional(),
    pendingToolNames: z.array(z.string()).optional(),
    /** 0–100 when the work has a knowable fraction. Absent means indeterminate;
        render a spinner, not a bar at zero. */
    percent: z.number().min(0).max(100).optional(),
  }),
  z.object({
    kind: z.literal("steps"),
    steps: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("subagent"),
    agentId: z.string(),
    name: z.string(),
    task: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    progress: z.string().optional(),
    result: z.string().optional(),
  }),
  z.object({
    kind: z.literal("child_bot"),
    botId: z.string(),
    name: z.string(),
    title: z.string().optional(),
    status: z.enum(["created", "archived", "deleted"]),
  }),
  z.object({
    /** Compact card for a remote cloud coding agent (not the bot computer). */
    kind: z.literal("cloud_agent"),
    agentId: z.string(),
    title: z.string(),
    status: z.enum(["running", "finished", "failed", "cancelled"]),
    url: z.string(),
    branch: z.string().optional(),
    prUrl: z.string().optional(),
    latestRunId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("skill_draft"),
    skillId: Id,
    name: z.string(),
    goal: z.string(),
    playbook: z.object({
      whenToUse: z.string(),
      inputs: z.array(z.string()),
      steps: z.array(z.string()),
      howToCheck: z.string(),
      whatToReturn: z.string(),
      approvalBoundaries: z.string(),
      failureHandling: z.string(),
    }),
    status: z.enum(["draft", "saved"]),
  }),
  ChartBlock,
  z.object({
    /** A page the bot visited, with an optional captured screenshot and a
        hand-off to the live computer. The screenshot is an artifact id, never
        inline bytes and never a signed URL: a URL sealed at emit time would be
        dead by the time the transcript is replayed. */
    kind: z.literal("browser"),
    summary: ToolCardSummary,
    url: ToolCardUrl,
    /** Page title. Absent while loading or when the page did not report one;
        render the hostname from `url` instead. */
    title: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH).optional(),
    status: BrowserCardStatus,
    /** Absent when capture was unavailable, too large, or the page errored.
        Render the placeholder treatment rather than an empty box. */
    screenshot: CardImageRef.optional(),
    /** The computer that holds the session, so "Take control" knows its target.
        Absent means no live takeover is offered for this card. Liveness is a
        question for `computer.status`, not for this block. */
    computerId: Id.optional(),
    error: ToolCardText.optional(),
  }),
  z.object({
    /** A mailbox read. `search` is a one-line count; `thread` is a message card.
        Negroni has no mail data model — see the contract doc; this kind exists so
        a connector-backed mail tool has somewhere to land. */
    kind: z.literal("mail"),
    summary: ToolCardSummary,
    mode: MailCardMode,
    /** Connector slug (`gmail`, `outlook`) for the logo. */
    provider: z.string().max(64).optional(),
    query: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH).optional(),
    /** search mode: how many messages matched. */
    matchCount: z.number().int().nonnegative().optional(),
    /** The provider returned a capped page; render "at least N". */
    truncated: z.boolean().optional(),
    threadId: z.string().max(256).optional(),
    messageCount: z.number().int().positive().optional(),
    subject: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH).optional(),
    /** Display name or address of the message the card shows. */
    sender: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH).optional(),
    excerpt: ToolCardText.optional(),
    receivedAt: z.string().max(64).optional(),
    unread: z.boolean().optional(),
    attachmentCount: z.number().int().nonnegative().optional(),
    /** Provider deep link. Renderers must refuse anything but http(s). */
    openUrl: ToolCardUrl.optional(),
  }),
  z.object({
    /** A document preview. Structurally a superset of `file`, so a renderer
        that does not know this kind can fall back to the file treatment on the
        same fields. */
    kind: z.literal("pdf"),
    summary: ToolCardSummary,
    artifactId: Id,
    mimeType: z.string().max(128),
    name: z.string().max(ARTIFACT_NAME_MAX_LENGTH),
    size: z.number().int().nonnegative(),
    pageCount: z.number().int().positive().optional(),
    /** Rendered first page, when one was captured. */
    previewImage: CardImageRef.optional(),
    /** AcroForm fields, when the document has them; drives the form peek. */
    fields: z
      .array(
        z.object({
          name: z.string().max(200),
          value: z.string().max(TOOL_CARD_SUMMARY_MAX_LENGTH),
          type: PdfFormFieldType,
        }),
      )
      .max(MAX_PDF_FORM_FIELDS)
      .optional(),
  }),
  z.object({
    /** Durable multi-step work with per-step status. Distinct from `steps`,
        which coalesces tool-call streaks for a single turn: a plan outlives the
        turn and can be updated in place. Progress fractions are derived from
        `steps`, not carried, so a card can never disagree with its own list. */
    kind: z.literal("plan"),
    summary: ToolCardSummary,
    title: z.string().min(1).max(TOOL_CARD_SUMMARY_MAX_LENGTH),
    status: PlanCardStatus,
    steps: z.array(PlanCardStep).max(MAX_PLAN_STEPS),
    /** The next step, the result, or the question — whichever the status implies. */
    note: ToolCardText.optional(),
    runId: Id.optional(),
  }),
  z.object({
    /** Spending summary over an imported statement. */
    kind: z.literal("finance"),
    summary: ToolCardSummary,
    title: z.string().min(1).max(TOOL_CARD_SUMMARY_MAX_LENGTH),
    /** ISO 4217. Absent means "whatever the source file used"; do not guess. */
    currency: z.string().length(3).optional(),
    period: z.object({ from: z.string().max(64), to: z.string().max(64) }).optional(),
    income: z.number().finite(),
    spending: z.number().finite(),
    saved: z.number().finite(),
    categories: z.array(FinanceCardCategory).max(MAX_FINANCE_CATEGORIES),
    /** A bounded window of rows. Totals above always cover every row. */
    transactions: z.array(FinanceCardTransaction).max(MAX_FINANCE_TRANSACTIONS).optional(),
    /** Total row count when `transactions` is a truncated window. */
    transactionCount: z.number().int().nonnegative().optional(),
    /** The imported statement, so the full data stays reachable. */
    artifactId: Id.optional(),
  }),
  z.object({
    /** Approval card for an agent-created MCP server. The user completes the
        OAuth popup (or confirms no authorization is needed) in the UI. */
    kind: z.literal("mcp_approval"),
    name: z.string(),
    serverId: Id,
    transport: McpTransportSchema,
    endpoint: z.string().nullable(),
    needsOAuth: z.boolean(),
  }),
  z.object({
    kind: z.literal("image"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("file"),
    artifactId: Id,
    mimeType: z.string(),
    name: z.string(),
    size: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("handoff"),
    fromBotId: Id,
    toBotId: Id,
    text: z.string(),
    /** Links ownership transfers in one user-started group turn. */
    hop: z.number().int().positive().optional(),
  }),
  z.object({
    /** A group-chat message delivered into a member bot's own thread. */
    kind: z.literal("channel_message"),
    provider: z.string(),
    /** Per-message network when a provider spans multiple transports. */
    transport: z.string().optional(),
    channelId: Id,
    fromAddress: z.string(),
    fromLabel: z.string(),
    text: z.string(),
    hop: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /** Shown in the sending bot's own chat, so the user can see what it sent. */
    kind: z.literal("bot_message_sent"),
    toBotId: Id,
    toBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
  }),
  z.object({
    /** Delivered into the receiving bot's own chat as the prompt that woke it. */
    kind: z.literal("bot_message_received"),
    fromBotId: Id,
    fromBotName: z.string(),
    text: z.string(),
    intent: BotMessageIntent.optional(),
    /** Sender-thread echo this delivery answers, when applicable. */
    returnToMessageId: Id.optional(),
    /** Links in a bot-started chain; absent when a person started it. */
    hop: z.number().int().nonnegative().optional(),
  }),
]);
export type MessageBlock = z.infer<typeof MessageBlock>;

/** Rendered in place of a block whose kind this build does not know. */
export const UNSUPPORTED_BLOCK_TEXT = "Unsupported content";

/**
 * Read-side element for persisted blocks.
 *
 * `MessageBlock` is a strict discriminated union, and oRPC validates handler
 * output — so a single block written by a newer build makes `threads.get` and
 * `threads.messages` fail for the *entire page*, not just that block. That is
 * not hypothetical: a rollback, a mixed-version deploy, or a self-hosted API
 * lagging its database all produce it. Reading through this schema degrades an
 * unknown or malformed block to a `meta` line carrying its `summary` when it
 * has one, so one strange block costs one line rather than the thread.
 *
 * Emitters keep using `MessageBlock` and stay strict; nothing here excuses
 * writing a block that does not validate.
 */
export const StoredMessageBlock = MessageBlock.catch((ctx) => {
  const value = ctx.value;
  const summary =
    value &&
    typeof value === "object" &&
    typeof (value as { summary?: unknown }).summary === "string"
      ? ((value as { summary: string }).summary.slice(0, TOOL_CARD_SUMMARY_MAX_LENGTH) as string)
      : "";
  return { kind: "meta" as const, text: summary || UNSUPPORTED_BLOCK_TEXT };
});

export const ProductEventSchema = z.object({
  id: Id,
  spaceId: Id,
  threadId: Id,
  botId: Id,
  seq: z.number().int().nonnegative(),
  type: ProductEventType,
  runId: Id.optional(),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type ProductEvent = z.infer<typeof ProductEventSchema>;

export const ThreadMessageSchema = z.object({
  id: Id,
  threadId: Id,
  seq: z.number().int().nonnegative(),
  role: MessageRole,
  // Read-side, so one block from a newer build cannot fail a whole page.
  blocks: z.array(StoredMessageBlock),
  botId: Id.optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().optional(),
  runId: Id.optional(),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export function canReactToThreadMessage(message: Pick<ThreadMessage, "id" | "blocks">): boolean {
  return (
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:") &&
    !message.blocks.some((block) => block.kind === "channel_message")
  );
}
