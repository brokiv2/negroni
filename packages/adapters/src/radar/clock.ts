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
