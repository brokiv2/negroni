import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

/** Desktop app updates can move the bundled CLI without changing the app bundle. */
export async function resolveCodexBinary(configured?: string): Promise<string> {
  if (!configured || !isAbsolute(configured)) return configured || "codex";
  const candidates = [configured];
  if (basename(configured) === "codex") {
    candidates.push(join(dirname(configured), "codex-cli", "bin", "codex"));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try packaged location */
    }
  }
  throw new Error(
    "Agent engine is unavailable. Its installed executable moved or was removed. Update the server engine path and retry.",
  );
}
