import { type Actor, EFFECTS_LIST_MAX_LIMIT, type EffectReceipt } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

/**
 * Receipts over `ExternalEffect`.
 *
 * `ExternalEffect.request` is the raw tool payload and can hold anything the
 * model passed, including a secret it was told to use. It is never returned.
 * What crosses the wire is the same bounded key set that already reaches the
 * visible approval card (`buildApprovalAskBlock` in `@rakazo/adapters`), so a
 * receipt can only ever repeat what the person was shown when they approved.
 */
const SUMMARY_KEYS = ["to", "subject", "title", "collection", "amount", "body"] as const;

const SUMMARY_VALUE_MAX_LENGTH = 280;

function summaryValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return null;
    return text.length > SUMMARY_VALUE_MAX_LENGTH
      ? `${text.slice(0, SUMMARY_VALUE_MAX_LENGTH - 1)}…`
      : text;
  }
  return null;
}

/** The named fields of a tool call, in a fixed order, nested objects excluded. */
export function effectSummaryRows(request: unknown): Array<{ k: string; v: string }> {
  if (!request || typeof request !== "object" || Array.isArray(request)) return [];
  const record = request as Record<string, unknown>;
  const rows: Array<{ k: string; v: string }> = [];
  for (const key of SUMMARY_KEYS) {
    const value = summaryValue(record[key]);
    if (value !== null) rows.push({ k: key, v: value });
  }
  return rows;
}

export type EffectRow = {
  id: string;
  runId: string;
  kind: string;
  status: string;
  request: unknown;
  reviewDecision: string | null;
  reviewReason: string | null;
  reviewModel: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toEffectReceipt(row: EffectRow): EffectReceipt {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    status: row.status,
    summary: effectSummaryRows(row.request),
    reviewDecision: row.reviewDecision,
    reviewReason: row.reviewReason,
    reviewModel: row.reviewModel,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSpaceEffects(
  prisma: PrismaClient,
  actor: Actor,
  input: { runId?: string; limit?: number },
): Promise<EffectReceipt[]> {
  const rows = await prisma.externalEffect.findMany({
    where: {
      spaceId: actor.spaceId,
      // The run carries the ownership; an effect is only ever the caller's own.
      run: { userId: actor.userId, spaceId: actor.spaceId },
      ...(input.runId ? { runId: input.runId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(input.limit ?? EFFECTS_LIST_MAX_LIMIT, EFFECTS_LIST_MAX_LIMIT),
  });
  return rows.map(toEffectReceipt);
}
