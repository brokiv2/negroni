import { RadarSettingsSchema } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { localDate, localWhen, nextLocalDate, startOfLocalDay, zonedInstant } from "./clock.js";
import type { BriefSlot } from "./schedule.js";
import { briefSlots, nextBriefAt, radarPushExpiry } from "./schedule.js";

describe("radar clock", () => {
  it("labels times the way the owner reads them", () => {
    const now = new Date("2026-10-04T07:20:00Z");
    expect(localWhen("2026-10-04T08:00:00Z", "Europe/Helsinki", now)).toBe("today 11:00");
    expect(localWhen(new Date("2026-10-05T06:30:00Z"), "Europe/Helsinki", now)).toBe(
      "tomorrow 09:30",
    );
    expect(localWhen("2026-10-06T11:00:00Z", "Europe/Helsinki", now)).toBe(
      "Tuesday 6 October 14:00",
    );
    expect(localWhen("2026-10-04", "America/Los_Angeles", now, true)).toBe("today (all day)");
    expect(localWhen("not a date", "UTC", now)).toBe("not a date");
  });

  it("reads the calendar date in the owner's zone", () => {
    const at = new Date("2026-10-03T22:30:00Z");
    expect(localDate(at, "UTC")).toBe("2026-10-03");
    expect(localDate(at, "Europe/Helsinki")).toBe("2026-10-04");
    expect(localDate(at, "America/Los_Angeles")).toBe("2026-10-03");
    expect(localDate(at, "Asia/Kathmandu")).toBe("2026-10-04");
  });

  it("turns local wall time into an instant, across offsets and daylight saving", () => {
    expect(zonedInstant("2026-10-04", "08:30", "UTC").toISOString()).toBe(
      "2026-10-04T08:30:00.000Z",
    );
    expect(zonedInstant("2026-10-04", "08:30", "Europe/Helsinki").toISOString()).toBe(
      "2026-10-04T05:30:00.000Z",
    );
    expect(zonedInstant("2026-12-04", "08:30", "Europe/Helsinki").toISOString()).toBe(
      "2026-12-04T06:30:00.000Z",
    );
    expect(zonedInstant("2026-10-04", "08:30", "Asia/Kathmandu").toISOString()).toBe(
      "2026-10-04T02:45:00.000Z",
    );
    // Days that are 23 and 25 hours long still start at local midnight.
    expect(startOfLocalDay(new Date("2026-03-29T12:00:00Z"), "Europe/Helsinki").toISOString()).toBe(
      "2026-03-28T22:00:00.000Z",
    );
    expect(startOfLocalDay(new Date("2026-10-25T12:00:00Z"), "Europe/Helsinki").toISOString()).toBe(
      "2026-10-24T21:00:00.000Z",
    );
    expect(
      startOfLocalDay(new Date("2026-11-01T12:00:00Z"), "America/New_York").toISOString(),
    ).toBe("2026-11-01T04:00:00.000Z");
    // A time the clocks skip still resolves within the hour.
    const skipped = zonedInstant("2026-03-29", "03:30", "Europe/Helsinki").getTime();
    expect(Math.abs(skipped - Date.parse("2026-03-29T01:00:00Z"))).toBeLessThanOrEqual(3_600_000);
  });

  it("steps calendar dates across month and year ends", () => {
    expect(nextLocalDate("2026-10-31")).toBe("2026-11-01");
    expect(nextLocalDate("2026-12-31")).toBe("2027-01-01");
    expect(nextLocalDate("2028-02-28")).toBe("2028-02-29");
  });
});

describe("radar brief schedule", () => {
  const settings = RadarSettingsSchema.parse({
    enabled: true,
    timeZone: "Europe/Helsinki",
    eveningBrief: { enabled: true },
  });
  const never = () => false;

  it("gives a missed morning brief until noon and an evening brief until midnight", () => {
    const [morning, evening] = briefSlots(settings, "2026-10-04");
    expect(morning).toMatchObject({ period: "morning", localDate: "2026-10-04" });
    expect(morning?.at.toISOString()).toBe("2026-10-04T05:30:00.000Z");
    expect(morning?.until.toISOString()).toBe("2026-10-04T09:00:00.000Z");
    expect(evening?.at.toISOString()).toBe("2026-10-04T15:30:00.000Z");
    expect(evening?.until.toISOString()).toBe("2026-10-04T21:00:00.000Z");
  });

  it("names the next brief: today, due now, or tomorrow", () => {
    const at = (iso: string, sent: (slot: BriefSlot) => boolean = never) =>
      nextBriefAt(settings, sent, new Date(iso))?.toISOString();
    expect(at("2026-10-04T04:00:00Z")).toBe("2026-10-04T05:30:00.000Z");
    // The computer slept through 08:30 local; the brief is due until noon.
    expect(at("2026-10-04T07:00:00Z")).toBe("2026-10-04T07:00:00.000Z");
    expect(at("2026-10-04T10:00:00Z")).toBe("2026-10-04T15:30:00.000Z");
    expect(
      at(
        "2026-10-04T07:00:00Z",
        (slot) => slot.period === "morning" && slot.localDate === "2026-10-04",
      ),
    ).toBe("2026-10-04T15:30:00.000Z");
    expect(at("2026-10-04T21:30:00Z")).toBe("2026-10-05T05:30:00.000Z");
    const off = RadarSettingsSchema.parse({ morningBrief: { enabled: false } });
    expect(nextBriefAt(off, never, new Date("2026-10-04T04:00:00Z"))).toBeNull();
  });

  it("keeps a catch-up window for a morning brief set after noon", () => {
    const late = RadarSettingsSchema.parse({ morningBrief: { time: "13:00" } });
    const [slot] = briefSlots(late, "2026-10-04");
    expect(slot?.until.getTime()).toBe((slot?.at.getTime() ?? 0) + 3 * 3_600_000);
  });
});

describe("radar push expiry", () => {
  const now = new Date("2026-10-04T09:00:00Z");
  it("keeps an update until its deadline, at most a day, and a brief for twelve hours", () => {
    const iso = (at: Date) => at.toISOString();
    expect(iso(radarPushExpiry("update", now))).toBe("2026-10-05T09:00:00.000Z");
    expect(iso(radarPushExpiry("update", now, new Date("2026-10-04T12:00:00Z")))).toBe(
      "2026-10-04T12:00:00.000Z",
    );
    expect(iso(radarPushExpiry("update", now, new Date("2026-10-09T12:00:00Z")))).toBe(
      "2026-10-05T09:00:00.000Z",
    );
    expect(iso(radarPushExpiry("update", now, new Date("2026-10-04T08:00:00Z")))).toBe(
      "2026-10-05T09:00:00.000Z",
    );
    expect(iso(radarPushExpiry("brief", now, new Date("2026-10-04T12:00:00Z")))).toBe(
      "2026-10-04T21:00:00.000Z",
    );
  });
});
