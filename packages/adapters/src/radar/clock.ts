/** Wall-clock arithmetic in the owner's time zone, without a date library. */

const HOUR = 3_600_000;
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

/**
 * The instant a local date and "HH:MM" occur in a time zone. A time that a daylight-saving
 * change skips or repeats resolves to an instant within an hour of it.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const first = wall - zoneOffset(new Date(wall), timeZone);
  return new Date(wall - zoneOffset(new Date(first), timeZone));
}

export function startOfLocalDay(at: Date, timeZone: string): Date {
  return zonedInstant(localDate(at, timeZone), "00:00", timeZone);
}

export const hoursAfter = (at: Date, hours: number) => new Date(at.getTime() + hours * HOUR);

/** Minutes since local midnight. */
export function localMinutes(at: Date, timeZone: string): number {
  const wall = wallClock(at, timeZone);
  return wall.hour * 60 + wall.minute;
}

/** Local "HH:MM" and weekday name, for prompts. */
export function localTimeLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/**
 * A time as the owner reads it, for prompts: "today 11:00", "tomorrow 09:30" or
 * "Tuesday 6 October 14:00". Models misconvert UTC timestamps, so they get local labels.
 * An all-day date ("2026-10-06") keeps its calendar day.
 */
export function localWhen(at: Date | string, timeZone: string, now: Date, allDay = false): string {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return String(at);
  const day =
    allDay && typeof at === "string" && /^\d{4}-\d{2}-\d{2}/.test(at)
      ? at.slice(0, 10)
      : localDate(date, timeZone);
  const today = localDate(now, timeZone);
  const label =
    day === today
      ? "today"
      : day === nextLocalDate(today)
        ? "tomorrow"
        : new Intl.DateTimeFormat("en-GB", {
            timeZone: "UTC",
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date(`${day}T12:00:00Z`));
  if (allDay) return `${label} (all day)`;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${label} ${time}`;
}
