import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RESPONSE_UI_FIXTURE,
  RESPONSE_UI_LAYOUT_FIXTURE,
} from "../../../packages/contracts/src/response-ui.fixture.js";
import { responseUiComponentSchemas } from "../../../packages/contracts/src/response-ui.js";

const catalog = responseUiComponentSchemas();
for (const [path, value] of [
  ["../Core/Sources/NegroniCore/Resources/ResponseUiCatalog.json", catalog],
  ["../Core/Tests/NegroniCoreTests/Resources/ResponseUiFixture.json", RESPONSE_UI_FIXTURE],
  ["../Resources/ResponseUiFixture.json", RESPONSE_UI_FIXTURE],
  ["../Resources/ResponseUiLayoutFixture.json", RESPONSE_UI_LAYOUT_FIXTURE],
] as const) {
  const target = new URL(path, import.meta.url);
  const output = execFileSync(
    fileURLToPath(new URL("../../../node_modules/.bin/biome", import.meta.url)),
    ["format", "--stdin-file-path", fileURLToPath(target)],
    { input: JSON.stringify(value), encoding: "utf8" },
  );
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== output)
      throw new Error("Regenerate native response UI resources");
  } else {
    mkdirSync(new URL(".", target), { recursive: true });
    writeFileSync(target, output);
  }
}
