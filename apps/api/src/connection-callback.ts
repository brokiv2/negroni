import { randomBytes } from "node:crypto";
import type { ConnectorRegistry } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";

/** Public landing page Composio redirects to after OAuth consent. */
export const CONNECTION_CALLBACK_PATH = "/connections/callback";
/** Mobile deep link the callback page hands control back to. */
export const MOBILE_CONNECTION_RETURN_URL = "negroni://integrations";

const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const READY_TIMEOUT_MS = 8_000;

export type CallbackOrigins = {
  /** Origin the RPC request that started the connection arrived on. */
  requestOrigin?: string;
  apiUrl: string;
  webOrigin: string;
  /** Publicly reachable API origin (PUBLIC_API_URL or the tunnel host). */
  publicApiUrl?: string;
};

/**
 * The browser that finishes OAuth must be able to reach the callback. Prefer the origin the
 * client used (phone over the tunnel, desktop over loopback), then the public API origin.
 */
export function resolveConnectionCallbackUrl(
  origins: CallbackOrigins,
  connectionId: string,
): string {
  const url = new URL(CONNECTION_CALLBACK_PATH, callbackOrigin(origins));
  url.searchParams.set("connection", connectionId);
  return url.href;
}

function callbackOrigin({ requestOrigin, apiUrl, webOrigin, publicApiUrl }: CallbackOrigins) {
  const api = normalizeOrigin(apiUrl) ?? "http://127.0.0.1:3100";
  const publicApi = normalizeOrigin(publicApiUrl);
  const request = normalizeOrigin(requestOrigin);
  if (request) {
    if (request === publicApi || request === api) return request;
    // The web dev server proxies RPC; the callback route lives on the API itself.
    if (request === normalizeOrigin(webOrigin)) return api;
    if (isLoopbackOrigin(request)) return request;
  }
  return publicApi ?? api;
}

/** Origin of an incoming request, honoring the first hop of reverse-proxy headers. */
export function requestOrigin(request: Request): string | undefined {
  const url = new URL(request.url);
  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    request.headers.get("host") ??
    url.host;
  return normalizeOrigin(`${proto}://${host}`);
}

export function publicApiUrl(
  explicit: string | undefined,
  tunnelHost: string | undefined,
): string | undefined {
  const configured = normalizeOrigin(explicit);
  if (configured) return configured;
  const host = tunnelHost?.trim().replace(/\.$/, "");
  return host ? normalizeOrigin(host.includes("://") ? host : `https://${host}`) : undefined;
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",", 1)[0]?.trim();
  return first || undefined;
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

type CallbackDeps = {
  prisma: Pick<PrismaClient, "connection">;
  connectors: Pick<ConnectorRegistry, "managed">;
};

export type CallbackStatus = "connected" | "pending";

/**
 * Settle a pending connection from the unauthenticated callback. It only ever moves a row
 * from pending to connected after the provider confirms that exact account is active.
 */
export async function settleConnectionFromCallback(
  deps: CallbackDeps,
  connectionId: string,
): Promise<CallbackStatus> {
  if (!CONNECTION_ID.test(connectionId)) return "pending";
  const row = await deps.prisma.connection.findUnique({ where: { id: connectionId } });
  if (!row) return "pending";
  if (row.status === "connected") return "connected";
  if (row.status !== "pending" || !row.providerRef) return "pending";
  const connector = deps.connectors.managed(row.connectorId);
  if (!connector) return "pending";
  const operationId = `connections.callback:${row.id}`;
  const ready = await connector.connectionReady(
    {
      operationId,
      traceId: operationId,
      spaceId: row.spaceId,
      userId: row.userId,
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    },
    row.provider,
    row.providerRef,
  );
  if (!ready) return "pending";
  await deps.prisma.connection.updateMany({
    where: { id: row.id, status: "pending" },
    data: { status: "connected" },
  });
  return "connected";
}

export function mobileReturnUrl(connectionId: string, status: CallbackStatus): string {
  if (!CONNECTION_ID.test(connectionId)) return MOBILE_CONNECTION_RETURN_URL;
  const url = new URL(MOBILE_CONNECTION_RETURN_URL);
  url.searchParams.set("connection", connectionId);
  url.searchParams.set("status", status);
  return url.href;
}

export function renderConnectionCallbackPage(
  connectionId: string,
  status: CallbackStatus,
  nonce: string,
): string {
  const deepLink = mobileReturnUrl(connectionId, status);
  const data = JSON.stringify({
    connection: CONNECTION_ID.test(connectionId) ? connectionId : null,
    status,
    deepLink,
  }).replace(/</g, "\\u003c");
  const message = status === "connected" ? "Connected" : "Finishing up";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Negroni</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#ececee;font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{display:grid;gap:18px;justify-items:center;padding:24px;text-align:center}
p{margin:0;font-size:17px;font-weight:500}
small{color:#85858a;font-size:14px}
a{display:inline-block;padding:12px 22px;border-radius:999px;background:#ececee;color:#0b0b0c;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:light){body{background:#f6f6f7;color:#111}a{background:#111;color:#fff}}
</style>
</head>
<body>
<main>
<p id="message">${message}</p>
<a id="return" href="${escapeHtml(deepLink)}">Return to Negroni</a>
<small id="hint" hidden>You can close this tab.</small>
</main>
<script nonce="${nonce}">
(function () {
  var data = ${data};
  if (window.opener) {
    try { window.opener.postMessage({ type: "negroni:connection", connection: data.connection, status: data.status }, "*"); } catch (e) {}
    window.close();
  }
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    window.location.href = data.deepLink;
    return;
  }
  document.getElementById("return").hidden = true;
  document.getElementById("hint").hidden = false;
  try { window.close(); } catch (e) {}
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function mountConnectionCallbackRoute(app: Hono, deps: CallbackDeps) {
  app.get(CONNECTION_CALLBACK_PATH, async (c) => {
    const connectionId = c.req.query("connection") ?? "";
    const status = await settleConnectionFromCallback(deps, connectionId).catch((error) => {
      console.error("connection callback reconciliation failed", error);
      return "pending" as const;
    });
    const nonce = randomBytes(16).toString("base64");
    return c.html(renderConnectionCallbackPage(connectionId, status, nonce), 200, {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
  });
}
