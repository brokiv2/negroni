import type { RadarSourceState, RadarSourceStatus } from "@rakazo/contracts";
import { isRadarSource, RadarSourceInput } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { AppCatalogRegistry } from "../app-connection-tools.js";
import { connectionAccountLabel } from "../app-connection-tools.js";
import { localDate } from "./clock.js";
import { RadarError } from "./errors.js";
import type { RadarOwner, RadarTx } from "./profile.js";
import { commitRadarProfile, lockRadarProfile, radarOwner } from "./profile.js";

/** Radar lists accounts of managed connectors only; without a registry every row counts. */
export type RadarRegistry = Pick<AppCatalogRegistry, "managed"> | undefined;

/** The owner's accounts that are or were connected. Pending authorizations are left out. */
async function ownerConnections(db: RadarTx, registry: RadarRegistry, scope: RadarOwner) {
  const rows = await db.connection.findMany({
    where: { ...radarOwner(scope), status: { in: ["connected", "revoked", "error"] } },
    orderBy: { createdAt: "asc" },
  });
  return rows.filter((row) => !registry || registry.managed(row.connectorId));
}

function sourceState(
  connectionStatus: string,
  supported: boolean,
  enabled: boolean,
  lastError: string | null,
): RadarSourceState {
  if (!supported) return "unsupported";
  if (connectionStatus === "revoked") return "revoked";
  if (connectionStatus === "error" || (enabled && lastError)) return "error";
  return enabled ? "ok" : "paused";
}

export async function radarSourceStatuses(
  db: RadarTx,
  registry: RadarRegistry,
  scope: RadarOwner,
  timeZone: string,
  now: Date,
): Promise<RadarSourceStatus[]> {
  const [connections, sources] = await Promise.all([
    ownerConnections(db, registry, scope),
    db.radarSource.findMany({ where: radarOwner(scope) }),
  ]);
  const byConnection = new Map(sources.map((source) => [source.connectionId, source]));
  const today = localDate(now, timeZone);
  return connections.map((connection) => {
    const source = byConnection.get(connection.id);
    const supported = isRadarSource(connection.provider);
    const enabled = supported && Boolean(source?.enabled);
    const account = connectionAccountLabel(connection.metadata);
    return {
      connectionId: connection.id,
      source: connection.provider.toLowerCase(),
      label: connection.displayName,
      ...(account ? { account } : {}),
      enabled,
      supported,
      state: sourceState(connection.status, supported, enabled, source?.lastError ?? null),
      ...(source?.lastCheckAt ? { lastCheckAt: source.lastCheckAt.toISOString() } : {}),
      ...(enabled && source?.nextCheckAt ? { nextCheckAt: source.nextCheckAt.toISOString() } : {}),
      ...(source?.lastError ? { lastError: source.lastError } : {}),
      seenToday: source && source.seenDate === today ? source.seenCount : 0,
    };
  });
}

/** Switch one account on or off. Turning on needs a connected account Radar can read. */
export async function setRadarSource(
  prisma: PrismaClient,
  registry: RadarRegistry,
  scope: RadarOwner,
  input: unknown,
  now = new Date(),
) {
  const { connectionId, enabled } = RadarSourceInput.parse(input);
  const key = radarOwner(scope);
  await prisma.$transaction(async (tx) => {
    const row = await lockRadarProfile(tx, key);
    const connection = await tx.connection.findFirst({ where: { ...key, id: connectionId } });
    if (!connection || (registry && !registry.managed(connection.connectorId)))
      throw new RadarError("NOT_FOUND", "This account is not connected.");
    if (enabled && !isRadarSource(connection.provider))
      throw new RadarError("BAD_REQUEST", "Radar cannot read this account yet.");
    if (enabled && connection.status !== "connected")
      throw new RadarError("BAD_REQUEST", "Reconnect this account first.");
    const existing = await tx.radarSource.findUnique({ where: { connectionId } });
    if (existing?.enabled === enabled) return;
    // A row is kept when switched off: it records the owner's choice for the first-enable import.
    await tx.radarSource.upsert({
      where: { connectionId },
      create: { connectionId, ...key, enabled, nextCheckAt: enabled ? now : null },
      update: enabled
        ? { enabled, nextCheckAt: now, failures: 0, lastError: null }
        : { enabled, nextCheckAt: null },
    });
    await commitRadarProfile(tx, row, {});
  });
}

/**
 * The first time Radar is turned on with nothing selected yet: watch the accounts chosen
 * for the earlier connected-account research, or every supported connected account when
 * none were chosen.
 */
export async function selectFirstRadarSources(
  tx: RadarTx,
  registry: RadarRegistry,
  scope: RadarOwner,
  researchIds: string[],
  now: Date,
) {
  const key = radarOwner(scope);
  if (await tx.radarSource.count({ where: key })) return;
  const readable = (await ownerConnections(tx, registry, key)).filter(
    (connection) => connection.status === "connected" && isRadarSource(connection.provider),
  );
  const chosen = readable.filter((connection) => researchIds.includes(connection.id));
  const selected = chosen.length ? chosen : readable;
  if (!selected.length) return;
  await tx.radarSource.createMany({
    data: selected.map((connection) => ({
      connectionId: connection.id,
      ...key,
      enabled: true,
      nextCheckAt: now,
    })),
    skipDuplicates: true,
  });
}
