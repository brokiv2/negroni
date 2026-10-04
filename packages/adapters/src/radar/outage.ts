import { getLogger } from "@rakazo/logging";
import type { JsonPassResult } from "../background-triage.js";
import { asRecord } from "./observers/envelope.js";

/**
 * When a model pass gets no answer at all (credit or balance used up, a rate limit, a bad key,
 * a server or network error, a timeout), nothing was learned about the update it was judging.
 * Radar then stops model work for this owner instead of counting an attempt against every
 * update that arrives: the first wait is 10 minutes and each further failure doubles it, up
 * to two hours. Signals stay pending, observation carries on, and the first pass the model
 * answers (usable or not) ends the outage.
 */
export const OUTAGE_FIRST_WAIT_MS = 10 * 60_000;
export const OUTAGE_MAX_WAIT_MS = 2 * 3_600_000;
const MAX_FAILURES = 20;

/**
 * What the owner reads in the Radar status line. It names no cause: the provider's own
 * reason (credit, limit, key, outage) does not reach Radar, and a guess could point the wrong way.
 */
export const MODEL_UNAVAILABLE =
  "The model is unavailable. If this lasts, check the provider's credit or key.";

/** Kept in the profile's counters, so the wait survives a restart. */
export type RadarOutage = { failures: number; until: string };

export function readOutage(value: unknown): RadarOutage | undefined {
  const row = asRecord(value);
  const failures = Number(row.failures);
  const until = typeof row.until === "string" ? Date.parse(row.until) : Number.NaN;
  if (!Number.isInteger(failures) || failures < 1 || !Number.isFinite(until)) return undefined;
  return { failures: Math.min(failures, MAX_FAILURES), until: new Date(until).toISOString() };
}

/** How long model work waits after the nth failure in a row. */
export const outageWait = (failures: number) =>
  Math.min(OUTAGE_MAX_WAIT_MS, OUTAGE_FIRST_WAIT_MS * 2 ** (Math.max(1, failures) - 1));

/**
 * An owner who asks for a check wants the model asked again now: the wait ends but the count
 * stays, so a model that is still down waits longer next time. Undefined when nothing waits.
 */
export function withoutOutageWait(
  counters: unknown,
  now: Date,
): Record<string, unknown> | undefined {
  const outage = readOutage(asRecord(counters).outage);
  if (!outage) return undefined;
  const until = new Date(Math.min(Date.parse(outage.until), now.getTime())).toISOString();
  return { ...asRecord(counters), outage: { ...outage, until } };
}

export type ModelFailureReason =
  | "credit"
  | "rate_limit"
  | "auth"
  | "server"
  | "timeout"
  | "engine"
  | "network"
  | "unknown";

/** An HTTP status on the error, on its response, or further down its causes. */
function statusOn(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== "object" || depth > 3) return undefined;
  const row = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "httpStatus"]) {
    const status = Number(row[key]);
    if (Number.isInteger(status) && status >= 100 && status < 600) return status;
  }
  return statusOn(row.response, depth + 1) ?? statusOn(row.cause, depth + 1);
}

/** Name, code and message of the error and of its causes. */
function textOf(error: unknown, depth = 0): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object" || depth > 3) return "";
  const row = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  return [row.name, row.code, row.message]
    .filter((part): part is string => typeof part === "string")
    .concat(row.cause ? [textOf(row.cause, depth + 1)] : [])
    .join(" ");
}

const CREDIT =
  /insufficient[ _-]?(?:balance|credit|fund|quota)|credit balance|out of credit|no credits?|payment required|billing|exceeded your (?:current )?quota/i;
const RATE_LIMIT = /rate[ _-]?limit|too many requests|throttl|quota/i;
const AUTH = /unauthori[sz]ed|forbidden|api[ _-]?key|authentication|permission denied/i;
const TIMEOUT = /time(?:d)?[ -]?out|ETIMEDOUT|ESOCKETTIMEDOUT/i;
const SERVER =
  /overloaded|bad gateway|service unavailable|gateway time-?out|internal server error|server error/i;
/** What the Codex runtime and its model bridge say; both hide the provider's own error. */
const ENGINE = /codex|agent engine|model connection|model request failed/i;
const NETWORK =
  /ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR|fetch failed|socket hang up|network|connection (?:error|closed|reset|refused|lost)|terminated|disconnected/i;

/**
 * Names why a model call got no answer, for the log. It decides nothing: a call that threw or
 * timed out is a provider failure whatever the message says, and what reaches Radar differs by
 * runtime (an HTTP status and body, a network code, or only "the model connection failed").
 * Recognized causes are named; anything else is `unknown`.
 */
export function describeModelFailure(error: unknown): {
  reason: ModelFailureReason;
  status?: number;
} {
  const text = textOf(error);
  const inText = /\b(401|402|403|408|429|5\d\d)\b/.exec(text)?.[1];
  const status = statusOn(error) ?? (inText ? Number(inText) : undefined);
  const named = (reason: ModelFailureReason) => ({
    reason,
    ...(status === undefined ? {} : { status }),
  });
  // A balance message beats the status: some providers answer 429 for an empty balance.
  if (status === 402 || CREDIT.test(text)) return named("credit");
  if (status === 429 || RATE_LIMIT.test(text)) return named("rate_limit");
  if (status === 401 || status === 403 || AUTH.test(text)) return named("auth");
  if (status === 408 || status === 504 || TIMEOUT.test(text)) return named("timeout");
  if ((status !== undefined && status >= 500) || SERVER.test(text)) return named("server");
  if (ENGINE.test(text)) return named("engine");
  if (NETWORK.test(text)) return named("network");
  return named("unknown");
}

/**
 * The cycle's view of the model provider: whether work waits, and what a pass tells us about
 * it. A failure starts or extends the wait; any answer from the model ends it.
 */
export function modelHealth(now: Date, stored: RadarOutage | undefined) {
  let outage = stored;
  const holding = () => Boolean(outage && Date.parse(outage.until) > now.getTime());
  const failed = (error: unknown) => {
    // Already waiting: a second failure in the same cycle adds nothing.
    if (holding()) return;
    // A series that went quiet for longer than the longest wait starts over.
    const previous =
      outage && now.getTime() - Date.parse(outage.until) < OUTAGE_MAX_WAIT_MS ? outage.failures : 0;
    const failures = Math.min(previous + 1, MAX_FAILURES);
    const wait = outageWait(failures);
    outage = { failures, until: new Date(now.getTime() + wait).toISOString() };
    getLogger().warn("radar model unavailable", {
      ...describeModelFailure(error),
      failures,
      retryInMinutes: Math.round(wait / 60_000),
    });
  };
  const answered = () => {
    if (!outage) return;
    getLogger().info("radar model answered again", { failures: outage.failures });
    outage = undefined;
  };
  return {
    /** The stored outage, if the model has not answered since. */
    get outage() {
      return outage;
    },
    /** Model work waits: a pass failed and its wait has not run out. */
    holding,
    /** When the wait ends, while it lasts. */
    until: () => (outage && holding() ? new Date(outage.until) : undefined),
    /** A pass that got no answer: starts the wait, or doubles it. */
    failed,
    /** Keeps the outage in step with what a pass came back with. */
    track<T extends JsonPassResult>(result: T): T {
      if (result.status === "failed") failed(result.error);
      else answered();
      return result;
    },
  };
}

export type ModelHealth = ReturnType<typeof modelHealth>;
