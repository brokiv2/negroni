import { asString, clip, httpsUrl, plainText, SourceReadError, validDate } from "./envelope.js";
import type { ObservedSignal, RadarObserver } from "./types.js";

/** Meeting details read per check; the rest waits for the next one. */
const CAP = 10;

/** Unwrap documented SDK and MCP envelopes without guessing ids out of prose. */
export function granolaMeetings(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && "id" in item)) return value;
    const text = value
      .filter((item) => item?.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (text) {
      try {
        return granolaMeetings(JSON.parse(text));
      } catch (error) {
        if (error instanceof SourceReadError) throw error;
        throw new SourceReadError("Meeting source returned an unsupported response.");
      }
    }
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
    if (ids.length) {
      const details = granolaMeetings(
        await call("GRANOLA_MCP_GET_MEETINGS", { meeting_ids: ids }),
      ).filter((meeting) => ids.includes(asString(meeting.id)));
      for (const meeting of details) {
        const id = asString(meeting.id);
        const parts = [
          textOf(meeting.summary),
          textOf(meeting.notes ?? meeting.enhanced_notes ?? meeting.private_notes),
          textOf(meeting.action_items ?? meeting.actionItems),
        ].filter(Boolean);
        const excerpt = parts.length ? parts.join("\n\n") : clip(JSON.stringify(meeting), 2000);
        const url = httpsUrl(meeting.url, ["granola.ai"]);
        signals.push({
          externalId: id,
          threadKey: id,
          storyKey: `granola:${id}`,
          kind: "meeting_notes",
          occurredAt:
            validDate(
              meeting.end_time ?? meeting.start_time ?? meeting.date ?? meeting.created_at,
            ) ?? now,
          direct: true,
          title: clip(asString(meeting.title) || "Meeting notes", 300),
          excerpt: clip(excerpt, 2000),
          ...(url ? { url } : {}),
          meta: {},
        });
      }
    }
    const overflow = Math.max(0, fresh.length - ids.length);
    return {
      signals,
      // Keep the window open until every listed meeting has been read.
      cursor: {
        since: overflow ? from : now.toISOString(),
        seen: [...seen, ...ids].slice(-300),
      },
      overflow,
    };
  },
};
