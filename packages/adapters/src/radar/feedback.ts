import type { RadarFeedbackKind, RadarUpdate } from "@rakazo/contracts";
import { RadarFeedbackInput } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { RadarError } from "./errors.js";
import type { RadarSender, SenderHistory } from "./learned.js";
import { LEARNING_WINDOW_MS, learnFromFeedback, parseLearned, senderOf } from "./learned.js";
import type { RadarOwner, RadarTx } from "./profile.js";
import { commitRadarProfile, lockRadarProfile, radarOwner } from "./profile.js";
import { radarUpdateView, updateInclude } from "./updates.js";

const SNOOZE_MAX_MS = 30 * 86_400_000;
const LEARNING_KINDS = new Set<RadarFeedbackKind>([
  "not_important",
  "important",
  "mute_sender",
  "always_sender",
]);

/** How one piece of feedback changes the update itself. A done update stays done. */
export function feedbackChange(
  signal: { state: string; feedback: string | null },
  kind: RadarFeedbackKind,
  now: Date,
  until?: Date,
): Prisma.RadarSignalUpdateInput {
  const given = { feedback: kind, feedbackAt: now };
  const keepDone = (state: string) => (signal.state === "done" ? "done" : state);
  switch (kind) {
    case "opened":
      // Implicit: never overwrites what the owner said explicitly.
      return signal.feedback ? {} : given;
    case "done":
      return { ...given, state: "done", snoozedUntil: null };
    case "snooze":
      return { ...given, state: "snoozed", snoozedUntil: until ?? null };
    case "not_important":
    case "mute_sender":
      return { ...given, state: keepDone("dismissed"), snoozedUntil: null };
    case "important":
    case "always_sender":
      return { ...given, state: keepDone("open"), snoozedUntil: null };
  }
}

async function senderHistory(
  tx: RadarTx,
  scope: RadarOwner,
  sender: RadarSender,
  now: Date,
): Promise<SenderHistory> {
  const rows = await tx.radarSignal.findMany({
    where: {
      ...radarOwner(scope),
      feedback: { in: ["important", "not_important"] },
      feedbackAt: { gte: new Date(now.getTime() - LEARNING_WINDOW_MS) },
    },
    select: { actor: true, feedback: true },
  });
  const mine = rows.filter((row) => senderOf(row.actor)?.address === sender.address);
  return {
    important: mine.filter((row) => row.feedback === "important").length,
    notImportant: mine.filter((row) => row.feedback === "not_important").length,
  };
}

/**
 * Records the owner's reaction to an update and applies the deterministic learning rules
 * in the same transaction. Repeating the same feedback teaches nothing new.
 */
export async function applyRadarFeedback(
  prisma: PrismaClient,
  scope: RadarOwner,
  input: unknown,
  now = new Date(),
): Promise<RadarUpdate> {
  const { id, kind, until } = RadarFeedbackInput.parse(input);
  const snoozeUntil = until ? new Date(until) : undefined;
  if (snoozeUntil && snoozeUntil.getTime() <= now.getTime())
    throw new RadarError("BAD_REQUEST", "Choose a time in the future.");
  if (snoozeUntil && snoozeUntil.getTime() > now.getTime() + SNOOZE_MAX_MS)
    throw new RadarError("BAD_REQUEST", "Choose a time within 30 days.");
  const key = radarOwner(scope);
  return prisma.$transaction(async (tx) => {
    const profile = await lockRadarProfile(tx, key);
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "radar_signals" WHERE id = ${id} AND "spaceId" = ${key.spaceId} AND "userId" = ${key.userId} FOR UPDATE`;
    if (!locked.length) throw new RadarError("NOT_FOUND", "This update is no longer available.");
    const signal = await tx.radarSignal.findUniqueOrThrow({ where: { id } });
    const sender = senderOf(signal.actor);
    if ((kind === "mute_sender" || kind === "always_sender") && !sender)
      throw new RadarError("BAD_REQUEST", "This update has no sender to remember.");
    const change = feedbackChange(signal, kind, now, snoozeUntil);
    const updated = Object.keys(change).length
      ? await tx.radarSignal.update({ where: { id }, data: change, include: updateInclude })
      : await tx.radarSignal.findUniqueOrThrow({ where: { id }, include: updateInclude });
    if (LEARNING_KINDS.has(kind) && signal.feedback !== kind) {
      const learned = parseLearned(profile.learned);
      const history = sender
        ? await senderHistory(tx, key, sender, now)
        : { important: 0, notImportant: 0 };
      const next = learnFromFeedback(learned, kind, sender, history, now);
      if (next !== learned) await commitRadarProfile(tx, profile, { learned: next });
    }
    return radarUpdateView(updated);
  });
}
