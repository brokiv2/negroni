import type { HostVpnStatus } from "@rakazo/contracts";
import { abortableDelay } from "./async.js";

/** How long a client keeps reading status after a switch while the tunnel reconnects. */
export const VPN_SETTLE_TIMEOUT_MS = 20_000;
/** Waits between status reads; the last value repeats until the deadline. */
export const VPN_SETTLE_BACKOFF_MS = [800, 1_200, 1_800, 2_500, 3_000] as const;

/** True once the host finished switching and reports the wanted state (`null`: any stable state). */
export function vpnSettled(status: HostVpnStatus, enabled: boolean | null): boolean {
  if (status.switching) return false;
  if (enabled === null) return status.state === "connected" || status.state === "disconnected";
  return status.state === (enabled ? "connected" : "disconnected");
}

/**
 * Asks the host to switch the VPN, then reads status with backoff until it settles. The switch
 * drops the phone-to-Mac tunnel for a few seconds, so failed reads in between are expected and
 * skipped. Resolves with the last status read, or `null` when none came back before the deadline.
 * A failed `setVpn` rejects; nothing was scheduled then.
 */
export async function switchHostVpn(input: {
  enabled: boolean;
  setVpn: (enabled: boolean) => Promise<{ accepted: boolean }>;
  readStatus: () => Promise<HostVpnStatus>;
  onStatus?: (status: HostVpnStatus) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}): Promise<HostVpnStatus | null> {
  const delay = input.delay ?? abortableDelay;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? VPN_SETTLE_TIMEOUT_MS;
  const { accepted } = await input.setVpn(input.enabled);
  // Ignored as overlapping: another switch is running, so wait for whatever it settles on.
  const target = accepted ? input.enabled : null;
  const deadline = now() + timeoutMs;
  let last: HostVpnStatus | null = null;
  for (let attempt = 0; !input.signal?.aborted; attempt += 1) {
    const wait = VPN_SETTLE_BACKOFF_MS[Math.min(attempt, VPN_SETTLE_BACKOFF_MS.length - 1)] ?? 0;
    if (now() + wait > deadline) break;
    await delay(wait, input.signal);
    if (input.signal?.aborted) break;
    try {
      last = await input.readStatus();
    } catch {
      continue;
    }
    if (input.signal?.aborted) break;
    input.onStatus?.(last);
    if (vpnSettled(last, target)) break;
  }
  return last;
}
