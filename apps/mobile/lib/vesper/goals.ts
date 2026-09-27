import type { Routine, ScratchpadItem } from "@rakazo/contracts";
import { cronFromPreset, presetFromCron } from "@rakazo/core";
import { t } from "../i18n";

/**
 * Goals and Tracking, derived from what Negroni actually stores.
 *
 * A goal is a `ScratchpadItem` with `status: "open"` (done once it is `"done"`,
 * parked into Ideas once it is `"parked"`) — the convention the personal
 * workspace already uses. Tracking is a `Routine`: a cron-scheduled prompt that
 * reports into the assistant's thread.
 *
 * `ScratchpadItem` carries `{id, botId, title, status, notes}` and nothing more,
 * so there are no milestones, no category and no goal-to-run link here. Those
 * need schema (spec task 37) and are deliberately absent rather than faked.
 */

/** Newest first, de-duplicated by id — the hierarchy fanout can return the same row twice. */
export function sortScratchpadItems(items: readonly ScratchpadItem[]): ScratchpadItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function goalItems(items: readonly ScratchpadItem[]): ScratchpadItem[] {
  return sortScratchpadItems(items.filter((item) => item.status === "open"));
}

export function completedGoalItems(items: readonly ScratchpadItem[]): ScratchpadItem[] {
  return sortScratchpadItems(items.filter((item) => item.status === "done"));
}

export function goalStatusLabel(status: ScratchpadItem["status"]): string {
  switch (status) {
    case "open":
      return t("In progress");
    case "done":
      return t("Complete");
    case "parked":
      return t("Parked");
  }
}

/**
 * The message that asks the assistant to break a goal down.
 *
 * There is no plan DTO and no goal-to-run link, so "Plan next steps" is a
 * message in the Personal thread, not a typed delegation.
 */
export function goalPlanPrompt(goal: Pick<ScratchpadItem, "title" | "notes">): string {
  const notes = goal.notes.trim();
  const opening = t("Help me make progress on this goal: {title}", { title: goal.title.trim() });
  if (!notes) return `${opening}\n\n${t("Suggest the next three concrete steps.")}`;
  return `${opening}\n\n${t("What I have written down so far:")}\n${notes}\n\n${t(
    "Suggest the next three concrete steps.",
  )}`;
}

/** The four starting points the reference design offers. Category is not persisted. */
export type VesperGoalCategory = "health" | "relationships" | "finances" | "other";

export const VESPER_GOAL_CATEGORIES: readonly VesperGoalCategory[] = [
  "health",
  "relationships",
  "finances",
  "other",
] as const;

export function goalCategoryLabel(category: VesperGoalCategory): string {
  switch (category) {
    case "health":
      return t("Health");
    case "relationships":
      return t("Relationships");
    case "finances":
      return t("Finances");
    case "other":
      return t("Something else");
  }
}

/** A starting placeholder, since the category itself has nowhere to live. */
export function goalCategoryPlaceholder(category: VesperGoalCategory): string {
  switch (category) {
    case "health":
      return t("Walk 8,000 steps every weekday");
    case "relationships":
      return t("Call my parents every Sunday");
    case "finances":
      return t("Build a three-month emergency fund");
    case "other":
      return t("Finish the first draft");
  }
}

/* ---------------------------------------------------------------- tracking */

/**
 * The schedules Vesper offers when you start tracking something.
 *
 * A free-form "every N minutes" box produces crons that are wrong above 59
 * (a 90-minute step never fires at 90-minute spacing), so the choice is a small
 * set of schedules that all map to a valid cron. Anything stranger, made in
 * Negroni, still renders correctly through `trackingScheduleLabel`.
 */
export const VESPER_TRACKING_FREQUENCIES = [
  "quarter-hourly",
  "hourly",
  "daily",
  "weekdays",
  "weekly",
] as const;

export type VesperTrackingFrequency = (typeof VESPER_TRACKING_FREQUENCIES)[number];

export const DEFAULT_TRACKING_FREQUENCY: VesperTrackingFrequency = "hourly";

export function trackingFrequencyLabel(frequency: VesperTrackingFrequency): string {
  switch (frequency) {
    case "quarter-hourly":
      return t("Every 15 minutes");
    case "hourly":
      return t("Every hour");
    case "daily":
      return t("Every day");
    case "weekdays":
      return t("Weekdays");
    case "weekly":
      return t("Every week");
  }
}

export function cronForTrackingFrequency(frequency: VesperTrackingFrequency): string {
  switch (frequency) {
    case "quarter-hourly":
      return cronFromPreset({ freq: "Interval", n: 15, unit: "minutes" });
    case "hourly":
      return cronFromPreset({ freq: "Every hour" });
    case "daily":
      return cronFromPreset({ freq: "Every day", time: "9:00 AM" });
    case "weekdays":
      return cronFromPreset({ freq: "Weekdays", time: "9:00 AM" });
    case "weekly":
      return cronFromPreset({ freq: "Every week", time: "9:00 AM" });
  }
}

/** Active first, then by name — a paused check should not sit above a live one. */
export function trackingRoutines(routines: readonly Routine[]): Routine[] {
  return [...new Map(routines.map((routine) => [routine.id, routine])).values()].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** One line under a tracking row: how often it looks, or that it is paused. */
export function trackingScheduleLabel(routine: Pick<Routine, "active" | "crons">): string {
  if (!routine.active) return t("Paused");
  const cron = routine.crons[0];
  if (!cron) return t("No schedule yet");
  const preset = presetFromCron(cron);
  switch (preset.freq) {
    case "Every hour":
      return t("Checking every hour");
    case "Interval":
      if (preset.unit === "hours") return t("Checking every {count} hours", { count: preset.n });
      if (preset.unit === "days") return t("Checking every {count} days", { count: preset.n });
      return t("Checking every {count} minutes", { count: preset.n });
    case "Weekdays":
      return t("Checking on weekdays at {time}", { time: preset.time });
    case "Every week":
      return t("Checking every Monday at {time}", { time: preset.time });
    case "Every month":
      return t("Checking on the 1st at {time}", { time: preset.time });
    case "Advanced":
      return t("Checking on a custom schedule");
    default:
      return t("Checking every day at {time}", { time: preset.time });
  }
}

/**
 * What the assistant is asked to do on every check.
 *
 * `Routine` has no url, condition or last-value column, so "tell me when this
 * page changes" is prompt semantics, not schema — including the ask not to
 * repeat an alert it has already sent.
 */
export function trackingPrompt(input: { watching: string; url?: string }): string {
  const watching = input.watching.trim();
  const url = input.url?.trim();
  const lines = [t("Check on this for me: {watching}", { watching })];
  if (url) lines.push(t("Look at {url}.", { url }));
  lines.push(
    t(
      "Tell me only when something has actually changed since your last check, and say what changed. If nothing has changed, say nothing.",
    ),
  );
  return lines.join("\n");
}

export function isTrackingUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
