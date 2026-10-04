import type { RadarPerson, RadarRule, RadarSettings } from "@rakazo/contracts";
import { RadarPersonRemove, RadarRuleChange, RadarSettingsSchema } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { RadarError } from "./errors.js";
import { newRule, parseLearned, withoutPerson, withoutRule, withRule } from "./learned.js";

export type RadarOwner = { spaceId: string; userId: string };
export type RadarTx = Prisma.TransactionClient;
type ProfileRow = Awaited<ReturnType<RadarTx["radarProfile"]["findUniqueOrThrow"]>>;

/** Only the owner keys, so a wider actor object never leaks into a query. */
export const radarOwner = (scope: RadarOwner): RadarOwner => ({
  spaceId: scope.spaceId,
  userId: scope.userId,
});

/** Creates the profile on first use and locks it for the rest of the transaction. */
export async function lockRadarProfile(tx: RadarTx, scope: RadarOwner): Promise<ProfileRow> {
  const key = radarOwner(scope);
  await tx.radarProfile.createMany({ data: [key], skipDuplicates: true });
  await tx.$queryRaw`SELECT 1 FROM "radar_profiles" WHERE "spaceId" = ${key.spaceId} AND "userId" = ${key.userId} FOR UPDATE`;
  return tx.radarProfile.findUniqueOrThrow({ where: { spaceId_userId: key } });
}

/**
 * Saves a settings, source or learning change and bumps the version, so a cycle that
 * decided against the previous version can tell its decisions are stale.
 */
export async function commitRadarProfile(
  tx: RadarTx,
  row: ProfileRow,
  data: Prisma.RadarProfileUpdateManyMutationInput,
) {
  const { count } = await tx.radarProfile.updateMany({
    where: { spaceId: row.spaceId, userId: row.userId, version: row.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (count !== 1) throw new RadarError("CONFLICT", "Radar changed. Try again.");
}

export function readRadarSettings(value: unknown): RadarSettings {
  return RadarSettingsSchema.parse(value ?? {});
}

export async function listRadarRules(prisma: PrismaClient, scope: RadarOwner) {
  const row = await prisma.radarProfile.findUnique({
    where: { spaceId_userId: radarOwner(scope) },
    select: { learned: true },
  });
  return parseLearned(row?.learned).rules;
}

/** Owner-made rules are explicit; removing one that learning made is allowed too. */
export async function changeRadarRule(
  prisma: PrismaClient,
  scope: RadarOwner,
  input: unknown,
  now = new Date(),
): Promise<RadarRule[]> {
  const change = RadarRuleChange.parse(input);
  return prisma.$transaction(async (tx) => {
    const row = await lockRadarProfile(tx, scope);
    const learned = parseLearned(row.learned);
    const next = change.add
      ? withRule(
          learned,
          newRule(change.add.kind, change.add.match, "explicit", now, change.add.note || undefined),
        )
      : withoutRule(learned, change.removeId ?? "");
    if (next !== learned) await commitRadarProfile(tx, row, { learned: next });
    return next.rules;
  });
}

/** Ask the scheduler for a cycle (and, with `brief`, a brief) as soon as possible. */
export async function requestRadarCycle(
  prisma: PrismaClient,
  scope: RadarOwner,
  options: { brief: boolean },
  now = new Date(),
) {
  const key = radarOwner(scope);
  await prisma.$transaction(async (tx) => {
    const row = await lockRadarProfile(tx, key);
    if (!readRadarSettings(row.settings).enabled)
      throw new RadarError("BAD_REQUEST", "Turn on Radar first.");
    // Scheduling state only: no version bump, so a running cycle stays valid.
    await tx.radarProfile.update({
      where: { spaceId_userId: key },
      data: {
        nextCycleAt: now,
        ...(options.brief ? { briefRequestedAt: row.briefRequestedAt ?? now } : {}),
      },
    });
    if (!options.brief)
      await tx.radarSource.updateMany({
        where: { ...key, enabled: true },
        data: { nextCheckAt: now },
      });
  });
}

/** Forget a learned or explicit person; nightly synthesis will not add them back. */
export async function forgetRadarPerson(
  prisma: PrismaClient,
  scope: RadarOwner,
  input: unknown,
): Promise<RadarPerson[]> {
  const key = RadarPersonRemove.parse(input);
  return prisma.$transaction(async (tx) => {
    const row = await lockRadarProfile(tx, scope);
    const learned = parseLearned(row.learned);
    const next = withoutPerson(learned, key);
    if (next !== learned) await commitRadarProfile(tx, row, { learned: next });
    return next.people;
  });
}

const PRESENCE_THROTTLE_MS = 30_000;

/**
 * A desktop or web client read the personal thread: Radar delivers into the conversation
 * without a push for a short while. Throttled; never creates a profile.
 */
export async function recordRadarPresence(
  prisma: PrismaClient,
  scope: RadarOwner,
  now = new Date(),
) {
  await prisma.radarProfile
    .updateMany({
      where: {
        ...radarOwner(scope),
        OR: [
          { presenceAt: null },
          { presenceAt: { lt: new Date(now.getTime() - PRESENCE_THROTTLE_MS) } },
        ],
      },
      data: { presenceAt: now },
    })
    .catch(() => undefined);
}
