import { createHash } from "node:crypto";
import {
  asArray,
  asRecord,
  asString,
  clip,
  httpsUrl,
  normalizeAddress,
  plainText,
  providerData,
  validDate,
} from "./envelope.js";
import type { AgendaEvent, ObservedSignal, RadarObserver } from "./types.js";

const HOUR = 3_600_000;
/** Events Radar keeps a version for; changes beyond the window are not news yet. */
const WINDOW_HOURS = 48;

type Known = { v: string; start?: string; title?: string };

function eventTime(value: unknown): { at?: string; allDay: boolean } {
  const row = asRecord(value);
  const dateTime = asString(row.dateTime);
  if (dateTime) return { at: dateTime, allDay: false };
  const date = asString(row.date);
  return date ? { at: date, allDay: true } : { allDay: false };
}

export const calendarObserver: RadarObserver = {
  cadenceMinutes: 15,

  async observe({ call, cursor, now }) {
    const listed = providerData(
      await call("GOOGLECALENDAR_EVENTS_LIST", {
        calendarId: "primary",
        timeMin: new Date(now.getTime() - HOUR).toISOString(),
        timeMax: new Date(now.getTime() + WINDOW_HOURS * HOUR).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        showDeleted: true,
        maxResults: 100,
      }),
      "items",
    );
    const items = asArray(listed.items).slice(0, 100);
    const known = asRecord(cursor.known) as Record<string, Known>;
    const nextKnown: Record<string, Known> = {};
    const signals: ObservedSignal[] = [];
    const agenda: AgendaEvent[] = [];
    for (const event of items) {
      const id = asString(event.id);
      if (!/^[\w@.-]{1,300}$/.test(id)) continue;
      const status = asString(event.status) || "confirmed";
      const title = clip(asString(event.summary) || "(no title)", 300);
      const start = eventTime(event.start);
      const end = eventTime(event.end);
      const attendees = asArray(event.attendees);
      const self = attendees.find((attendee) => attendee.self === true);
      const organizer = asRecord(event.organizer);
      const organizerSelf = organizer.self === true;
      const response = asString(self?.responseStatus) || (organizerSelf ? "accepted" : "");
      const others = attendees
        .filter((attendee) => attendee.self !== true && attendee.resource !== true)
        .map((attendee) => normalizeAddress(attendee.email))
        .filter((address): address is string => Boolean(address));
      const location = clip(asString(event.location), 200);
      const version = createHash("sha256")
        .update(JSON.stringify([status, title, start.at, end.at, location, response]))
        .digest("hex")
        .slice(0, 24);
      const previous = known[id];
      nextKnown[id] = { v: status === "cancelled" ? "cancelled" : version, start: start.at, title };
      const url = httpsUrl(event.htmlLink, ["google.com"]);
      if (status !== "cancelled" && response !== "declined" && start.at)
        agenda.push({
          id,
          title,
          start: start.at,
          ...(end.at ? { end: end.at } : {}),
          ...(start.allDay ? { allDay: true } : {}),
          ...(location ? { location } : {}),
          attendees: others.slice(0, 30),
          ...(response ? { response } : {}),
          ...(url ? { url } : {}),
        });
      const kind =
        status === "cancelled"
          ? previous && previous.v !== "cancelled"
            ? "event_cancelled"
            : undefined
          : !previous
            ? response === "needsAction" && !organizerSelf
              ? "invite"
              : undefined
            : previous.v !== version
              ? response === "needsAction" && !organizerSelf
                ? "invite"
                : "event_changed"
              : undefined;
      if (!kind) continue;
      const organizerName = asString(organizer.displayName);
      const organizerAddress = normalizeAddress(organizer.email);
      const when = start.at ? `${start.at}${end.at ? ` – ${end.at}` : ""}` : "";
      const description = plainText(asString(event.description));
      signals.push({
        externalId: id,
        threadKey: id,
        storyKey: `gcal:${id}`,
        kind,
        occurredAt: validDate(event.updated) ?? now,
        ...(organizerName || organizerAddress
          ? {
              actor: {
                ...(organizerName ? { name: organizerName } : {}),
                ...(organizerAddress ? { address: organizerAddress } : {}),
              },
            }
          : {}),
        direct: Boolean(self) || organizerSelf,
        title,
        excerpt: clip(
          [when, location, others.length ? `${others.length} other attendees` : "", description]
            .filter(Boolean)
            .join("\n"),
          2000,
        ),
        ...(url ? { url } : {}),
        ...(start.at && validDate(start.at) ? { deadline: validDate(start.at) } : {}),
        meta: {
          status,
          response,
          organizerSelf,
          start: start.at,
          end: end.at,
          allDay: start.allDay,
          attendees: others.slice(0, 20),
          ...(previous && previous.v !== version
            ? { previous: { start: previous.start, title: previous.title } }
            : {}),
        },
        version,
      });
    }
    return {
      signals,
      cursor: { known: nextKnown, agenda: agenda.slice(0, 60), checkedAt: now.toISOString() },
      overflow: 0,
      agenda,
    };
  },
};
