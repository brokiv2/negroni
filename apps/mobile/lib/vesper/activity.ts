import type { MessageBlock, RunActivityRow } from "@rakazo/contracts";
import { t } from "../i18n";
export { approvalNotes, approvalRows } from "./approvals";

/**
 * Activity: what the agent is doing, what it decided, what it is waiting on.
 *
 * Every shape here is derived from what Negroni already streams — `runs.list`
 * for the durable run rows, the thread's own messages for the plan, the timeline
 * and the approvals. Nothing is polled and nothing is invented: a run with no
 * plan block simply has no plan.
 */

/** Message shape this module reads. Structural on purpose, so it stays testable. */
export type ActivityMessage = {
  id: string;
  runId?: string;
  role: "user" | "bot" | "system";
  createdAt?: string;
  blocks: MessageBlock[];
};

export const RUNNING_RUN_STATUSES = [
  "queued",
  "leased",
  "running",
  "waiting_input",
  "waiting_takeover",
] as const;

export function isRunRunning(status: RunActivityRow["status"]): boolean {
  return (RUNNING_RUN_STATUSES as readonly string[]).includes(status);
}

/** A run that has stopped and is waiting for a person, not for a machine. */
export function runNeedsYou(status: RunActivityRow["status"]): boolean {
  return status === "waiting_input" || status === "waiting_takeover";
}

export const VESPER_ACTIVITY_FILTERS = ["all", "running", "finished"] as const;

export type VesperActivityFilter = (typeof VESPER_ACTIVITY_FILTERS)[number];

export function activityFilterLabel(filter: VesperActivityFilter): string {
  switch (filter) {
    case "all":
      return t("All");
    case "running":
      return t("In progress");
    case "finished":
      return t("Finished");
  }
}

