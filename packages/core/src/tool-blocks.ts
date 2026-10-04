import type {
  BrowserCardStatus,
  CardImageRef,
  FinanceCardCategory,
  FinanceCardTransaction,
  MessageBlock,
  PlanCardStatus,
  PlanCardStep,
} from "@rakazo/contracts";
import {
  ARTIFACT_NAME_MAX_LENGTH,
  MAX_FINANCE_CATEGORIES,
  MAX_FINANCE_TRANSACTIONS,
  MAX_PDF_FORM_FIELDS,
  MAX_PLAN_STEPS,
  TOOL_CARD_SUMMARY_MAX_LENGTH,
  TOOL_CARD_TEXT_MAX_LENGTH,
  TOOL_CARD_URL_MAX_LENGTH,
} from "@rakazo/contracts";

/**
 * Builders for the rich tool-result cards.
 *
 * These live in core rather than in the executor so the shapes can be tested
 * without a run, and so every emitter clamps identically. A card must never be
 * the reason a tool call fails: each builder truncates rather than throwing,
 * and every optional field is genuinely optional — a caller that knows less
 * emits less, and the renderer degrades.
 */

export type BrowserCardBlock = Extract<MessageBlock, { kind: "browser" }>;
export type MailCardBlock = Extract<MessageBlock, { kind: "mail" }>;
export type PdfCardBlock = Extract<MessageBlock, { kind: "pdf" }>;
export type PlanCardBlock = Extract<MessageBlock, { kind: "plan" }>;
export type FinanceCardBlock = Extract<MessageBlock, { kind: "finance" }>;

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function optionalClamp(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clamped = clamp(value, max);
  return clamped || undefined;
}

function summaryOf(value: string, fallback: string): string {
  return clamp(value, TOOL_CARD_SUMMARY_MAX_LENGTH) || fallback;
}

/* ------------------------------ browser ------------------------------ */

/** Hostname without `www.`, or a neutral label when the URL will not parse. */
export function browserCardSiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "a page";
  } catch {
    return "a page";
  }
}

export function browserCardSummary(input: {
  url: string;
  title?: string;
  status: BrowserCardStatus;
  error?: string;
}): string {
  const site = browserCardSiteLabel(input.url);
  if (input.status === "error") {
    const reason = input.error?.trim();
    return summaryOf(
      reason ? `Could not read ${site}: ${reason}` : `Could not read ${site}`,
      "Could not read the page",
    );
  }
  if (input.status === "loading") return summaryOf(`Opening ${site}`, "Opening a page");
  const title = input.title?.trim();
  return summaryOf(title ? `Read ${site} — ${title}` : `Read ${site}`, "Read a page");
}

export function browserCardBlock(input: {
  url: string;
  title?: string;
  status: BrowserCardStatus;
  screenshot?: CardImageRef;
  computerId?: string;
  error?: string;
  summary?: string;
}): BrowserCardBlock {
  const url = clamp(input.url, TOOL_CARD_URL_MAX_LENGTH);
  const title = optionalClamp(input.title, TOOL_CARD_SUMMARY_MAX_LENGTH);
  const error = optionalClamp(input.error, TOOL_CARD_TEXT_MAX_LENGTH);
  return {
    kind: "browser",
    summary:
      optionalClamp(input.summary, TOOL_CARD_SUMMARY_MAX_LENGTH) ??
      browserCardSummary({
        url,
        ...(title ? { title } : {}),
        status: input.status,
        ...(error ? { error } : {}),
      }),
    url,
    ...(title ? { title } : {}),
    status: input.status,
    ...(input.screenshot ? { screenshot: input.screenshot } : {}),
    ...(input.computerId ? { computerId: input.computerId } : {}),
    ...(error ? { error } : {}),
  };
}

/* -------------------------------- mail -------------------------------- */

export function mailSearchCardBlock(input: {
  query?: string;
  matchCount: number;
  truncated?: boolean;
  provider?: string;
}): MailCardBlock {
  const count = Math.max(0, Math.trunc(input.matchCount));
  const atLeast = input.truncated ? "at least " : "";
  const summary = count
    ? `Found ${atLeast}${count} ${count === 1 ? "email" : "emails"}`
    : "No matching emails";
  return {
    kind: "mail",
    summary,
    mode: "search",
    ...(optionalClamp(input.provider, 64) ? { provider: clamp(input.provider ?? "", 64) } : {}),
    ...(optionalClamp(input.query, TOOL_CARD_SUMMARY_MAX_LENGTH)
      ? { query: clamp(input.query ?? "", TOOL_CARD_SUMMARY_MAX_LENGTH) }
      : {}),
    matchCount: count,
    ...(input.truncated ? { truncated: true } : {}),
  };
}

