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
    await expect(resolveCodexBinary(old)).rejects.toThrow("Agent engine is unavailable");
    await mkdir(join(root, "codex-cli", "bin"), { recursive: true });
    await writeFile(moved, "fixture");
    await chmod(moved, 0o700);
    expect(await resolveCodexBinary(old)).toBe(moved);
    await writeFile(old, "fixture");
    await chmod(old, 0o700);
    expect(await resolveCodexBinary(old)).toBe(old);
    expect(await resolveCodexBinary()).toBe("codex");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