/** Active rows win over recent ones for the same run, newest first. */
export function mergeActivityRuns(
  active: readonly RunActivityRow[],
  recent: readonly RunActivityRow[],
): RunActivityRow[] {
  const byId = new Map<string, RunActivityRow>();
  for (const run of recent) byId.set(run.runId, run);
  for (const run of active) byId.set(run.runId, run);
  return [...byId.values()].sort((left, right) => {
    const needs = Number(runNeedsYou(right.status)) - Number(runNeedsYou(left.status));
    if (needs !== 0) return needs;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function filterActivityRuns(
  runs: readonly RunActivityRow[],
  filter: VesperActivityFilter,
): RunActivityRow[] {
  if (filter === "all") return [...runs];
  const wantRunning = filter === "running";
  return runs.filter((run) => isRunRunning(run.status) === wantRunning);
}

/** What the bell counts: runs stopped and waiting on the person. Keep in sync with the header. */
export function runsAwaitingPerson(runs: readonly RunActivityRow[]): RunActivityRow[] {
  return runs.filter((run) => runNeedsYou(run.status));
}

export type VesperRunPlan = {
  title: string;
  /** `plan` carries per-step status; `steps` only coalesces a turn's tool calls. */
  steps: Array<{ label: string; done: boolean; active: boolean; failed: boolean }>;
  done: number;
  total: number;
  note?: string;
};

/** `PlanCardStepStatus`: pending | running | waiting | done | failed | skipped. */
const PLAN_DONE_STATUSES = new Set(["done", "skipped"]);
const PLAN_ACTIVE_STATUSES = new Set(["running", "waiting"]);
const PLAN_FAILED_STATUSES = new Set(["failed"]);

/**
 * The plan for one run.
 *
 * A `plan` block outlives its turn and carries per-step status, so it wins. A
 * `steps` block is the fallback: it knows the labels but not which one is
 * current, so every step reads as done — it only ever appears after the fact.
 */
export function planForRun(
  messages: readonly ActivityMessage[],
  runId: string,
): VesperRunPlan | null {
  let fallback: VesperRunPlan | null = null;
  for (const message of messages) {
    if (message.runId !== runId) continue;
    for (const block of message.blocks) {
      if (block.kind === "plan") {
        const steps = block.steps.map((step) => ({
          label: step.title,
          done: PLAN_DONE_STATUSES.has(step.status),
          active: PLAN_ACTIVE_STATUSES.has(step.status),
          failed: PLAN_FAILED_STATUSES.has(step.status),
        }));
        // Last plan block wins: a plan is updated in place across the run.
        fallback = {
          title: block.title,
          steps,
          done: steps.filter((step) => step.done).length,
          total: steps.length,
          ...(block.note ? { note: block.note } : {}),
        };
      } else if (block.kind === "steps" && !fallback) {
        const steps = block.steps.map((step) => ({
          label: step.count > 1 ? `${step.label} ×${step.count}` : step.label,
          done: true,
          active: false,
          failed: false,
        }));
        fallback = {
          title: t("What it did"),
          steps,
          done: steps.length,
          total: steps.length,
        };
      }
    }
  }
  return fallback;
}

/** 0–1, or null when there is nothing to measure. A bar at zero reads as stuck. */
export function planFraction(plan: VesperRunPlan | null): number | null {
  if (!plan || plan.total === 0) return null;
  return plan.done / plan.total;
}

export type ActivityAsk = { messageId: string; runId: string; block: MessageBlock };

/** Unanswered `ask` blocks, newest last, with the run they belong to. */
export function pendingAsks(messages: readonly ActivityMessage[]): ActivityAsk[] {
  const asks: ActivityAsk[] = [];
  for (const message of messages) {
    if (!message.runId) continue;
    for (const block of message.blocks) {
      if (block.kind !== "ask") continue;
      if (block.status === "answered") continue;
      asks.push({ messageId: message.id, runId: message.runId, block });
    }
  }
  return asks;
}

/** Only the ones that gate a real-world action, not a plain question. */
export function pendingApprovals(messages: readonly ActivityMessage[]): ActivityAsk[] {
  return pendingAsks(messages).filter(
    (ask) => ask.block.kind === "ask" && !!ask.block.approvalEffectId,
  );
}

export type TimelineEntry = { id: string; text: string; createdAt?: string };

const TIMELINE_MAX = 40;

/**
 * What happened during a run, in order. Progress narration and meta lines are
 * the record; the transcript's prose answer is shown as the result instead.
 */
export function runTimeline(messages: readonly ActivityMessage[], runId: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const message of messages) {
    if (message.runId !== runId) continue;
    for (const [index, block] of message.blocks.entries()) {
      const text =
        block.kind === "progress" || block.kind === "meta"
          ? block.text
          : block.kind === "computer"
            ? block.text || block.state
            : "summary" in block && typeof block.summary === "string"
              ? block.summary
              : "";
      if (!text.trim()) continue;
      entries.push({
        id: `${message.id}:${index}`,
        text: text.trim(),
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      });
    }
  }
  return entries.slice(-TIMELINE_MAX);
}

/** The assistant's last prose reply in a run — its answer, not its narration. */
export function runResult(messages: readonly ActivityMessage[], runId: string): string | null {
  let result: string | null = null;
  for (const message of messages) {
    if (message.runId !== runId || message.role !== "bot") continue;
    for (const block of message.blocks) {
      if (block.kind === "text" && block.text.trim()) result = block.text.trim();
    }
  }
  return result;
}

/** Receipts belonging to one run, newest first. */
export function receiptsForRun<T extends { runId: string }>(
  receipts: readonly T[],
  runId: string,
): T[] {
  return receipts.filter((receipt) => receipt.runId === runId);
}

export function effectStatusLabel(status: string): string {
  switch (status) {
    case "intended":
      return t("Waiting to run");
    case "executing":
      return t("Running");
    case "succeeded":
      return t("Done");
    case "failed":
      return t("Failed");
    case "abandoned":
      return t("Abandoned");
    default:
      return status;
  }
}

export function reviewDecisionLabel(decision: string | null): string | null {
  switch (decision) {
    case null:
      return null;
    case "pass":
      return t("Checked and allowed");
    case "ask":
      return t("Sent to you to approve");
    case "block":
      return t("Blocked");
    case "allow":
      return t("You allowed it");
    case "deny":
      return t("You declined it");
    default:
      return decision;
  }
}

/** Tool name as a person would read it: `gmail_send_email` → `Gmail send email`. */
export function effectKindLabel(kind: string): string {
  const words = kind.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return kind;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
