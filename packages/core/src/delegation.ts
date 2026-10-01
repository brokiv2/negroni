/**
 * A delegated task is the request one bot sends another with message_bot. Its record
 * lives on the assignee's Task row and owns the lifecycle the requester sees:
 *
 *   queued -> working -> reviewing -> completed
 *                    \-> needs_input | failed | cancelled | superseded
 *
 * A child's result never completes the task by itself: the requester must review it
 * first, and completion is refused unless a review outcome is stored.
 */

export const DELEGATION_MAX_RUNS = 8;
export const DELEGATION_DEADLINE_MS = 24 * 60 * 60_000;
/** Review runs allowed after the first one produced no usable review. */
export const DELEGATION_REVIEW_RETRIES = 1;
/** Placeholder the executor posts when a delegated run wrote nothing. Never a result. */
export const DELEGATED_NO_RESULT_TEXT =
  "The delegated bot completed its turn without a written summary.";
/** Runtime stand-ins for a missing model answer; they are not content either. */
export const MODEL_NO_ANSWER_TEXT = "The model returned no answer. Please try again.";
export const TOOL_STEP_NO_FINAL_TEXT =
  "I completed the tool step but could not produce a final response. Please ask me to continue.";

export function isPlaceholderResultText(text: string): boolean {
  const trimmed = text.trim();
  return (
    !trimmed ||
    trimmed === DELEGATED_NO_RESULT_TEXT ||
    trimmed === MODEL_NO_ANSWER_TEXT ||
    trimmed === TOOL_STEP_NO_FINAL_TEXT
  );
}

export const DELEGATION_READ_TOOLS = new Set([
  "read_file",
  "web_fetch",
  "browser_snapshot",
  "computer_observe",
]);

export type DelegationState =
  | "queued"
  | "working"
  | "reviewing"
  | "completed"
  | "needs_input"
  | "failed"
  | "cancelled"
  | "superseded";

export const DELEGATION_ACTIVE_STATES: readonly DelegationState[] = [
  "queued",
  "working",
  "reviewing",
  "needs_input",
];
const TERMINAL: readonly DelegationState[] = ["completed", "failed", "cancelled", "superseded"];

const TRANSITIONS: Record<DelegationState, readonly DelegationState[]> = {
  queued: ["working", "reviewing", "failed", "cancelled", "superseded"],
  working: ["reviewing", "failed", "cancelled", "superseded"],
  needs_input: ["working", "reviewing", "failed", "cancelled", "superseded"],
  reviewing: ["completed", "needs_input", "failed", "cancelled", "superseded"],
  completed: [],
  failed: [],
  cancelled: [],
  superseded: [],
};

export interface DelegationCheck {
  name: "result_present" | "substantive" | "terminal_result" | "sources_cited" | "source_reads";
  passed: boolean;
  detail: string;
}

export type DelegationReviewOutcome = "verified" | "partial" | "blocked" | "incomplete";

export interface DelegationReview {
  taskRef: string;
  outcome: DelegationReviewOutcome;
  summary: string;
  evidenceRefs: string[];
  checks: DelegationCheck[];
  limitations: string[];
  reviewRunId: string | null;
  reviewedAt: string;
}

export interface DelegationChildOutcome {
  intent: "result" | "blocker";
  /** The child run ended in failure, so nothing more will come from it. */
  failed?: boolean;
  text: string;
  messageId: string;
  childRunId: string;
  /** Successful read tool calls in the child run (files, pages, screens). */
  readCount: number;
  receivedAt: string;
}

export interface DelegationRecord {
  kind: "delegation";
  state: DelegationState;
  assignment: string;
  sources: string[];
  requester: {
    botId: string;
    threadId: string;
    runId: string;
    requestMessageId: string;
    sourceMessageId: string | null;
  };
  assigneeBotId: string;
  parentTaskRef?: string;
  supersededBy?: string;
  budget: { maxRuns: number; usedRuns: number };
  deadline: string;
  reviewAttempts: number;
  /** Requester tasks created to review this one, oldest first. */
  reviewTaskIds?: string[];
  outcome?: DelegationChildOutcome;
  lastStatus?: { text: string; at: string };
  checks?: DelegationCheck[];
  review?: DelegationReview;
  stopReason?: string;
  history: Array<{ state: DelegationState; at: string; reason?: string }>;
  createdAt: string;
  updatedAt: string;
}

