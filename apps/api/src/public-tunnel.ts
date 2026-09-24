import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const PUBLIC_TUNNEL_KEY_HEADER = "x-negroni-tunnel-key";

export function publicTunnelGate(
  configuredHost: string | undefined,
  configuredKey: string | undefined,
): MiddlewareHandler {
  const expectedHost = normalizeHost(configuredHost);
  const expectedKey = configuredKey?.trim();
  return async (context, next) => {
    if (!expectedHost || !expectedKey || requestHost(context.req.raw) !== expectedHost) {
      await next();
      return;
    }
    const presentedKey = context.req.header(PUBLIC_TUNNEL_KEY_HEADER) ?? "";
    if (!sameSecret(presentedKey, expectedKey)) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}

function requestHost(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  return normalizeHost(forwardedHost ?? request.headers.get("host") ?? new URL(request.url).host) ?? "";
}

function normalizeHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).host;
  } catch {
    return undefined;
  }
}

function sameSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
