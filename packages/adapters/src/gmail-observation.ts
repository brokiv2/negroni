import type { AdapterContext, ConnectorProvider } from "@rakazo/adapter-kit";

/** Read only headers/snippets. Never fetch attachments, authentication codes or full inbox bodies. */
export function gmailMessages(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object")
    throw new Error("Mail source returned an unsupported response.");
  const row = value as Record<string, unknown>;
  if (row.successful === false || row.isError === true || row.error)
    throw new Error("Mail source read failed.");
  if (Array.isArray(row.messages)) return row.messages.filter((m) => m && typeof m === "object");
  for (const key of ["data", "result", "structuredContent"])
    if (row[key]) return gmailMessages(row[key]);
  throw new Error("Mail source returned an unsupported response.");
}
export async function observeGmail(
  connector: ConnectorProvider,
  request: {
    connectionId: string;
    since: string;
    seenDocumentIds?: string[];
    beforeRead: () => Promise<void>;
  },
  context: AdapterContext,
) {
  await request.beforeRead();
  context.signal.throwIfAborted();
  // Finite catch-up window and a strict cap keep cost bounded after a sleeping Mac wakes.
  const since = Math.max(Date.parse(request.since), Date.now() - 24 * 3600000);
  if (!Number.isFinite(since)) throw new Error("Invalid mail observation window.");
  for await (const event of connector.execute(
    {
      tool: "GMAIL_FETCH_EMAILS",
      connectionId: request.connectionId,
      executionId: `${context.runId}:mail-observe`,
      args: {
        _account: request.connectionId,
        user_id: "me",
        max_results: 20,
        // Rules pre-filter before any model sees mail: Gmail's own bulk categories are
        // dropped at the query, so the cheap pass only ranks personal and update mail.
        query: `after:${Math.floor(since / 1000)} -in:spam -in:trash -in:sent -in:drafts -category:promotions -category:social -category:forums`,
        include_payload: false,
        verbose: false,
      },
    },
    context,
  )) {
    if (event.type === "error")
      throw new Error("Mail source is unavailable. Reconnect the account if needed.");
    if (event.type !== "result") continue;
    context.signal.throwIfAborted();
    const seen = new Set(request.seenDocumentIds ?? []);
    return gmailMessages(event.data)
      .slice(0, 20)
      .flatMap((m) => {
        const id = String(m.messageId ?? m.id ?? "");
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || seen.has(id)) return [];
        const subject = String(m.subject ?? "Email").slice(0, 300);
        const preview =
          m.preview && typeof m.preview === "object"
            ? (m.preview as Record<string, unknown>).body
            : m.preview;
        const rawSnippet = typeof m.snippet === "string" && m.snippet ? m.snippet : preview;
        const snippet = typeof rawSnippet === "string" ? rawSnippet.slice(0, 2000) : "";
        if (!snippet) return [];
        const text = `${subject}\n${snippet}`;
        // Authentication messages are neither model input nor a saved memory.
        if (
          /one.?time|verification code|security code|password reset|reset your password|magic link|код[а-я ]*(?:вход|подтверж|провер)|сброс[а-я ]*парол/i.test(
            text,
          )
        )
          return [];
        return [
          {
            id,
            title: subject,
            text: JSON.stringify({
              subject,
              from: String(m.sender ?? m.from ?? "").slice(0, 300),
              snippet,
            }),
            // Gmail chooses the signed-in account; do not manufacture an account-index URL.
            url: undefined,
          },
        ];
      });
  }
  throw new Error("Mail source returned no result.");
}