/** Stored on a requester's review task so the run knows which delegation it reviews. */
export interface DelegationReviewPointer {
  kind: "review";
  taskRef: string;
  attempt: number;
}

export type TaskDelegation = DelegationRecord | DelegationReviewPointer;

export function parseTaskDelegation(value: unknown): TaskDelegation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { kind?: unknown; state?: unknown; taskRef?: unknown };
  if (record.kind === "review" && typeof record.taskRef === "string")
    return value as DelegationReviewPointer;
  if (
    record.kind === "delegation" &&
    typeof record.state === "string" &&
    record.state in TRANSITIONS
  )
    return value as DelegationRecord;
  return null;
}

export function delegationRecord(value: unknown): DelegationRecord | null {
  const parsed = parseTaskDelegation(value);
  return parsed?.kind === "delegation" ? parsed : null;
}

export function delegationReviewPointer(value: unknown): DelegationReviewPointer | null {
  const parsed = parseTaskDelegation(value);
  return parsed?.kind === "review" ? parsed : null;
}

export function isDelegationActive(record: DelegationRecord): boolean {
  return DELEGATION_ACTIVE_STATES.includes(record.state);
}

export function createDelegationRecord(input: {
  assignment: string;
  sources?: readonly string[];
  requester: DelegationRecord["requester"];
  assigneeBotId: string;
  now: Date;
  parent?: DelegationRecord & { taskRef: string };
}): DelegationRecord {
  const at = input.now.toISOString();
  const parent = input.parent;
  return {
    kind: "delegation",
    state: "queued",
    assignment: input.assignment,
    sources: normalizeSources(input.sources ?? []),
    requester: input.requester,
    assigneeBotId: input.assigneeBotId,
    ...(parent ? { parentTaskRef: parent.taskRef } : {}),
    // A rework continues the parent's allowance; a fresh task counts the requester's
    // dispatching run and the child's first run.
    budget: parent
      ? { maxRuns: parent.budget.maxRuns, usedRuns: parent.budget.usedRuns + 1 }
      : { maxRuns: DELEGATION_MAX_RUNS, usedRuns: 2 },
    deadline:
      parent?.deadline ?? new Date(input.now.getTime() + DELEGATION_DEADLINE_MS).toISOString(),
    reviewAttempts: 0,
    history: [{ state: "queued", at }],
    createdAt: at,
    updatedAt: at,
  };
}

