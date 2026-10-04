/**
 * Learning that moves thresholds rather than writing rules. Everything here is derived from
 * the owner's feedback on stored updates, so there is no second copy to keep in sync.
 */

const DAY = 86_400_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Linear fade from full strength to nothing over 14 days. */
const fade = (age: number) => clamp(1 - age / (14 * DAY), 0, 1);

export type FeedbackEvent = {
  feedback: string;
  at: Date;
  disposition: string | null;
};

const DECLINES = new Set(["not_important", "mute_sender"]);
const RATINGS = new Set(["not_important", "mute_sender", "important", "always_sender", "done"]);

/**
 * The owner's own shift of the interrupt threshold, in [−8, +10]: +5 while at least 3 of
 * the last 10 rated interrupts were declined, −3 after "tell me sooner" twice within 7 days;
 * both fade out over 14 days. `events` is newest first.
 */
export function thresholdOffset(events: FeedbackEvent[], now: Date): number {
  let offset = 0;
  const rated = events
    .filter((event) => event.disposition === "interrupt" && RATINGS.has(event.feedback))
    .slice(0, 10);
  const declined = rated.filter((event) => DECLINES.has(event.feedback));
  if (declined.length >= 3) offset += 5 * fade(now.getTime() - declined[0]!.at.getTime());
  const sooner = events.filter((event) => event.feedback === "important");
  if (sooner.length >= 2 && sooner[0]!.at.getTime() - sooner[1]!.at.getTime() <= 7 * DAY)
    offset -= 3 * fade(now.getTime() - sooner[0]!.at.getTime());
  return Math.round(clamp(offset, -8, 10) * 10) / 10;
}

/**
 * One sender's shift of the interrupt threshold within the 30-day learning window, in
 * [−10, +10]: each decline raises it by 5, each "important" lowers it by 5.
 */
export function senderShift(history: { important: number; notImportant: number }): number {
  return clamp(5 * history.notImportant - 5 * history.important, -10, 10);
}

/** A declined story stays quiet for 24 hours, then 7 days, then 30 days. Declines newest first. */
export function backoffUntil(declines: Date[]): Date | undefined {
  const latest = declines[0];
  if (!latest) return undefined;
  const window = [DAY, 7 * DAY, 30 * DAY][Math.min(declines.length, 3) - 1]!;
  return new Date(latest.getTime() + window);
}
