import type { RadarUpdate, RadarView } from "@rakazo/contracts";
import {
  RADAR_EVIDENCE_MAX,
  RADAR_OFFER_MAX,
  RADAR_VIEW_EXCERPT_MAX,
  RadarAction,
  RadarActorSchema,
  RadarDisposition,
  RadarFeedbackKind,
  RadarTraceSchema,
  RadarUpdateState,
  RadarUpdatesInput,
  RadarUrgency,
} from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import type { ZodType } from "zod";
import { RadarError } from "./errors.js";
import type { RadarOwner } from "./profile.js";
import { radarOwner } from "./profile.js";

type SignalRow = Prisma.RadarSignalGetPayload<{
  include: { message: { select: { threadId: true } } };
}>;
export const updateInclude = { message: { select: { threadId: true } } } as const;

/** Stored values a newer or older build wrote outside the contract are left out, not fatal. */
function valid<T>(schema: ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const text = (value: string | null | undefined) => (value?.trim() ? value : undefined);

export function radarUpdateView(row: SignalRow): RadarUpdate {
  const actor = valid(RadarActorSchema, row.actor);
  const decided = row.status === "decided";
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    title: text(row.headline) ?? row.title,
    ...(actor && (actor.name || actor.address) ? { actor } : {}),
    occurredAt: row.occurredAt.toISOString(),
    ...(row.url && /^https?:\/\/\S+$/i.test(row.url) ? { url: row.url } : {}),
    excerpt: row.excerpt.slice(0, RADAR_VIEW_EXCERPT_MAX),
    ...(row.importance === null
      ? {}
      : { importance: Math.min(100, Math.max(0, Math.round(row.importance))) }),
    urgency: valid(RadarUrgency, row.urgency),
    action: valid(RadarAction, row.action),
    why: text(row.why),
    nextStep: text(row.nextStep),
    offer: text(row.offer)?.slice(0, RADAR_OFFER_MAX),
    evidence: text(row.evidence)?.slice(0, RADAR_EVIDENCE_MAX),
    disposition: valid(RadarDisposition, row.disposition),
    reason: text(row.reason),
    // Undecided and untouched by the owner reads as pending.
    state:
      !decided && row.state === "open" ? "pending" : (valid(RadarUpdateState, row.state) ?? "open"),
    snoozedUntil: row.snoozedUntil?.toISOString(),
    feedback: valid(RadarFeedbackKind, row.feedback),
    deliveredAt: row.deliveredAt?.toISOString(),
    messageId: row.messageId ?? undefined,
    threadId: row.message?.threadId,
    trace: valid(RadarTraceSchema, row.trace),
  };
}

/**
 * "Needs you" (open): updates for the owner that are still open, including skipped ones
 * the owner marked important and snoozes whose time has come. Brief and skipped list what
 * was decided for the brief or kept silent; all is the full history.
 */
function viewWhere(view: RadarView, now: Date): Prisma.RadarSignalWhereInput {
  switch (view) {
    case "open":
      return {
        OR: [
          { state: "open", disposition: { in: ["interrupt", "brief"] } },
          { state: "open", feedback: "important" },
          { state: "snoozed", snoozedUntil: { lte: now } },
        ],
      };
    case "brief":
      return { disposition: "brief" };
    case "skipped":
      return { disposition: "silent" };
    case "all":
      return {};
  }
}

/** Open is short and ranked in memory; anything beyond this is the least important. */
const OPEN_VIEW_MAX = 500;
const URGENCY_RANK: Record<string, number> = { now: 0, today: 1, week: 2, none: 3 };
type SortKey = Array<number | string>;

function compareKeys(a: SortKey, b: SortKey): number {
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!;
    const right = b[index]!;
    if (left === right) continue;
    return left < right ? -1 : 1;
  }
  return 0;
}

const openSortKey = (row: SignalRow): SortKey => [
  URGENCY_RANK[row.urgency ?? "none"] ?? 3,
  -(row.importance ?? -1),
  -row.occurredAt.getTime(),
  row.id,
];
const historySortKey = (row: SignalRow): SortKey => [row.occurredAt.getTime(), row.id];

const encodeCursor = (key: SortKey) => Buffer.from(JSON.stringify(key)).toString("base64url");

function decodeCursor(cursor: string, shape: Array<"number" | "string">): SortKey {
  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(key) &&
      key.length === shape.length &&
      key.every((item, index) => typeof item === shape[index])
    )
      return key as SortKey;
  } catch {
    // reported below
  }
  throw new RadarError("BAD_REQUEST", "This list changed. Refresh it.");
}

export async function listRadarUpdates(
  prisma: PrismaClient,
  scope: RadarOwner,
  input: unknown,
  now = new Date(),
): Promise<{ items: RadarUpdate[]; nextCursor?: string }> {
  const { view, limit, cursor } = RadarUpdatesInput.parse(input);
  const key = radarOwner(scope);
  if (view === "open") {
    const after = cursor ? decodeCursor(cursor, ["number", "number", "number", "string"]) : null;
    const rows = await prisma.radarSignal.findMany({
      where: { ...key, ...viewWhere(view, now) },
      include: updateInclude,
      orderBy: [{ importance: { sort: "desc", nulls: "last" } }, { occurredAt: "desc" }],
      take: OPEN_VIEW_MAX,
    });
    const ranked = rows
      .map((row) => ({ row, sortKey: openSortKey(row) }))
      .sort((a, b) => compareKeys(a.sortKey, b.sortKey))
      .filter((entry) => !after || compareKeys(entry.sortKey, after) > 0);
    const page = ranked.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((entry) => radarUpdateView(entry.row)),
      ...(ranked.length > limit && last ? { nextCursor: encodeCursor(last.sortKey) } : {}),
    };
  }
  const after = cursor ? decodeCursor(cursor, ["number", "string"]) : null;
  const before = after ? new Date(after[0] as number) : null;
  const rows = await prisma.radarSignal.findMany({
    where: {
      ...key,
      AND: [
        viewWhere(view, now),
        before
          ? {
              OR: [
                { occurredAt: { lt: before } },
                { occurredAt: before, id: { lt: after![1] as string } },
              ],
            }
          : {},
      ],
    },
    include: updateInclude,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(radarUpdateView),
    ...(rows.length > limit && last ? { nextCursor: encodeCursor(historySortKey(last)) } : {}),
  };
}
