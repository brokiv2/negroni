import type { RadarSettings } from "@rakazo/contracts";
import { FeedProfileSchema, RadarSettingsPatch, RadarSettingsSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { RadarOwner } from "./profile.js";
import { commitRadarProfile, lockRadarProfile, radarOwner, readRadarSettings } from "./profile.js";
import type { RadarRegistry } from "./sources.js";
import { selectFirstRadarSources } from "./sources.js";

/** Omitted fields, including fields inside quiet hours and briefs, keep their saved value. */
export function mergeRadarSettings(
  previous: RadarSettings,
  patch: RadarSettingsPatch,
): RadarSettings {
  const defined = <T extends object>(value: T | undefined) =>
    Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item !== undefined));
  return RadarSettingsSchema.parse({
    ...previous,
    ...defined(patch),
    quietHours: { ...previous.quietHours, ...defined(patch.quietHours) },
    morningBrief: { ...previous.morningBrief, ...defined(patch.morningBrief) },
    eveningBrief: { ...previous.eveningBrief, ...defined(patch.eveningBrief) },
  });
}

export const isRadarPaused = (settings: RadarSettings, now: Date) =>
  Boolean(settings.pausedUntil && Date.parse(settings.pausedUntil) > now.getTime());

/**
 * Applies a settings patch. Turning Radar on or resuming it schedules a cycle now; the
 * first time it is turned on, it carries over the time zone and accounts of the earlier
 * connected-account research.
 */
export async function configureRadar(
  prisma: PrismaClient,
  registry: RadarRegistry,
  scope: RadarOwner,
  input: unknown,
  now = new Date(),
) {
  const patch = RadarSettingsPatch.parse(input);
  const key = radarOwner(scope);
  await prisma.$transaction(async (tx) => {
    const row = await lockRadarProfile(tx, key);
    const previous = readRadarSettings(row.settings);
    let settings = mergeRadarSettings(previous, patch);
    const enabling = settings.enabled && !previous.enabled;
    if (enabling) {
      const feed = FeedProfileSchema.safeParse(
        (await tx.feedProfile.findUnique({ where: { spaceId_userId: key } }))?.data ?? {},
      );
      if (feed.success && patch.timeZone === undefined && settings.timeZone === "UTC")
        settings = { ...settings, timeZone: feed.data.accountTimeZone };
      await selectFirstRadarSources(
        tx,
        registry,
        key,
        feed.success ? feed.data.accountResearchIds : [],
        now,
      );
    }
    if (!enabling && JSON.stringify(settings) === JSON.stringify(previous)) return;
    const resuming =
      settings.enabled && isRadarPaused(previous, now) && !isRadarPaused(settings, now);
    await commitRadarProfile(tx, row, {
      settings,
      ...(enabling ? { nextCycleAt: now, error: null } : resuming ? { nextCycleAt: now } : {}),
      ...(previous.enabled && !settings.enabled ? { nextCycleAt: null } : {}),
    });
  });
}
