import { RADAR_PAUSED_UNTIL_RESUMED } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  formatRadarTime,
  laterOptions,
  localDate,
  nextMorning,
  pauseUntil,
  zonedInstant,
} from "./radar-time";

const TOKYO = "Asia/Tokyo";
const BERLIN = "Europe/Berlin";

describe("radar time", () => {
  it("resolves a local wall-clock time in the Radar time zone", () => {
    expect(zonedInstant("2026-10-04", "19:00", TOKYO).toISOString()).toBe(
      "2026-10-04T10:00:00.000Z",
    );
    // Berlin leaves summer time on 2026-10-25.
    expect(zonedInstant("2026-10-25", "08:30", BERLIN).toISOString()).toBe(
      "2026-10-25T07:30:00.000Z",
    );
    expect(zonedInstant("2026-10-24", "08:30", BERLIN).toISOString()).toBe(
      "2026-10-24T06:30:00.000Z",
    );
  });

  it("offers an hour, this evening and tomorrow morning in time order", () => {
    const now = new Date("2026-10-04T03:00:00Z"); // 12:00 in Tokyo
    expect(laterOptions(TOKYO, now).map(({ key, until }) => [key, until.toISOString()])).toEqual([
      ["hour", "2026-10-04T04:00:00.000Z"],
      ["evening", "2026-10-04T10:00:00.000Z"],
      ["morning", "2026-10-04T23:30:00.000Z"],
    ]);
  });

  it("drops this evening once it is less than an hour away", () => {
    const now = new Date("2026-10-04T09:30:00Z"); // 18:30 in Tokyo
    expect(laterOptions(TOKYO, now).map(({ key }) => key)).toEqual(["hour", "morning"]);
  });

  it("treats the small hours as the night before the coming morning", () => {
    const now = new Date("2026-10-04T16:30:00Z"); // 01:30 on 5 October in Tokyo
    expect(localDate(now, TOKYO)).toBe("2026-10-05");
    expect(nextMorning("08:30", TOKYO, now).toISOString()).toBe("2026-10-04T23:30:00.000Z");
    expect(pauseUntil("morning", TOKYO, now)).toBe("2026-10-04T23:00:00.000Z");
  });

  it("pauses for an hour, until the morning or until resumed", () => {
    const now = new Date("2026-10-04T03:00:00Z");
    expect(pauseUntil("hour", TOKYO, now)).toBe("2026-10-04T04:00:00.000Z");
    expect(pauseUntil("morning", TOKYO, now)).toBe("2026-10-04T23:00:00.000Z");
    expect(pauseUntil("resumed", TOKYO, now)).toBe(RADAR_PAUSED_UNTIL_RESUMED);
  });

  it("formats a time on the same day as HH:MM and names the weekday otherwise", () => {
    const now = new Date("2026-10-04T03:00:00Z");
    expect(formatRadarTime("2026-10-04T10:00:00Z", TOKYO, "en", now)).toBe("19:00");
    expect(formatRadarTime("2026-10-04T23:00:00Z", TOKYO, "en", now)).toBe("Mon 08:00");
    expect(formatRadarTime("not a date", TOKYO, "en", now)).toBe("");
  });
});
