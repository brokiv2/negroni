import { RADAR_PAUSED_UNTIL_RESUMED } from "@rakazo/contracts";

/**
 * Wall-clock times in the Radar time zone. The API takes instants, so "this evening" and
 * "tomorrow 08:30" are resolved here, the same way the server's Radar clock resolves them.
 */

const HOUR_MS = 3_600_000;
/** Until this hour a "tomorrow morning" is still the coming one. */
const NIGHT_ENDS_AT = 5;
export const RADAR_EVENING = "19:00";
export const RADAR_MORNING = "08:30";
export const RADAR_PAUSE_MORNING = "08:00";

const pad = (value: number) => String(value).padStart(2, "0");

function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

/** How far the zone's wall clock is ahead of UTC at an instant. */
function zoneOffset(at: Date, timeZone: string): number {
  const wall = wallClock(at, timeZone);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
    Math.floor(at.getTime() / 1000) * 1000
  );
}

/** Calendar date ("YYYY-MM-DD") of an instant in a time zone. */
export function localDate(at: Date, timeZone: string): string {
  const wall = wallClock(at, timeZone);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The calendar date after `date`, both "YYYY-MM-DD". */
export function nextLocalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

/** The instant a local date and "HH:MM" occur in a time zone. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const first = wall - zoneOffset(new Date(wall), timeZone);
  return new Date(wall - zoneOffset(new Date(first), timeZone));
}

/** The coming morning at `time`: today's while it is still night, otherwise tomorrow's. */
export function nextMorning(time: string, timeZone: string, now: Date): Date {
  const today = localDate(now, timeZone);
  const tomorrow = zonedInstant(nextLocalDate(today), time, timeZone);
  if (wallClock(now, timeZone).hour >= NIGHT_ENDS_AT) return tomorrow;
  const tonight = zonedInstant(today, time, timeZone);
  return tonight.getTime() > now.getTime() ? tonight : tomorrow;
}

export type RadarLater = "hour" | "evening" | "morning";

/** Snooze choices in time order; this evening is offered only while it is more than an hour away. */
export function laterOptions(
  timeZone: string,
  now = new Date(),
): Array<{ key: RadarLater; until: Date }> {
  const hour = new Date(now.getTime() + HOUR_MS);
  const evening = zonedInstant(localDate(now, timeZone), RADAR_EVENING, timeZone);
  const options: Array<{ key: RadarLater; until: Date }> = [
    { key: "hour", until: hour },
    { key: "morning", until: nextMorning(RADAR_MORNING, timeZone, now) },
  ];
  if (evening.getTime() > hour.getTime()) options.push({ key: "evening", until: evening });
  return options.sort((a, b) => a.until.getTime() - b.until.getTime());
}

export type RadarPause = "hour" | "morning" | "resumed";

export function pauseUntil(pause: RadarPause, timeZone: string, now = new Date()): string {
  if (pause === "resumed") return RADAR_PAUSED_UNTIL_RESUMED;
  if (pause === "hour") return new Date(now.getTime() + HOUR_MS).toISOString();
  return nextMorning(RADAR_PAUSE_MORNING, timeZone, now).toISOString();
}

/** A time zone the browser can format in; an unknown one falls back to the browser's own. */
export function usableTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** "HH:MM" in the time zone. */
export function formatRadarClock(at: Date | string, timeZone: string | undefined, locale: string) {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: usableTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** "HH:MM" in the time zone; a moment on another day also names the weekday. */
export function formatRadarTime(
  at: Date | string,
  timeZone: string | undefined,
  locale: string,
  now = new Date(),
): string {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return "";
  const zone = usableTimeZone(timeZone);
  const clock = formatRadarClock(instant, zone, locale);
  const sameDay = zone
    ? localDate(instant, zone) === localDate(now, zone)
    : instant.toDateString() === now.toDateString();
  if (sameDay) return clock;
  const day = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short" }).format(instant);
  return `${day} ${clock}`;
}