export function normalizeSources(sources: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    if (typeof source !== "string") continue;
    const trimmed = source.trim().slice(0, 500);
    if (trimmed) seen.add(trimmed);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

/** Why another run may not start for this task, checked before every dispatch. */
export function delegationStopReason(
  record: DelegationRecord,
  now: Date,
): "budget_exhausted" | "deadline_passed" | "closed" | null {
  if (!isDelegationActive(record)) return "closed";
  if (new Date(record.deadline).getTime() <= now.getTime()) return "deadline_passed";
  if (record.budget.usedRuns >= record.budget.maxRuns) return "budget_exhausted";
  return null;
}

export function chargeDelegationRun(record: DelegationRecord, now: Date): DelegationRecord {
  return {
    ...record,
    budget: { ...record.budget, usedRuns: record.budget.usedRuns + 1 },
    updatedAt: now.toISOString(),
  };
}

export function transitionDelegation(
  record: DelegationRecord,
  to: DelegationState,
  now: Date,
  reason?: string,
): DelegationRecord {
  if (record.state === to) return record;
  if (!TRANSITIONS[record.state].includes(to)) {
    throw new Error(`Delegated task cannot move from ${record.state} to ${to}`);
  }
  if (to === "completed" && !record.review?.reviewedAt) {
    throw new Error("A delegated task completes only after its review is stored");
  }
  const at = now.toISOString();
  return {
    ...record,
    state: to,
    ...(TERMINAL.includes(to) && reason ? { stopReason: reason } : {}),
    history: [...record.history, { state: to, at, ...(reason ? { reason } : {}) }].slice(-30),
    updatedAt: at,
  };
}

const BARE_COMPLETION =
  /^(?:(?:it'?s|all|task|work|everything)\s+)?(?:done|finished|completed?|complete|ok(?:ay)?|ready|готово|сделано|выполнено|закончил[аи]?)[.!\s]*$/iu;

function sourceIsCited(text: string, source: string): boolean {
  const lower = text.toLowerCase();
  const needle = source.toLowerCase();
  if (lower.includes(needle)) return true;
  const base = needle.split(/[\\/]/).filter(Boolean).at(-1);
  return Boolean(base && base.length >= 3 && lower.includes(base));
}

/**
 * Checks the code can make without a model. They prove presence and references, not
 * that every claim is true; the review prompt says so and the limitations record it.
 */
export function delegationResultChecks(input: {
  intent: "result" | "blocker";
  text: string;
  sources: readonly string[];
  readCount: number;
}): DelegationCheck[] {
  const text = input.text.trim();
  const present = !isPlaceholderResultText(text);
  const checks: DelegationCheck[] = [
    {
      name: "terminal_result",
      passed: input.intent === "result",
      detail:
        input.intent === "result"
          ? "The specialist returned a result."
          : "The specialist reported a blocker instead of a result.",
    },
    {
      name: "result_present",
      passed: present,
      detail: present ? "The result has written content." : "The result is empty.",
    },
    {
      name: "substantive",
      passed: present && !BARE_COMPLETION.test(text),
      detail:
        present && !BARE_COMPLETION.test(text)
          ? "The result contains more than a completion claim."
          : "The result only claims completion without content.",
    },
  ];
  if (input.sources.length > 0) {
    const missing = input.sources.filter((source) => !sourceIsCited(text, source));
    checks.push({
      name: "sources_cited",
      passed: present && missing.length === 0,
      detail:
        missing.length === 0
          ? "Every requested source is referenced."
          : `Not referenced: ${missing.join(", ")}.`,
    });
    checks.push({
      name: "source_reads",
      passed: input.readCount >= input.sources.length,
      detail: `${input.readCount} successful read(s) for ${input.sources.length} requested source(s).`,
    });
  }
  return checks;
}

export function delegationReview(input: {
  taskRef: string;
  record: DelegationRecord;
  summary: string;
  reviewRunId: string | null;
  now: Date;
}): DelegationReview {
  const checks = input.record.checks ?? [];
  const outcome = input.record.outcome;
  const failed = checks.filter((check) => !check.passed);
  const summary = isPlaceholderResultText(input.summary) ? "" : input.summary.trim();
  const limitations = [
    ...failed.map((check) => check.detail),
    ...(input.record.sources.length === 0
      ? ["No sources were named for this task."]
      : ["Reads were counted, not matched to each requested source."]),
    "Claims inside the result were assessed by the reviewing model, not proven by code.",
  ];
  const reviewOutcome: DelegationReviewOutcome = !summary
    ? "incomplete"
    : outcome?.intent === "blocker"
      ? "blocked"
      : failed.length === 0
        ? "verified"
        : "partial";
  return {
    taskRef: input.taskRef,
    outcome: reviewOutcome,
    summary: summary.slice(0, 4_000),
    evidenceRefs: [
      ...(outcome ? [`run:${outcome.childRunId}`, `message:${outcome.messageId}`] : []),
      ...input.record.sources.map((source) => `source:${source}`),
    ],
    checks,
    limitations: summary ? limitations : ["The review produced no answer.", ...limitations],
    reviewRunId: input.reviewRunId,
    reviewedAt: input.now.toISOString(),
  };
}

/** The state a reviewed task settles in. A blocker review leaves it open for the user. */
export function stateAfterReview(record: DelegationRecord): DelegationState {
  if (record.outcome?.intent !== "blocker") return "completed";
  return record.outcome.failed ? "failed" : "needs_input";
}

export type DelegationStopReason =
  | "budget_exhausted"
  | "deadline_passed"
  | "review_incomplete"
  | "child_cancelled"
  | "review_cancelled";

/** One short line for the requester's chat when a task stops without a reviewed answer. */
export function delegationStopNotice(
  record: DelegationRecord,
  reason: DelegationStopReason,
): string {
  const firstLine = record.assignment.trim().split("\n")[0] ?? "";
  const excerpt = firstLine.length > 80 ? `${firstLine.slice(0, 79).trimEnd()}…` : firstLine;
  const task = excerpt ? `"${excerpt}"` : "the delegated task";
  switch (reason) {
    case "budget_exhausted":
      return `I stopped ${task} before reviewing its result: it reached its run limit.`;
    case "deadline_passed":
      return `I stopped ${task} before reviewing its result: its deadline passed.`;
    case "review_incomplete":
      return `I couldn't review the result of ${task}, so it isn't marked done.`;
    case "child_cancelled":
    case "review_cancelled":
      return `${task} was cancelled before it was reviewed.`;
  }
}