export function mailThreadCardBlock(input: {
  subject?: string;
  sender?: string;
  excerpt?: string;
  threadId?: string;
  messageCount?: number;
  receivedAt?: string;
  unread?: boolean;
  attachmentCount?: number;
  truncated?: boolean;
  provider?: string;
  openUrl?: string;
}): MailCardBlock {
  const subject = optionalClamp(input.subject, TOOL_CARD_SUMMARY_MAX_LENGTH);
  const sender = optionalClamp(input.sender, TOOL_CARD_SUMMARY_MAX_LENGTH);
  const summary = summaryOf(
    [subject ?? "Email", sender ? `from ${sender}` : ""].filter(Boolean).join(" "),
    "Read an email",
  );
  const messageCount =
    typeof input.messageCount === "number" && input.messageCount > 0
      ? Math.trunc(input.messageCount)
      : undefined;
  const attachmentCount =
    typeof input.attachmentCount === "number" && input.attachmentCount >= 0
      ? Math.trunc(input.attachmentCount)
      : undefined;
  return {
    kind: "mail",
    summary,
    mode: "thread",
    ...(optionalClamp(input.provider, 64) ? { provider: clamp(input.provider ?? "", 64) } : {}),
    ...(optionalClamp(input.threadId, 256) ? { threadId: clamp(input.threadId ?? "", 256) } : {}),
    ...(messageCount ? { messageCount } : {}),
    ...(subject ? { subject } : {}),
    ...(sender ? { sender } : {}),
    ...(optionalClamp(input.excerpt, TOOL_CARD_TEXT_MAX_LENGTH)
      ? { excerpt: clamp(input.excerpt ?? "", TOOL_CARD_TEXT_MAX_LENGTH) }
      : {}),
    ...(optionalClamp(input.receivedAt, 64)
      ? { receivedAt: clamp(input.receivedAt ?? "", 64) }
      : {}),
    ...(input.unread ? { unread: true } : {}),
    ...(attachmentCount ? { attachmentCount } : {}),
    ...(input.truncated ? { truncated: true } : {}),
    ...(optionalClamp(input.openUrl, TOOL_CARD_URL_MAX_LENGTH)
      ? { openUrl: clamp(input.openUrl ?? "", TOOL_CARD_URL_MAX_LENGTH) }
      : {}),
  };
}

/* --------------------------------- pdf --------------------------------- */

export function pdfCardBlock(input: {
  artifactId: string;
  name: string;
  mimeType: string;
  size: number;
  pageCount?: number;
  previewImage?: CardImageRef;
  fields?: readonly { name: string; value: string; type: "text" | "checkbox" | "unsupported" }[];
}): PdfCardBlock {
  const name = clamp(input.name, ARTIFACT_NAME_MAX_LENGTH) || "document.pdf";
  const pageCount =
    typeof input.pageCount === "number" && input.pageCount > 0
      ? Math.trunc(input.pageCount)
      : undefined;
  const fields = input.fields?.slice(0, MAX_PDF_FORM_FIELDS).map((field) => ({
    name: clamp(field.name, 200),
    value: clamp(field.value, TOOL_CARD_SUMMARY_MAX_LENGTH),
    type: field.type,
  }));
  const summary = summaryOf(
    pageCount ? `${name} — ${pageCount} ${pageCount === 1 ? "page" : "pages"}` : name,
    "A document",
  );
  return {
    kind: "pdf",
    summary,
    artifactId: input.artifactId,
    mimeType: clamp(input.mimeType, 128) || "application/pdf",
    name,
    size: Math.max(0, Math.trunc(input.size)),
    ...(pageCount ? { pageCount } : {}),
    ...(input.previewImage ? { previewImage: input.previewImage } : {}),
    ...(fields?.length ? { fields } : {}),
  };
}

/* --------------------------------- plan -------------------------------- */

/** Derived, never stored: a card cannot disagree with its own step list. */
export function planCardProgress(steps: readonly PlanCardStep[]): { done: number; total: number } {
  return {
    done: steps.filter((step) => step.status === "done" || step.status === "skipped").length,
    total: steps.length,
  };
}

