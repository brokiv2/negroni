import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let dataDir: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe("catalog overrides", () => {
  it("makes a Z.AI flash model resolvable from runtime data", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "rakazo-model-overrides-"));
    await writeFile(
      path.join(dataDir, "model-overrides.json"),
      JSON.stringify({
        zai: [
          {
            id: "glm-5.3-flash",
            basedOn: "glm-5.3",
            input: ["text", "image"],
          },
        ],
      }),
    );
    vi.stubEnv("DATA_DIR", dataDir);
    vi.resetModules();

    const { composedCatalog } = await import("./catalog-overrides.js");
    expect(composedCatalog().getModel("zai", "glm-5.3-flash")).toMatchObject({
      id: "glm-5.3-flash",
      input: ["text", "image"],
    });
  });
});
