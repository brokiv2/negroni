import { abortableDelay } from "@rakazo/core";

/** Deep link the API callback page returns to; also the auth-session redirect prefix. */
export const CONNECTION_RETURN_URL = "negroni://integrations";

export type ConnectionPhase = "authorizing" | "confirming";
export type ConnectionOutcome = "connected" | "pending" | "aborted";

export type ConnectionReturn = {
  connectionId: string | null;
  status: "connected" | "pending" | null;
};

/** Read `connection` and `status` from a `negroni://integrations?...` return URL. */
export function parseConnectionReturn(url: string | null | undefined): ConnectionReturn {
  const empty: ConnectionReturn = { connectionId: null, status: null };
  if (!url?.startsWith(CONNECTION_RETURN_URL)) return empty;
  const query = url.slice(CONNECTION_RETURN_URL.length).replace(/^[/]?\?/, "");
  const params = new URLSearchParams(query.split("#", 1)[0]);
  const status = params.get("status");
  return {
    connectionId: params.get("connection") || null,
    status: status === "connected" || status === "pending" ? status : null,
  };
}

/**
 * Open the provider consent in an auth session, then confirm with the API right away and keep
 * a short polling fallback (the callback page may be blocked, e.g. by a tunnel interstitial).
 */
export async function authorizeConnection(options: {
  connectionId: string;
  authorizationUrl: string | null;
  openAuthSession: (url: string, returnUrl: string) => Promise<{ type: string; url?: string }>;
  complete: (connectionId: string) => Promise<{ status: string } | undefined>;
  signal: AbortSignal;
  onPhase?: (phase: ConnectionPhase) => void;
  attempts?: number;
  intervalMs?: number;
}): Promise<ConnectionOutcome> {
  const { connectionId, signal } = options;
  if (options.authorizationUrl) {
    options.onPhase?.("authorizing");
    await options.openAuthSession(options.authorizationUrl, CONNECTION_RETURN_URL);
  }
  if (signal.aborted) return "aborted";
  options.onPhase?.("confirming");
  const attempts = options.attempts ?? 20;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) return "aborted";
    const row = await options.complete(connectionId).catch(() => undefined);
    if (signal.aborted) return "aborted";
    if (row?.status === "connected") return "connected";
    if (attempt < attempts - 1) {
      try {
        await abortableDelay(options.intervalMs ?? 2_000, signal);
      } catch {
        return "aborted";
      }
    }
  }
  return "pending";
}
