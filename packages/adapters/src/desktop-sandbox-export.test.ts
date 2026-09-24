import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const transientRead = vi.hoisted(() => ({
  remaining: 0,
  fileName: "",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (target: Parameters<typeof actual.readFile>[0], ...args: never[]) => {
      if (transientRead.remaining > 0 && String(target).endsWith(transientRead.fileName)) {
        transientRead.remaining -= 1;
        const error = Object.assign(new Error("Unknown system error -11, read"), {
          code: "Unknown system error -11",
          errno: -11,
        });
        throw error;
      }
      return actual.readFile(target, ...args);
    },
  };
});

const { DesktopSandboxProvider } = await import("./desktop-sandbox.js");

const ctx = {
  operationId: "operation",
  traceId: "trace",
  spaceId: "workspace",
  userId: "user",
  signal: new AbortController().signal,
};
const roots: string[] = [];

afterEach(async () => {
  transientRead.remaining = 0;
  transientRead.fileName = "";
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-desktop-export-"));
  roots.push(root);
  const desktop = new DesktopSandboxProvider({ root });
  const computer = await desktop.provision({ botId: "export", homePath: "/unused" }, ctx);
  return { desktop, computer };
}

async function exportedPaths(desktop: DesktopSandboxProvider, computer: Awaited<ReturnType<DesktopSandboxProvider["provision"]>>) {
  const files = [];
  for await (const file of desktop.exportWorkspace(computer)) files.push(file.path);
  return files;
}

describe("desktop workspace export", () => {
  it("retries a transient iCloud-style read error", async () => {
    const { desktop, computer } = await fixture();
    await writeFile(path.join(computer.providerRef, "retry.txt"), "available");
    transientRead.fileName = "retry.txt";
    transientRead.remaining = 2;

    await expect(exportedPaths(desktop, computer)).resolves.toContain("retry.txt");
  });

  it("skips a persistently unreadable transient entry without failing the snapshot", async () => {
    const { desktop, computer } = await fixture();
    await writeFile(path.join(computer.providerRef, "unreadable.txt"), "stuck");
    await writeFile(path.join(computer.providerRef, "available.txt"), "available");
    transientRead.fileName = "unreadable.txt";
    transientRead.remaining = 3;

    await expect(exportedPaths(desktop, computer)).resolves.toEqual(["available.txt"]);
  });
});
