import type { RunActivityRow } from "@rakazo/contracts";
import { t } from "../i18n";

/**
 * The one-line status under the assistant's name in the Vesper header.
 *
 * Composed client-side from the runs Negroni already streams — `runs.list` plus
 * the thread snapshot's run/activeRuns, refreshed off `run.*` events. No polling
 * loop: the caller subscribes and recomputes.
 */

export type VesperStatusRun = Pick<RunActivityRow, "status" | "promptSnippet">;

/** How loudly a run wants attention. Higher wins when several are active. */
const URGENCY: Record<string, number> = {
  waiting_input: 4,
  waiting_takeover: 3,
  running: 2,
  leased: 2,
  queued: 1,
};

function urgency(run: VesperStatusRun): number {
  return URGENCY[run.status] ?? 0;
}

/** The run the header should speak for, or null when nothing is active. */
export function leadingStatusRun(runs: readonly VesperStatusRun[]): VesperStatusRun | null {
  let leading: VesperStatusRun | null = null;
  for (const run of runs) {
    if (urgency(run) === 0) continue;
    if (!leading || urgency(run) > urgency(leading)) leading = run;
  }
  return leading;
}

const MAX_SNIPPET = 60;

/** Trim a prompt to one header-sized line without cutting mid-word where avoidable. */
export function statusSnippet(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_SNIPPET) return text;
  const clipped = text.slice(0, MAX_SNIPPET);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

export function vesperStatusLine(runs: readonly VesperStatusRun[]): string {
  const leading = leadingStatusRun(runs);
  if (!leading) return t("Here when you need me");
  const snippet = statusSnippet(leading.promptSnippet);
  switch (leading.status) {
    case "waiting_input":
      return snippet ? t("Needs your input · {task}", { task: snippet }) : t("Needs your input");
    case "waiting_takeover":
      return snippet
        ? t("Ready for you at the computer · {task}", { task: snippet })
        : t("Ready for you at the computer");
    case "queued":
      return t("Picking up your next task…");
    default:
      return snippet || t("Working on it…");
  }
}

/** True when the bell should show its unread dot. */
export function hasStatusAttention(runs: readonly VesperStatusRun[]): boolean {
  return runs.some((run) => run.status === "waiting_input" || run.status === "waiting_takeover");
}
