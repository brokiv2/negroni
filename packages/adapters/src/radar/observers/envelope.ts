import type { RadarActorValue } from "./types.js";

/** A source read that failed; `reconnect` when the account needs to be authorized again. */
export class SourceReadError extends Error {
  constructor(
    message: string,
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "SourceReadError";
  }
}

const AUTH_FAILURE =
  /\b(401|403)\b|unauthori[sz]ed|invalid[_ ]grant|token (?:has )?(?:expired|been revoked)|revoked|reconnect|insufficient (?:permission|scope)|not authorized/i;

export function sourceError(message: unknown): SourceReadError {
  const text = typeof message === "string" && message.trim() ? message : "";
  return AUTH_FAILURE.test(text)
    ? new SourceReadError("Reconnect this account.", true)
    : new SourceReadError("The account could not be read.");
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
export const asString = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

/**
 * Provider results arrive wrapped (`{data: {data: …}}`, `{successful, data}`, MCP text
 * content). Returns the first object that carries `key`; a reported failure throws.
 */
export function providerData(value: unknown, key: string, depth = 0): Record<string, unknown> {
  if (depth > 6) throw new SourceReadError("The source returned an unexpected response.");
  if (Array.isArray(value)) {
    const text = value
      .filter((item) => item && typeof item === "object" && item.type === "text")
      .map((item) => String(item.text ?? ""))
      .join("\n");
    if (!text) throw new SourceReadError("The source returned an unexpected response.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SourceReadError("The source returned an unexpected response.");
    }
    return providerData(parsed, key, depth + 1);
  }
  const row = asRecord(value);
  if (
    row.successful === false ||
    row.isError === true ||
    (typeof row.error === "string" && row.error)
  )
    throw sourceError(row.error);
  if (key in row) return row;
  for (const next of ["data", "response_data", "result", "structuredContent", "content"]) {
    const inner = row[next];
    if (inner === undefined || inner === null || typeof inner !== "object") continue;
    try {
      return providerData(inner, key, depth + 1);
    } catch (error) {
      if (error instanceof SourceReadError && error.reconnect) throw error;
    }
  }
  throw new SourceReadError("The source returned an unexpected response.");
}

export function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Plain text for excerpts: no markup, no tracking-link noise, collapsed whitespace. */
export function plainText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[​-‏⁠﻿­]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const normalizeAddress = (value: unknown): string | undefined => {
  const text = asString(value).trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+$/.test(text) && text.length <= 320 ? text : undefined;
};

/** `Name <name@example.test>` or a bare address. */
export function parseMailbox(value: unknown): RadarActorValue | undefined {
  const text = asString(value).trim();
  if (!text) return undefined;
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(text);
  const address = normalizeAddress(angled ? angled[2] : text);
  const name = (angled ? angled[1] : "")?.trim().replace(/^"|"$/g, "").trim();
  if (!address && !name) return undefined;
  return {
    ...(name ? { name: name.slice(0, 200) } : {}),
    ...(address ? { address } : {}),
  };
}

/** Every address in a To/Cc header, lowercased. */
export function addressList(value: unknown): string[] {
  const text = asString(value);
  return [
    ...new Set(
      [...text.matchAll(/[^\s,;<>"]+@[^\s,;<>"]+/g)]
        .map((match) => normalizeAddress(match[0]))
        .filter((address): address is string => Boolean(address)),
    ),
  ];
}

/** An https link on one of the given hosts (or any host), without credentials. */
export function httpsUrl(value: unknown, hosts?: string[]): string | undefined {
  try {
    const url = new URL(asString(value));
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    if (hosts && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function validDate(value: unknown): Date | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const numeric = /^\d{10,13}$/.test(text) ? Number(text) : Number.NaN;
  const time = Number.isFinite(numeric)
    ? numeric < 1e12
      ? numeric * 1000
      : numeric
    : Date.parse(text);
  return Number.isFinite(time) ? new Date(time) : undefined;
}
