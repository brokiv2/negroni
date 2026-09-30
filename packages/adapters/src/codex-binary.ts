import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

/** Places desktop installs keep the CLI. The ChatGPT app moved it once already (codex → codex-cli/bin/codex). */
export function defaultCodexLocations(home = homedir()): string[] {
  return [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
}

/**
 * Desktop app updates can move the bundled CLI without changing the app bundle, and a
 * launchd PATH does not include user installs. Resolve on every run: the configured path,
 * its packaged sibling, then known install locations.
 */
export async function resolveCodexBinary(
  configured?: string,
  fallbacks: readonly string[] = defaultCodexLocations(),
): Promise<string> {
  if (configured && !isAbsolute(configured)) return configured;
  const candidates: string[] = [];
  if (configured) {
    candidates.push(configured);
    if (basename(configured) === "codex") {
      candidates.push(join(dirname(configured), "codex-cli", "bin", "codex"));
    }
  }
  candidates.push(...fallbacks);
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try the next known location */
    }
  }
  if (!configured) return "codex";
  throw new Error(
    "Agent engine is unavailable. Its installed executable moved or was removed. Update the server engine path and retry.",
  );
}
