import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveCodexBinary } from "./codex-binary.js";

it("finds a CLI moved by a desktop update and reports a missing engine clearly", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-test-"));
  try {
    const old = join(root, "codex"),
      moved = join(root, "codex-cli", "bin", "codex");
    await expect(resolveCodexBinary(old, [])).rejects.toThrow("Agent engine is unavailable");
    await mkdir(join(root, "codex-cli", "bin"), { recursive: true });
    await writeFile(moved, "fixture");
    await chmod(moved, 0o700);
    expect(await resolveCodexBinary(old, [])).toBe(moved);
    await writeFile(old, "fixture");
    await chmod(old, 0o700);
    expect(await resolveCodexBinary(old, [])).toBe(old);
    expect(await resolveCodexBinary(undefined, [])).toBe("codex");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("falls back to another known install when the configured path is gone", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-test-"));
  try {
    const configured = join(root, "OldApp.app", "Contents", "Resources", "codex");
    const installed = join(root, "bin", "codex");
    const notExecutable = join(root, "plain", "codex");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "plain"), { recursive: true });
    await writeFile(installed, "fixture");
    await chmod(installed, 0o700);
    await writeFile(notExecutable, "fixture");
    await chmod(notExecutable, 0o600);
    expect(await resolveCodexBinary(configured, [notExecutable, installed])).toBe(installed);
    // Unconfigured servers under launchd have no user PATH; known installs still resolve.
    expect(await resolveCodexBinary(undefined, [installed])).toBe(installed);
    expect(await resolveCodexBinary("codex-custom", [installed])).toBe("codex-custom");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
