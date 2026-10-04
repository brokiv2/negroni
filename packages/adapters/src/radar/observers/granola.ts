import { asString, clip, httpsUrl, plainText, SourceReadError, validDate } from "./envelope.js";
import type { ObservedSignal, RadarObserver } from "./types.js";

/** Meeting details read per check; the rest waits for the next one. */
const CAP = 10;
/** A meeting without notes yet is looked at again for this long. */
const NOTES_WAIT_MS = 24 * 3_600_000;

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};
const decodeEntities = (text: string) =>
  text.replace(/&(?:quot|apos|#39|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);
const SECTIONS = [
  "summary",
  "notes",
  "enhanced_notes",
  "private_notes",
  "action_items",
  "known_participants",
];

/**
 * The MCP's tagged listing: `<meetings_data>` holding `<meeting id="…" title="…" date="…">`
 * elements with their sections inside. Only the element's own attributes and named sections
 * are read.
 */
function taggedMeetings(text: string): Record<string, unknown>[] {
  const meetings: Record<string, unknown>[] = [];
  for (const match of text.matchAll(/<meeting\b([^>]*?)(?:\/>|>([\s\S]*?)<\/meeting>)/g)) {
    const row: Record<string, unknown> = {};
    for (const attribute of (match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g))
      row[attribute[1]!] = decodeEntities(attribute[2]!);
    const inner = match[2] ?? "";
    for (const section of SECTIONS) {
      const found = new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`).exec(inner);
      if (found) row[section] = decodeEntities(found[1]!.trim());
    }
    meetings.push(row);
  }
  return meetings;
}

/** Unwrap documented SDK and MCP envelopes without guessing ids out of prose. */
export function granolaMeetings(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return granolaMeetings(JSON.parse(text));
      } catch (error) {
        if (error instanceof SourceReadError) throw error;
      }
    }
    if (/<meeting\b/.test(text)) return taggedMeetings(text);
    // A listing without meetings.
    if (/<meetings_data\b/.test(text) || /^no meetings\b/i.test(text)) return [];
    throw new SourceReadError("Meeting source returned an unsupported response.");
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && "id" in item)) return value;
    const text = value
      .filter((item) => item?.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (text) return granolaMeetings(text);
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (row.isError === true || row.successful === false)
      throw new SourceReadError("The account could not be read.");
    for (const key of ["meetings", "data", "structuredContent", "content", "result"])
      if (row[key] !== undefined) return granolaMeetings(row[key]);
  }
  throw new SourceReadError("Meeting source returned an unsupported response.");
}

function textOf(value: unknown): string {
  if (typeof value === "string") return plainText(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return textOf(row.text ?? row.content ?? row.title ?? row.description ?? "");
  }
  return "";
}

export const granolaObserver: RadarObserver = {
  cadenceMinutes: 30,

  async observe({ call, cursor, now, since }) {
    const from = asString(cursor.since) || since.toISOString();
    const listed = granolaMeetings(
      await call("GRANOLA_MCP_LIST_MEETINGS", {
        time_range: "custom",
        custom_start: from,
        custom_end: now.toISOString(),
        involvement: { captured_by_me: true, listed_as_participant: true },
      }),
    );
    const seen = new Set(Array.isArray(cursor.seen) ? cursor.seen.map(asString) : []);
    const fresh = listed
      .map((meeting) => asString(meeting.id))
      .filter((id) => /^[\w-]{1,200}$/.test(id) && !seen.has(id));
    const ids = [...new Set(fresh)].slice(0, CAP);
    const signals: ObservedSignal[] = [];
    const waiting: string[] = [];
    if (ids.length) {
      const details = granolaMeetings(
        await call("GRANOLA_MCP_GET_MEETINGS", { meeting_ids: ids }),
      ).filter((meeting) => ids.includes(asString(meeting.id)));
      for (const meeting of details) {
        const id = asString(meeting.id);
        const occurredAt =
          validDate(meeting.end_time ?? meeting.start_time ?? meeting.date ?? meeting.created_at) ??
          now;
        const parts = [
          textOf(meeting.summary),
          textOf(meeting.notes ?? meeting.enhanced_notes ?? meeting.private_notes),
          textOf(meeting.action_items ?? meeting.actionItems),
        ].filter(Boolean);
        if (!parts.length) {
          // Notes are still being written: look again next time, for a day.
          if (now.getTime() - occurredAt.getTime() < NOTES_WAIT_MS) waiting.push(id);
          continue;
        }
        // Names with their addresses; plain text would drop the bracketed addresses.
        const people = meeting.known_participants ?? meeting.participants;
        const participants = clip(
          typeof people === "string" ? people.replace(/\s+/g, " ").trim() : textOf(people),
          400,
        );
        const url = httpsUrl(meeting.url, ["granola.ai"]);
        signals.push({
          externalId: id,
          threadKey: id,
          storyKey: `granola:${id}`,
          kind: "meeting_notes",
          occurredAt,
          direct: true,
          title: clip(asString(meeting.title) || "Meeting notes", 300),
          excerpt: clip(
            [participants ? `Participants: ${participants}` : "", ...parts]
              .filter(Boolean)
              .join("\n\n"),
            2000,
          ),
          ...(url ? { url } : {}),
          meta: {},
        });
      }
    }
    const overflow = Math.max(0, fresh.length - ids.length);
    const read = ids.filter((id) => !waiting.includes(id));
    return {
      signals,
      // Keep the window open until every listed meeting has been read.
      cursor: {
        since: overflow || waiting.length ? from : now.toISOString(),
        seen: [...seen, ...read].slice(-300),
      },
      overflow,
    };
  },
};
