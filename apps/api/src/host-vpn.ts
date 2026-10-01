import { execFile as nodeExecFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import type { HostVpnState, HostVpnStatus } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";

export const DEFAULT_WARP_CLI_PATH = "/usr/local/bin/warp-cli";

/** The only argument lists ever handed to warp-cli. Callers pick a key, never an argv. */
export const WARP_COMMANDS = {
  status: ["status"],
  connect: ["connect"],
  disconnect: ["disconnect"],
} as const satisfies Record<string, readonly string[]>;
export type WarpCommand = keyof typeof WARP_COMMANDS;

/** Long enough for the RPC answer to leave through the tunnel the switch is about to drop. */
export const VPN_SWITCH_DELAY_MS = 1_000;
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export type ExecFileOptions = {
  timeout: number;
  maxBuffer: number;
  shell: false;
  windowsHide: true;
};
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export class HostVpnUnavailableError extends Error {
  constructor() {
    super("WARP is not available on this computer.");
    this.name = "HostVpnUnavailableError";
  }
}

export interface HostVpn {
  status(): Promise<HostVpnStatus>;
  /** Validates, schedules the switch after a short delay and answers at once. */
  set(enabled: boolean): Promise<{ accepted: boolean }>;
}

/** `warp-cli status` prints e.g. `Status update: Connected` / `Disconnected. Reason: …`. */
export function parseWarpStatus(output: string): HostVpnState {
  const word = /Status update:\s*([A-Za-z]+)/i.exec(output)?.[1]?.toLowerCase();
  if (word === "connected") return "connected";
  if (word === "disconnected") return "disconnected";
  if (word === "connecting" || word === "disconnecting") return "connecting";
  return "unavailable";
}

const defaultExecFile: ExecFileLike = (file, args, options) =>
  new Promise((resolve, reject) => {
    nodeExecFile(file, [...args], { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });

async function defaultIsExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function createHostVpn(
  options: {
    cliPath?: string;
    execFile?: ExecFileLike;
    isExecutable?: (file: string) => Promise<boolean>;
    delayMs?: number;
    timeoutMs?: number;
    schedule?: (run: () => void, ms: number) => void;
  } = {},
): HostVpn {
  const cliPath = options.cliPath?.trim() || DEFAULT_WARP_CLI_PATH;
  const execFile = options.execFile ?? defaultExecFile;
  const isExecutable = options.isExecutable ?? defaultIsExecutable;
  const delayMs = options.delayMs ?? VPN_SWITCH_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const schedule =
    options.schedule ??
    ((run: () => void, ms: number) => {
      setTimeout(run, ms).unref();
    });
  let switching = false;

  const available = async () => path.isAbsolute(cliPath) && (await isExecutable(cliPath));

  const run = (command: WarpCommand) =>
    execFile(cliPath, WARP_COMMANDS[command], {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    });

  return {
    async status() {
      if (!(await available())) return { state: "unavailable", switching };
      try {
        const { stdout } = await run("status");
        return { state: parseWarpStatus(stdout), switching };
      } catch {
        return { state: "unavailable", switching };
      }
    },
    async set(enabled) {
      if (switching) return { accepted: false };
      // Claim before awaiting so two overlapping requests cannot both pass the check.
      switching = true;
      let ok = false;
      try {
        ok = await available();
      } finally {
        if (!ok) switching = false;
      }
      if (!ok) throw new HostVpnUnavailableError();
      schedule(() => {
        Promise.resolve()
          .then(() => run(enabled ? "connect" : "disconnect"))
          .catch((error: unknown) => getLogger().error("warp-cli switch failed", error))
          .finally(() => {
            switching = false;
          });
      }, delayMs);
      return { accepted: true };
    },
  };
}
