import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import type { RadarSettings } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { connectionAccountLabel } from "../app-connection-tools.js";
import type { RadarCycleDeps } from "./context.js";
import { asRecord, normalizeAddress, SourceReadError, sourceError } from "./observers/envelope.js";
import { radarObserverFor } from "./observers/index.js";
import type { AgendaEvent, ObserverCall } from "./observers/types.js";
import type { RadarOwner } from "./profile.js";
import { radarOwner } from "./profile.js";
import { storeObservation } from "./store.js";

const MAX_BACKOFF_MS = 2 * 3_600_000;
const DEFAULT_LOOKBACK_MS = 24 * 3_600_000;

/** Radar reads through these provider operations and nothing else. */
export const RADAR_READ_TOOLS = new Set([
  "GMAIL_GET_PROFILE",
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GOOGLECALENDAR_EVENTS_LIST",
  "GRANOLA_MCP_LIST_MEETINGS",
  "GRANOLA_MCP_GET_MEETINGS",
  "SLACK_SEARCH_MESSAGES",
  "TODOIST_GET_ALL_TASKS",
  "GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN",
  "GOOGLEDRIVE_LIST_CHANGES",
  "GOOGLEDRIVE_LIST_COMMENTS",
]);

type ConnectionRow = {
  id: string;
  connectorId: string;
  provider: string;
  displayName: string;
  providerRef: string | null;
};

/** A read-only call bound to one account: the provider cannot pick another one. */
export function observerCall(
  managed: ManagedConnectorProvider,
  connection: ConnectionRow,
  context: AdapterContext,
): ObserverCall {
  let sequence = 0;
  const accountContext: AdapterContext = {
    ...context,
    connectedConnections: [
      {
        id: connection.id,
        connectorId: connection.connectorId,
        externalId: connection.provider,
        displayName: connection.displayName,
        ...(connection.providerRef ? { providerRef: connection.providerRef } : {}),
      },
    ],
    connectedProviders: [connection.provider],
  };
  return async (tool, args) => {
    if (!RADAR_READ_TOOLS.has(tool)) throw new SourceReadError("Radar only reads.");
    context.signal.throwIfAborted();
    for await (const event of managed.execute(
      {
        tool,
        args: { ...args, _account: connection.id },
        connectionId: connection.id,
        executionId: `${context.runId ?? "radar"}:${connection.id}:${tool}:${sequence++}`,
      },
      accountContext,
    )) {
      if (event.type === "error") throw sourceError(event.message);
      if (event.type === "result") return event.data;
    }
    throw new SourceReadError("The account could not be read.");
  };
}

/** The owner's own addresses: sign-in email, provider-verified account labels, mailbox profiles. */
export async function ownerAddressesFor(
  prisma: PrismaClient,
  scope: RadarOwner,
): Promise<string[]> {
  const owner = radarOwner(scope);
  const [user, sources, connections] = await Promise.all([
    prisma.user.findUnique({ where: { id: owner.userId }, select: { email: true } }),
    prisma.radarSource.findMany({ where: owner, select: { cursor: true } }),
    prisma.connection.findMany({ where: owner, select: { metadata: true } }),
  ]);
  return [
    ...new Set(
      [
        user?.email,
        ...sources.map((source) => asRecord(source.cursor).ownerAddress),
        ...connections.map((connection) => connectionAccountLabel(connection.metadata)),
      ]
        .map((value) => normalizeAddress(value))
        .filter((address): address is string => Boolean(address)),
    ),
  ];
}

/** The latest agenda each calendar source saw. */
export async function radarAgenda(prisma: PrismaClient, scope: RadarOwner) {
  const sources = await prisma.radarSource.findMany({
    where: { ...radarOwner(scope), enabled: true },
    select: { connectionId: true, cursor: true },
  });
  return sources.flatMap((source) => {
    const agenda = asRecord(source.cursor).agenda;
    return (Array.isArray(agenda) ? (agenda as AgendaEvent[]) : [])
      .filter((event) => event && typeof event.id === "string" && typeof event.start === "string")
      .map((event) => ({
        ...event,
        attendees: Array.isArray(event.attendees) ? event.attendees : [],
        connectionId: source.connectionId,
      }));
  });
}

/**
 * Runs every due observer once from its cursor. A failing source backs off exponentially up
 * to two hours; the others are unaffected.
 */
export async function observeDueSources(
  deps: RadarCycleDeps,
  scope: RadarOwner,
  settings: RadarSettings,
  ownerAddresses: string[],
  context: AdapterContext,
  now: Date,
): Promise<number> {
  const owner = radarOwner(scope);
  const { prisma } = deps;
  const due = await prisma.radarSource.findMany({
    where: { ...owner, enabled: true, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
    include: { connection: true },
  });
  let stored = 0;
  for (const source of due) {
    const { connection } = source;
    const slug = connection.provider.toLowerCase();
    const observer = radarObserverFor(slug);
    const managed = deps.registry?.managed(connection.connectorId);
    if (connection.status !== "connected" || !observer || !managed) {
      await prisma.radarSource.update({
        where: { connectionId: source.connectionId },
        data: { nextCheckAt: new Date(now.getTime() + 3_600_000) },
      });
      continue;
    }
    try {
      const result = await observer.observe({
        call: observerCall(managed, connection, context),
        cursor: asRecord(source.cursor),
        now,
        since: new Date(now.getTime() - (deps.initialLookbackMs ?? DEFAULT_LOOKBACK_MS)),
        timeZone: settings.timeZone,
        ownerAddresses,
      });
      stored += (
        await storeObservation(
          prisma,
          { ...owner, connectionId: source.connectionId, slug },
          result,
          now,
          settings.timeZone,
        )
      ).stored;
      await prisma.radarSource.update({
        where: { connectionId: source.connectionId },
        data: { nextCheckAt: new Date(now.getTime() + observer.cadenceMinutes * 60_000) },
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      const failures = source.failures + 1;
      const wait = Math.min(MAX_BACKOFF_MS, 5 * 60_000 * 2 ** Math.min(failures - 1, 6));
      getLogger().warn("radar source check failed", {
        "connection.id": source.connectionId,
        source: slug,
        failures,
      });
      await prisma.radarSource.update({
        where: { connectionId: source.connectionId },
        data: {
          failures,
          lastError:
            error instanceof SourceReadError ? error.message : "The account could not be read.",
          lastCheckAt: now,
          nextCheckAt: new Date(now.getTime() + wait),
        },
      });
    }
  }
  return stored;
}
