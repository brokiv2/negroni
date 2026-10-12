import { createHash } from "node:crypto";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function measure(value: string) {
  return {
    bytes: Buffer.byteLength(value, "utf8"),
    fingerprint: createHash("sha256").update(value).digest("hex"),
  };
}
/** Counts and digests only. Never retain prompts, tool arguments, images, or credentials. */
export function describeRunContext(
  request: Pick<
    AgentRunRequest,
    "instructions" | "prompt" | "history" | "tools" | "currentTurnImages"
  >,
  options: {
    volatileSections?: readonly (string | undefined)[];
    compacted: boolean;
    summaryBytes: number;
  },
) {
  const instructions = request.instructions ?? "";
  const volatileStart = (options.volatileSections ?? [])
    .filter((s): s is string => Boolean(s))
    .map((s) => instructions.indexOf(s))
    .filter((index) => index >= 0);
  const prefix = instructions.slice(
    0,
    volatileStart.length ? Math.min(...volatileStart) : instructions.length,
  );
  const catalog = request.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  const tools = JSON.stringify(catalog);
  return {
    version: 1,
    scope: "executor_request",
    instructions: measure(instructions),
    stablePrefix: measure(prefix),
    promptBytes: Buffer.byteLength(request.prompt, "utf8"),
    history: {
      messages: request.history.length,
      textBytes: request.history.reduce((sum, m) => sum + Buffer.byteLength(m.content, "utf8"), 0),
      compacted: options.compacted,
      summaryBytes: options.summaryBytes,
    },
    tools: {
      ...measure(tools),
      shapeFingerprint: measure(JSON.stringify(canonical(catalog))).fingerprint,
      count: request.tools.length,
    },
    images: {
      current: request.currentTurnImages?.length ?? 0,
      historical: request.history.reduce((sum, m) => sum + (m.images?.length ?? 0), 0),
    },
  };
}
export function describeContextUsage(event: Extract<AgentRuntimeEvent, { type: "usage" }>) {
  const reported =
    event.cacheUsageReported ?? (event.cacheReadTokens > 0 || event.cacheWriteTokens > 0);
  const input = event.inputTokens,
    read = event.cacheReadTokens ?? 0;
  return {
    provider: event.provider,
    model: event.model,
    inputTokens: input,
    outputTokens: event.outputTokens,
    cacheReadTokens: read,
    cacheWriteTokens: event.cacheWriteTokens ?? 0,
    cacheReported: reported,
    cacheReadFraction: reported && input > 0 ? Math.min(1, Math.max(0, read / input)) : null,
  };
}