const PLAN_STATUS_LABEL: Record<PlanCardStatus, string> = {
  queued: "Queued",
  running: "Working",
  waiting_input: "Needs your input",
  waiting_approval: "Ready to review",
  scheduled: "Scheduled",
  paused: "Paused",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function planCardStatusLabel(status: PlanCardStatus): string {
  return PLAN_STATUS_LABEL[status];
}

export function planCardBlock(input: {
  title: string;
  status: PlanCardStatus;
  steps: readonly PlanCardStep[];
  note?: string;
  runId?: string;
  summary?: string;
}): PlanCardBlock {
  const title = clamp(input.title, TOOL_CARD_SUMMARY_MAX_LENGTH) || "Plan";
  const steps = input.steps.slice(0, MAX_PLAN_STEPS).map((step) => ({
    ...(step.id ? { id: clamp(step.id, 128) } : {}),
    title: clamp(step.title, TOOL_CARD_SUMMARY_MAX_LENGTH) || "Step",
    status: step.status,
    ...(optionalClamp(step.detail, TOOL_CARD_TEXT_MAX_LENGTH)
      ? { detail: clamp(step.detail ?? "", TOOL_CARD_TEXT_MAX_LENGTH) }
      : {}),
  }));
  const { done, total } = planCardProgress(steps);
  const summary =
    optionalClamp(input.summary, TOOL_CARD_SUMMARY_MAX_LENGTH) ??
    summaryOf(
      total
        ? `${title} — ${planCardStatusLabel(input.status)} · ${done}/${total} steps`
        : `${title} — ${planCardStatusLabel(input.status)}`,
      "A plan",
    );
  return {
    kind: "plan",
    summary,
    title,
    status: input.status,
    steps,
    ...(optionalClamp(input.note, TOOL_CARD_TEXT_MAX_LENGTH)
      ? { note: clamp(input.note ?? "", TOOL_CARD_TEXT_MAX_LENGTH) }
      : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  };
}

/* ------------------------------- finance ------------------------------- */

function financeAmount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function financeCardBlock(input: {
  title: string;
  income: number;
  spending: number;
  saved: number;
  categories: readonly FinanceCardCategory[];
  transactions?: readonly FinanceCardTransaction[];
  transactionCount?: number;
  currency?: string;
  period?: { from: string; to: string };
  artifactId?: string;
  summary?: string;
}): FinanceCardBlock {
  const title = clamp(input.title, TOOL_CARD_SUMMARY_MAX_LENGTH) || "Finance summary";
  const categories = input.categories.slice(0, MAX_FINANCE_CATEGORIES).map((category) => ({
    name: clamp(category.name, 120) || "Other",
    amount: financeAmount(category.amount),
  }));
  const transactions = input.transactions?.slice(0, MAX_FINANCE_TRANSACTIONS).map((row) => ({
    ...(row.id ? { id: clamp(row.id, 128) } : {}),
    date: clamp(row.date, 64),
    description: clamp(row.description, 280),
    ...(optionalClamp(row.category, 120) ? { category: clamp(row.category ?? "", 120) } : {}),
    amount: financeAmount(row.amount),
  }));
  const spending = financeAmount(input.spending);
  const saved = financeAmount(input.saved);
  const currency = input.currency?.trim().toUpperCase();
  const unit = currency && currency.length === 3 ? ` ${currency}` : "";
  const summary =
    optionalClamp(input.summary, TOOL_CARD_SUMMARY_MAX_LENGTH) ??
    summaryOf(
      `${title} — spent ${spending.toFixed(2)}${unit}, ${saved >= 0 ? "kept" : "short"} ${Math.abs(saved).toFixed(2)}${unit}`,
      "A spending summary",
    );
  return {
    kind: "finance",
    summary,
    title,
    ...(unit ? { currency } : {}),
    ...(input.period
      ? { period: { from: clamp(input.period.from, 64), to: clamp(input.period.to, 64) } }
      : {}),
    income: financeAmount(input.income),
    spending,
    saved,
    categories,
    ...(transactions?.length ? { transactions } : {}),
    ...(typeof input.transactionCount === "number" && input.transactionCount >= 0
      ? { transactionCount: Math.trunc(input.transactionCount) }
      : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
  };
}

/* ------------------------------- summaries ------------------------------ */

// Radar `update` and `brief` cards carry a summary too, so history and speech keep them.
const CARD_KINDS = new Set(["browser", "mail", "pdf", "plan", "finance", "update", "brief"]);

export function isToolCardBlock(
  block: MessageBlock,
): block is
  | BrowserCardBlock
  | MailCardBlock
  | PdfCardBlock
  | PlanCardBlock
  | FinanceCardBlock
  | Extract<MessageBlock, { kind: "update" | "brief" }> {
  return CARD_KINDS.has(block.kind);
}

/**
 * The one-line stand-in for a block: what a notification body, a transcript
 * line, a speech reader or a renderer that does not know the kind should say.
 * Returns "" when the block carries no user-facing words of its own.
 */
export function toolCardSummary(block: MessageBlock): string {
  return isToolCardBlock(block) ? block.summary : "";
}
