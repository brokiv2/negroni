import type { HostVpnStatus } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { switchHostVpn, VPN_SETTLE_TIMEOUT_MS, vpnSettled } from "./host-vpn.js";

const status = (state: HostVpnStatus["state"], switching = false): HostVpnStatus => ({
  state,
  switching,
});

/** A clock that only moves when the poller waits. */
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    delay: vi.fn(async (ms: number) => {
      time += ms;
    }),
  };
}

describe("vpnSettled", () => {
  it("waits for the host to finish and reach the wanted state", () => {
    expect(vpnSettled(status("connected", true), true)).toBe(false);
    expect(vpnSettled(status("connecting"), true)).toBe(false);
    expect(vpnSettled(status("disconnected"), true)).toBe(false);
    expect(vpnSettled(status("connected"), true)).toBe(true);
    expect(vpnSettled(status("disconnected"), false)).toBe(true);
    expect(vpnSettled(status("disconnected"), null)).toBe(true);
    expect(vpnSettled(status("unavailable"), null)).toBe(false);
  });
});

describe("switchHostVpn", () => {
  it("polls through tunnel errors until the wanted state settles", async () => {
    const clock = fakeClock();
    const reads = [
      () => Promise.reject(new TypeError("Network request failed")),
      () => Promise.resolve(status("disconnected", true)),
      () => Promise.reject(new TypeError("Network request failed")),
      () => Promise.resolve(status("connecting")),
      () => Promise.resolve(status("connected")),
    ];
    const readStatus = vi.fn(() =>
      (reads.shift() ?? (() => Promise.resolve(status("connected"))))(),
    );
    const onStatus = vi.fn();
    const setVpn = vi.fn(async () => ({ accepted: true }));

    const result = await switchHostVpn({
      enabled: true,
      setVpn,
      readStatus,
      onStatus,
      ...clock,
    });

    expect(setVpn).toHaveBeenCalledWith(true);
    expect(result).toEqual(status("connected"));
    expect(readStatus).toHaveBeenCalledTimes(5);
    expect(onStatus.mock.calls.map(([value]) => value)).toEqual([
      status("disconnected", true),
      status("connecting"),
      status("connected"),
    ]);
    const waits = clock.delay.mock.calls.map(([ms]) => ms);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
  });

  it("gives up at the deadline with the last status it read", async () => {
    const clock = fakeClock();
    let reads = 0;
    const readStatus = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return status("connecting");
      throw new TypeError("Network request failed");
    });

    const result = await switchHostVpn({
      enabled: false,
      setVpn: async () => ({ accepted: true }),
      readStatus,
      ...clock,
    });

    expect(result).toEqual(status("connecting"));
    expect(clock.now()).toBeLessThanOrEqual(VPN_SETTLE_TIMEOUT_MS);
    expect(clock.now()).toBeGreaterThan(VPN_SETTLE_TIMEOUT_MS - 3_000);
  });

  it("returns null when no read gets through", async () => {
    const result = await switchHostVpn({
      enabled: true,
      setVpn: async () => ({ accepted: true }),
      readStatus: () => Promise.reject(new Error("offline")),
      ...fakeClock(),
    });
    expect(result).toBeNull();
  });

  it("settles on any stable state when the host ignored an overlapping switch", async () => {
    const result = await switchHostVpn({
      enabled: true,
      setVpn: async () => ({ accepted: false }),
      readStatus: async () => status("disconnected"),
      ...fakeClock(),
    });
    expect(result).toEqual(status("disconnected"));
  });

  it("does not poll when the switch request fails", async () => {
    const readStatus = vi.fn(async () => status("connected"));
    await expect(
      switchHostVpn({
        enabled: true,
        setVpn: () => Promise.reject(new Error("WARP is not available on this computer.")),
        readStatus,
        ...fakeClock(),
      }),
    ).rejects.toThrow("WARP is not available");
    expect(readStatus).not.toHaveBeenCalled();
  });

  it("stops reading and reporting once aborted", async () => {
    const controller = new AbortController();
    const onStatus = vi.fn();
    const readStatus = vi.fn(async () => {
      controller.abort();
      return status("connecting");
    });

    await switchHostVpn({
      enabled: true,
      setVpn: async () => ({ accepted: true }),
      readStatus,
      onStatus,
      signal: controller.signal,
      ...fakeClock(),
    });

    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalled();
  });
});
