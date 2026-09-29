import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const NEGRONI_LOCAL_URL = "http://127.0.0.1:5173";
export function isNegroniLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "5173"
    );
  } catch {
    return false;
  }
}

/** Reuse the installed user service. Never replace a saved remote server or launch a second stack. */
export async function startInstalledBackend(url: string): Promise<boolean> {
  if (process.platform !== "darwin" || !isNegroniLocalUrl(url)) return false;
  if (!existsSync(join(homedir(), "Library/LaunchAgents/dev.negroni.backend.plist"))) return false;
  try {
    await promisify(execFile)("/bin/launchctl", ["start", "dev.negroni.backend"], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
