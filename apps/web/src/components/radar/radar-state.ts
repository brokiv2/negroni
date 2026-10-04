import type {
  RadarFeedbackKind,
  RadarLevel,
  RadarSettingsPatch,
  RadarStatus,
  RadarUpdate,
} from "@rakazo/contracts";
import { useEffect, useSyncExternalStore } from "react";
import { localTimezone } from "../../lib/local-timezone";
import { rpc } from "../../lib/rpc";
import { sharedInflight } from "../../lib/shared-inflight";

/**
 * One Radar status for the whole app, so chat cards, For you and the Radar panel agree on
 * the time zone, sources and rules without each asking the server.
 */
let current: RadarStatus | null = null;
let loadedAt = 0;
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<RadarStatus>>();

export function publishRadarStatus(status: RadarStatus) {
  current = status;
  loadedAt = Date.now();
  for (const listener of listeners) listener();
}

/** Reuses a status younger than `maxAgeMs`; pass 0 to read it again. */
export function loadRadarStatus(maxAgeMs = 30_000): Promise<RadarStatus> {
  if (current && Date.now() - loadedAt < maxAgeMs) return Promise.resolve(current);
  return sharedInflight(inflight, "status", async () => {
    const status = await rpc.radar.status({});
    publishRadarStatus(status);
    return status;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRadarStatus(): RadarStatus | null {
  const status = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(() => {
    void loadRadarStatus().catch(() => undefined);
  }, []);
  return status;
}

/** Test-only: forget the shared status. */
export function resetRadarStatusForTests() {
  current = null;
  loadedAt = 0;
  inflight.clear();
}

/**
 * Turning Radar on. A Radar that never chose a time zone takes this device's, so quiet
 * hours, briefs and "this evening" follow the owner's clock.
 */
export function enableRadarPatch(
  status: RadarStatus | null,
  level?: RadarLevel,
): RadarSettingsPatch {
  return {
    enabled: true,
    ...(level ? { level } : {}),
    ...(status?.settings.timeZone === "UTC" ? { timeZone: localTimezone() } : {}),
  };
}

/** Feedback that teaches the filter also changes the rules the panel lists. */
export async function sendRadarFeedback(
  id: string,
  kind: RadarFeedbackKind,
  until?: string,
): Promise<RadarUpdate> {
  const update = await rpc.radar.feedback(until ? { id, kind, until } : { id, kind });
  if (kind === "mute_sender" || kind === "always_sender" || kind === "important") {
    void loadRadarStatus(0).catch(() => undefined);
  }
  return update;
}

/** Hands an update to the personal conversation, where the assistant does the work. */
export function sendToPersonalChat(input: {
  botId: string;
  updateId: string;
  text: string;
  clientNonce: string;
}) {
  return rpc.threads.send({
    botId: input.botId,
    threadKind: "personal",
    text: input.text,
    radarUpdateId: input.updateId,
    clientNonce: input.clientNonce,
  });
}
