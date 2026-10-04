import type { RadarSettings } from "@rakazo/contracts";
import { hoursAfter, localDate, nextLocalDate, zonedInstant } from "./clock.js";

export type BriefSlot = {
  period: "morning" | "evening";
  /** Owner's calendar date the brief belongs to. */
  localDate: string;
  at: Date;
  /** Last moment the brief may still go out after the computer slept through `at`. */
  until: Date;
};

/**
 * A day's scheduled briefs. A missed morning brief still goes out until noon (or for three
 * hours when it is set later than that); a missed evening brief until the day ends.
 */
export function briefSlots(settings: RadarSettings, date: string): BriefSlot[] {
  const zone = settings.timeZone;
  const slots: BriefSlot[] = [];
  if (settings.morningBrief.enabled) {
    const at = zonedInstant(date, settings.morningBrief.time, zone);
    const noon = zonedInstant(date, "12:00", zone);
    slots.push({
      period: "morning",
      localDate: date,
      at,
      until: noon > at ? noon : hoursAfter(at, 3),
    });
  }
  if (settings.eveningBrief.enabled) {
    slots.push({
      period: "evening",
      localDate: date,
      at: zonedInstant(date, settings.eveningBrief.time, zone),
      until: zonedInstant(nextLocalDate(date), "00:00", zone),
    });
  }
  return slots;
}

/**
 * When the next brief goes out: `now` while an unsent brief is due, otherwise the earliest
 * later slot today or tomorrow. Null when both briefs are off.
 */
export function nextBriefAt(
  settings: RadarSettings,
  sent: (slot: BriefSlot) => boolean,
  now: Date,
): Date | null {
  const today = localDate(now, settings.timeZone);
  for (const date of [today, nextLocalDate(today)]) {
    const times = briefSlots(settings, date)
      .filter((slot) => now < slot.until && !sent(slot))
      .map((slot) => Math.max(slot.at.getTime(), now.getTime()));
    if (times.length) return new Date(Math.min(...times));
  }
  return null;
}

/**
 * Until when a Radar push is still worth delivering to a phone that was offline: an update
 * until its deadline and at most a day, a brief for twelve hours.
 */
export function radarPushExpiry(kind: "update" | "brief", now: Date, deadline?: Date | null): Date {
  const cap = hoursAfter(now, kind === "brief" ? 12 : 24);
  return kind === "update" && deadline && deadline > now && deadline < cap ? deadline : cap;
}
