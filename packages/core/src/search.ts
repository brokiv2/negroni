const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractLinksFromText(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?)]+$/, "")))];
}

export function matchesSearchQuery(
  query: string,
  ...fields: Array<string | undefined | null>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return fields.some((field) => field?.toLowerCase().includes(q));
}

export function snippetAroundMatch(text: string, query: string, maxLen = 120): string {
  const q = query.trim().toLowerCase();
  if (!q) return text.slice(0, maxLen);
  const lower = text.toLowerCase();
  const index = lower.indexOf(q);
  if (index < 0) return text.slice(0, maxLen);
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, start + maxLen);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export type SearchThreadTarget =
  | { botId: string; threadKind?: "personal"; groupId?: undefined }
  | { groupId: string; botId?: undefined; threadKind?: undefined };

/**
 * The thread a message jump loads: a group, or a bot's Team thread. `personal` addresses the
 * main assistant's Personal thread instead (a search hit is always Team).
 */
export function searchHitThreadTarget(hit: {
  botId?: string;
  groupId?: string;
  personal?: boolean;
}): SearchThreadTarget {
  if (Boolean(hit.botId) === Boolean(hit.groupId)) {
    throw new Error("Search hit must target exactly one of a bot or group");
  }
  if (hit.groupId) return { groupId: hit.groupId };
  return hit.personal ? { botId: hit.botId!, threadKind: "personal" } : { botId: hit.botId! };
}
