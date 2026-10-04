import { createHash } from "node:crypto";
import type {
  AdapterContext,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import type { MessageBlock, RadarAction } from "@rakazo/contracts";
import { mainAssistantBot } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  ensurePersonalThread,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { RadarOwner } from "./profile.js";
import { lockRadarProfile, radarOwner } from "./profile.js";
import { radarPushExpiry } from "./schedule.js";
import { accountLabel } from "./updates.js";

/** A desktop or web client that read the personal thread this recently gets no push. */
export const PRESENCE_WINDOW_MS = 90_000;

export type RadarDeliveryDeps = {
  prisma: PrismaClient;
  notifications?: NotificationProvider;
  events?: Pick<ThreadEvents, "notify">;
};

export type DeliverableSignal = {
  id: string;
  source: string;
  kind: string;
  storyKey: string | null;
  title: string;
  headline: string | null;
  why: string | null;
  nextStep: string | null;
  offer: string | null;
  evidence: string | null;
  url: string | null;
  actor: unknown;
  urgency: string | null;
  action: string | null;
  importance: number | null;
  occurredAt: Date;
  deadline: Date | null;
  trace: unknown;
  meta: unknown;
  /** The account the update came from, for its card. */
  connection?: { displayName: string; metadata: unknown } | null;
};

/** The main assistant and its personal thread, created on first use. */
export async function radarConversation(prisma: PrismaClient, scope: RadarOwner) {
  const owner = radarOwner(scope);
  const bots = await prisma.bot.findMany({
    where: { ...owner, archivedAt: null },
    select: {
      id: true,
      pinned: true,
      parentBotId: true,
      createdAt: true,
      _count: { select: { threads: { where: { kind: "personal" } } } },
    },
  });
  const root = mainAssistantBot(
    bots.map(({ _count, ...bot }) => ({
      ...bot,
      createdAt: bot.createdAt.toISOString(),
      hasPersonalThread: (_count?.threads ?? 0) > 0,
    })),
  );
  if (!root) return null;
  const thread = await ensurePersonalThread(prisma, { ...owner, botId: root.id });
  return { botId: root.id, threadId: thread.id };
}

const ACTIONS: RadarAction[] = ["reply", "decide", "attend", "review", "pay", "read", "none"];
const asAction = (value: string | null): RadarAction =>
  ACTIONS.find((action) => action === value) ?? "none";
const URGENCIES = ["now", "today", "week", "none"] as const;
const short = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** Name and address as a card shows them; nothing when neither is known. */
export function blockActor(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" && row.name ? short(row.name, 280) : undefined;
  const address =
    typeof row.address === "string" && row.address ? short(row.address, 320) : undefined;
  return name || address
    ? { ...(name ? { name } : {}), ...(address ? { address } : {}) }
    : undefined;
}

/** The card for one update. Emitters stay strict: every field fits the block contract. */
export function updateBlock(signal: DeliverableSignal): Extract<MessageBlock, { kind: "update" }> {
  const title = short(signal.headline || signal.title, 280);
  const why = short(signal.why || title, 280);
  const actor = blockActor(signal.actor);
  const account = accountLabel(signal.connection);
  const urgency = URGENCIES.find((value) => value === signal.urgency) ?? "none";
  return {
    kind: "update",
    summary: short(`${title}. ${why}`, 280),
    updateId: signal.id,
    source: short(signal.source, 64),
    ...(account ? { account: short(account, 320) } : {}),
    title,
    ...(actor ? { actor } : {}),
    why,
    ...(signal.nextStep ? { nextStep: short(signal.nextStep, 280) } : {}),
    ...(signal.offer ? { offer: short(signal.offer, 80) } : {}),
    ...(signal.evidence ? { evidence: short(signal.evidence, 300) } : {}),
    ...(signal.url && /^https?:\/\/\S+$/i.test(signal.url) && signal.url.length <= 4096
      ? { url: signal.url }
      : {}),
    urgency,
    action: asAction(signal.action),
    occurredAt: signal.occurredAt.toISOString(),
  };
}

export const pushCategory = (action: string | null) =>
  action === "reply" ? "RADAR_REPLY" : action === "decide" ? "RADAR_DECIDE" : "RADAR_GENERIC";

const gates = (trace: unknown): string[] =>
  trace && typeof trace === "object" && Array.isArray((trace as { gates?: unknown }).gates)
    ? ((trace as { gates: unknown[] }).gates.filter((gate) => typeof gate === "string") as string[])
    : [];

/** Collapse ids and thread ids must stay short; story keys can be long provider ids. */
export const storyGroupKey = (storyKey: string | null, fallback: string) =>
  `radar:${createHash("sha256")
    .update(storyKey || fallback)
    .digest("hex")
    .slice(0, 24)}`;

const CALENDAR_KINDS = new Set(["invite", "event_changed", "event_cancelled", "prep"]);

/**
 * Delivers interrupts as one message (a lead sentence, then one card each) and one push.
 * Message, delivery keys and signal state commit together; the push follows the commit and a
 * failed push never repeats the message. Items whose key was already used are skipped.
 */
export async function deliverInterrupts(
  deps: RadarDeliveryDeps,
  scope: RadarOwner,
  conversation: { botId: string; threadId: string },
  items: Array<{ signal: DeliverableSignal; key: string }>,
  now: Date,
): Promise<string | null> {
  if (!items.length) return null;
  const owner = radarOwner(scope);
  const ordered = [...items].sort(
    (a, b) => (b.signal.importance ?? 0) - (a.signal.importance ?? 0),
  );
  const batchKey = createHash("sha256")
    .update(ordered.map((item) => item.key).join("\n"))
    .digest("hex")
    .slice(0, 32);
  const committed = await deps.prisma.$transaction(async (tx) => {
    const profile = await lockRadarProfile(tx, owner);
    const used = await tx.radarSignal.findMany({
      where: { deliveryKey: { in: ordered.map((item) => item.key) } },
      select: { deliveryKey: true },
    });
    const usedKeys = new Set(used.map((row) => row.deliveryKey));
    const fresh = ordered.filter((item) => !usedKeys.has(item.key));
    if (!fresh.length) return null;
    const top = fresh[0]!.signal;
    const lead = (() => {
      const meta = top.meta as Record<string, unknown> | null;
      const value = typeof meta?.lead === "string" ? meta.lead.trim() : "";
      return value || short(top.headline || top.title, 280);
    })();
    const blocks: MessageBlock[] = [
      { kind: "text", text: lead },
      ...fresh.map((item) => updateBlock(item.signal)),
    ];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: conversation.threadId,
      botId: conversation.botId,
      role: "bot",
      blocks,
      clientNonce: `radar:${batchKey}`,
    });
    const event = await appendEventInTransaction(tx, {
      spaceId: owner.spaceId,
      threadId: conversation.threadId,
      botId: conversation.botId,
      type: "thread.message.created",
      payload: { messageId: message.id, role: "bot", blocks },
    });
    for (const item of fresh)
      await tx.radarSignal.update({
        where: { id: item.signal.id },
        data: {
          deliveredAt: now,
          messageId: message.id,
          deliveryKey: item.key,
          deliverAt: null,
          held: false,
          state: "open",
          snoozedUntil: null,
        },
      });
    return { message, seq: event.seq, top, count: fresh.length, presenceAt: profile.presenceAt };
  });
  if (!committed) return null;
  await deps.events?.notify(conversation.threadId, committed.seq).catch((error) => {
    getLogger().error("radar message realtime notification", error);
  });
  const watching =
    committed.presenceAt && now.getTime() - committed.presenceAt.getTime() < PRESENCE_WINDOW_MS;
  if (deps.notifications && !watching) {
    const top = committed.top;
    const critical = gates(top.trace).includes("critical");
    const soon =
      CALENDAR_KINDS.has(top.kind) &&
      top.deadline !== null &&
      top.deadline.getTime() - now.getTime() <= 3_600_000;
    const body = [top.why, top.offer].filter(Boolean).join(" ");
    const message: NotificationMessage = {
      kind: "radar",
      threadKind: "personal",
      spaceId: owner.spaceId,
      botId: conversation.botId,
      threadId: conversation.threadId,
      title: short(top.headline || top.title, 120),
      body: short(body || top.title, 400),
      category: pushCategory(top.action),
      interruptionLevel: critical || soon ? "time-sensitive" : "active",
      relevanceScore: Math.min(1, Math.max(0, (top.importance ?? 0) / 100)),
      groupKey: storyGroupKey(top.storyKey, top.id),
      messageId: committed.message.id,
      updateId: top.id,
      expiresAt: radarPushExpiry("update", now, top.deadline),
    };
    await sendPush(deps.notifications, message, owner, "radar-interrupt");
  }
  getLogger().info("radar interrupt delivered", { items: committed.count });
  return committed.message.id;
}

export async function sendPush(
  notifications: NotificationProvider,
  message: NotificationMessage,
  owner: RadarOwner,
  operationId: string,
) {
  const context: AdapterContext = {
    operationId,
    traceId: message.updateId ?? message.messageId ?? operationId,
    spaceId: owner.spaceId,
    userId: owner.userId,
    botId: message.botId,
    signal: AbortSignal.timeout(15_000),
  };
  await notifications
    .send(message, context)
    .catch((error) => getLogger().error("radar push delivery", error));
}
