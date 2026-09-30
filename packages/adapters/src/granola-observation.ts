import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";

/** Unwrap documented SDK/MCP envelopes without guessing IDs out of prose. */
export function granolaMeetings(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (value.every((v) => v && typeof v === "object" && "id" in v)) return value;
    const text = value
      .filter((v) => v?.type === "text")
      .map((v) => v.text)
      .join("\n");
    if (text) return granolaMeetings(JSON.parse(text));
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (row.isError === true || row.successful === false) throw new Error("Source read failed.");
    for (const key of ["meetings", "data", "structuredContent", "content", "result"])
      if (row[key] !== undefined) return granolaMeetings(row[key]);
  }
  throw new Error("Meeting source returned an unsupported response.");
}

export async function observeGranola(
  connector: ConnectorProvider,
  request: {
    connectionId: string;
    since: string;
    seenDocumentIds?: string[];
    beforeRead: () => Promise<void>;
  },
  context: AdapterContext,
) {
  const read = async (tool: string, args: Record<string, unknown>) => {
    await request.beforeRead();
    context.signal.throwIfAborted();
    for await (const event of connector.execute(
      {
        tool,
        args: { ...args, _account: request.connectionId },
        executionId: `${context.runId}:${tool}`,
        connectionId: request.connectionId,
      },
      context,
    )) {
      if (event.type === "error")
        throw new Error("Meeting source is unavailable. Reconnect the account if needed.");
      if (event.type === "result") return granolaMeetings(event.data);
    }
    throw new Error("Meeting source returned no result.");
  };
  const listed = await read("GRANOLA_MCP_LIST_MEETINGS", {
    time_range: "custom",
    custom_start: request.since,
    custom_end: new Date().toISOString(),
    involvement: { captured_by_me: true, listed_as_participant: true },
  });
  const available = new Set(
    listed.map((m) => String(m.id ?? "")).filter((id) => /^[\w-]{1,200}$/.test(id)),
  );
  const seen = request.seenDocumentIds ?? [];
  const ids = [
    ...[...available].filter((id) => !seen.includes(id)).sort(),
    ...seen.filter((id) => available.has(id)),
  ].slice(0, 10);
  if (!ids.length) {
    if (listed.length) throw new Error("Meeting identifiers are unavailable.");
    return [];
  }
  const details = await read("GRANOLA_MCP_GET_MEETINGS", { meeting_ids: ids });
  if (!details.some((m) => ids.includes(String(m.id))))
    throw new Error("Meeting details are unavailable.");
  return details
    .filter((m) => ids.includes(String(m.id)))
    .map((m) => {
      // Stable content hash excludes SDK request IDs, timing and envelope metadata.
      const fields = Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
      const text = JSON.stringify(fields).slice(0, 16000);
      const rawUrl = String(m.url ?? "");
      let url: string | undefined;
      try {
        const u = new URL(rawUrl);
        if (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          (u.hostname === "granola.ai" || u.hostname.endsWith(".granola.ai"))
        )
          url = u.href;
      } catch {
        /* Optional source link; never manufacture one. */
      }
      return { id: String(m.id), title: String(m.title ?? "Meeting").slice(0, 300), text, url };
    });
}
