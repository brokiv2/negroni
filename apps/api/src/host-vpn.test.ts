import { describe, expect, it, vi } from "vitest";
import type { ExecFileLike } from "./host-vpn.js";
import {
  createHostVpn,
  DEFAULT_WARP_CLI_PATH,
  HostVpnUnavailableError,
  parseWarpStatus,
  VPN_SWITCH_DELAY_MS,
  WARP_COMMANDS,
} from "./host-vpn.js";

function fakeExec(stdout = "Status update: Connected\nNetwork: healthy\n") {
  return vi.fn<ExecFileLike>().mockResolvedValue({ stdout, stderr: "" });
}

/** Captures scheduled switches so tests run them on demand instead of waiting. */
function manualSchedule() {
  const queued: Array<{ run: () => void; ms: number }> = [];
  return {
    queued,
    schedule: (run: () => void, ms: number) => {
      queued.push({ run, ms });
    },
  };
}

describe("parseWarpStatus", () => {
  it.each([
    ["Status update: Connected\nNetwork: healthy", "connected"],
    ["Status update: Disconnected. Reason: Manual Disconnection", "disconnected"],
    ["Status update: Disconnected", "disconnected"],
    ["Status update: Connecting\nReason: Establishing connection", "connecting"],
    ["Status update: Disconnecting", "connecting"],
    ["status update: connected", "connected"],
    ["Error communicating with daemon", "unavailable"],
    ["Status update: Unable", "unavailable"],
    ["", "unavailable"],
  ])("reads %j as %s", (output, state) => {
    expect(parseWarpStatus(output)).toBe(state);
  });
});

describe("createHostVpn", () => {
  it("reads status with the fixed path, fixed argv, no shell and a timeout", async () => {
    const execFile = fakeExec();
    const vpn = createHostVpn({ execFile, isExecutable: async () => true });

    await expect(vpn.status()).resolves.toEqual({ state: "connected", switching: false });
    expect(execFile).toHaveBeenCalledWith(
      DEFAULT_WARP_CLI_PATH,
      ["status"],
      expect.objectContaining({ shell: false, timeout: expect.any(Number) }),
    );
  });

  it("honours a configured absolute CLI path", async () => {
    const execFile = fakeExec();
    const isExecutable = vi.fn(async () => true);
    const vpn = createHostVpn({ cliPath: "/opt/warp/bin/warp-cli", execFile, isExecutable });

    await vpn.status();
    expect(isExecutable).toHaveBeenCalledWith("/opt/warp/bin/warp-cli");
    expect(execFile.mock.calls[0]?.[0]).toBe("/opt/warp/bin/warp-cli");
  });

  it("reports unavailable for a missing binary or a relative path without running anything", async () => {
    const execFile = fakeExec();
    const missing = createHostVpn({ execFile, isExecutable: async () => false });
    const relative = createHostVpn({
      cliPath: "warp-cli",
      execFile,
      isExecutable: async () => true,
    });

    await expect(missing.status()).resolves.toEqual({ state: "unavailable", switching: false });
    await expect(relative.status()).resolves.toEqual({ state: "unavailable", switching: false });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("reports unavailable when the CLI fails or times out", async () => {
    const execFile = vi.fn<ExecFileLike>().mockRejectedValue(new Error("timed out"));
    const vpn = createHostVpn({ execFile, isExecutable: async () => true });

    await expect(vpn.status()).resolves.toEqual({ state: "unavailable", switching: false });
  });

  it("answers before switching, then runs the command after the delay", async () => {
    const execFile = fakeExec("Success");
    const { queued, schedule } = manualSchedule();
    const vpn = createHostVpn({ execFile, isExecutable: async () => true, schedule });

    await expect(vpn.set(false)).resolves.toEqual({ accepted: true });
    expect(execFile).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.ms).toBe(VPN_SWITCH_DELAY_MS);

    queued[0]?.run();
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(1));
    expect(execFile.mock.calls[0]?.[1]).toEqual(["disconnect"]);
  });

  it("uses a real timer delay by default", async () => {
    vi.useFakeTimers();
    try {
      const execFile = fakeExec("Success");
      const vpn = createHostVpn({ execFile, isExecutable: async () => true });

      await vpn.set(true);
      await vi.advanceTimersByTimeAsync(VPN_SWITCH_DELAY_MS - 1);
      expect(execFile).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(execFile.mock.calls[0]?.[1]).toEqual(["connect"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only ever passes allowlisted argument lists", async () => {
    const execFile = fakeExec("Success");
    const { queued, schedule } = manualSchedule();
    const vpn = createHostVpn({ execFile, isExecutable: async () => true, schedule });

    await vpn.status();
    await vpn.set(true);
    queued.shift()?.run();
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2));
    await vpn.set(false);
    queued.shift()?.run();
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(3));

    const allowed = Object.values(WARP_COMMANDS).map((args) => [...args]);
    for (const call of execFile.mock.calls) {
      expect(allowed).toContainEqual([...call[1]]);
    }
  });

  it("ignores overlapping switches until the running one finishes", async () => {
    let finish: (value: { stdout: string; stderr: string }) => void = () => undefined;
    const execFile = vi.fn<ExecFileLike>((_file, args) =>
      args[0] === "status"
        ? Promise.resolve({ stdout: "Status update: Connecting", stderr: "" })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const { queued, schedule } = manualSchedule();
    const vpn = createHostVpn({ execFile, isExecutable: async () => true, schedule });

    const [first, second] = await Promise.all([vpn.set(true), vpn.set(false)]);
    expect(first).toEqual({ accepted: true });
    expect(second).toEqual({ accepted: false });
    await expect(vpn.status()).resolves.toEqual({ state: "connecting", switching: true });

    queued[0]?.run();
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2));
    await expect(vpn.set(false)).resolves.toEqual({ accepted: false });

    finish({ stdout: "Success", stderr: "" });
    await vi.waitFor(async () => expect((await vpn.status()).switching).toBe(false));
    await expect(vpn.set(false)).resolves.toEqual({ accepted: true });
    expect(queued).toHaveLength(2);
  });

  it("frees the slot when the switch command fails", async () => {
    const execFile = vi.fn<ExecFileLike>().mockRejectedValue(new Error("daemon down"));
    const { queued, schedule } = manualSchedule();
    const vpn = createHostVpn({ execFile, isExecutable: async () => true, schedule });

    await vpn.set(true);
    queued[0]?.run();
    await vi.waitFor(async () => expect((await vpn.status()).switching).toBe(false));
    await expect(vpn.set(true)).resolves.toEqual({ accepted: true });
  });

  it("refuses to switch when the CLI is missing and stays free", async () => {
    const execFile = fakeExec();
    const { queued, schedule } = manualSchedule();
    let present = false;
    const vpn = createHostVpn({ execFile, isExecutable: async () => present, schedule });

    await expect(vpn.set(true)).rejects.toBeInstanceOf(HostVpnUnavailableError);
    expect(queued).toHaveLength(0);
    present = true;
    await expect(vpn.set(true)).resolves.toEqual({ accepted: true });
  });
});
