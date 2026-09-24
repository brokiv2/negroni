import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createProvider,
  type Api,
  type Model,
  type Models,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { LOCAL_PROVIDER_ID, registerLocalProvider } from "./pi-local-provider.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  registerOpenAiCompatibleCatalog,
} from "./pi-openai-compatible-provider.js";

/**
 * Operator-extensible model catalog.
 *
 * pi-ai ships a static catalog; self-hosted deployments may have models it
 * does not know (e.g. a provider's new flash tier). Overrides live in a JSON
 * file inside DATA_DIR and merge into the composed catalog whenever the file
 * changes, so a new entry becomes selectable and runnable without a restart.
 */

export interface ModelOverride {
  id: string;
  name?: string;
  /** Clone metadata (context window, compat flags, cost) from this catalog model. */
  basedOn?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
}

export type CatalogOverrides = Record<string, ModelOverride[]>;

function overridesFilePath(): string {
  const dataDir = process.env.DATA_DIR?.trim() || "./data";
  return path.resolve(dataDir, "model-overrides.json");
}

export function readOverrides(): CatalogOverrides {
  const file = overridesFilePath();
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CatalogOverrides;
  } catch {
    return {};
  }
}

export async function appendOverride(providerId: string, entry: ModelOverride): Promise<void> {
  const overrides = readOverrides();
  const list = overrides[providerId] ?? [];
  const next = list.filter((item) => item.id !== entry.id);
  next.push(entry);
  overrides[providerId] = next;
  const file = overridesFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
}

function overridesStatSignature(): string {
  try {
    const stats = statSync(overridesFilePath());
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}

/** Changes whenever the overrides file changes; callers use it to drop caches. */
export function overridesSignature(): string {
  return overridesStatSignature();
}

function cloneWithOverride(base: Model<Api>, entry: ModelOverride): Model<Api> {
  const clone = { ...base } as Model<Api>;
  clone.id = entry.id;
  clone.name = entry.name ?? entry.id;
  if (entry.contextWindow && Number.isFinite(entry.contextWindow)) {
    clone.contextWindow = entry.contextWindow;
  }
  if (entry.maxTokens && Number.isFinite(entry.maxTokens)) {
    clone.maxTokens = entry.maxTokens;
  }
  if (typeof entry.reasoning === "boolean") clone.reasoning = entry.reasoning;
  if (entry.input?.length) clone.input = [...entry.input];
  return clone;
}

function applyOverrides(models: MutableModels): MutableModels {
  const overrides = readOverrides();
  for (const [providerId, entries] of Object.entries(overrides)) {
    if (providerId === LOCAL_PROVIDER_ID || providerId === OPENAI_COMPATIBLE_PROVIDER_ID) continue;
    const provider = models.getProvider(providerId);
    const catalog = provider?.getModels() ?? [];
    if (!provider || catalog.length === 0) continue;
    const api = catalog[0]?.api;
    if (api !== "openai-completions") continue;
    const extras: Model<"openai-completions">[] = [];
    for (const entry of entries) {
      if (!entry.id || catalog.some((model) => model.id === entry.id)) continue;
      const basedOn =
        catalog.find((model) => model.id === entry.basedOn) ??
        catalog.find((model) => model.id === entry.id.split(/[-.]/)[0]) ??
        catalog[catalog.length - 1];
      if (!basedOn) continue;
      extras.push(cloneWithOverride(basedOn, entry) as Model<"openai-completions">);
    }
    if (extras.length === 0) continue;
    const extended = createProvider({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      headers: provider.headers,
      auth: provider.auth,
      models: [...catalog, ...extras],
      api: openAICompletionsApi(),
    });
    models.setProvider(extended);
    console.log(
      `[catalog-overrides] extended ${providerId} with: ${extras.map((model) => model.id).join(", ")}`,
    );
  }
  return models;
}

let composedCache: Models | undefined;
let composedSignature = "";

/** The full catalog (pi-ai built-ins + local + overrides), rebuilt when the overrides file changes. */
export function composedCatalog(): Models {
  const signature = overridesStatSignature();
  if (!composedCache || composedSignature !== signature) {
    composedCache = registerOpenAiCompatibleCatalog(
      registerCatalogOverrides(registerLocalProvider(builtinModels())),
    );
    composedSignature = signature;
  }
  return composedCache;
}

export function registerCatalogOverrides(models: MutableModels): MutableModels {
  return applyOverrides(models);
}

/** Base URL of a catalog provider, for live /models probes. */
export function providerBaseUrl(providerId: string): string | undefined {
  const model = composedCatalog().getModels(providerId).find((entry) => Boolean(entry.baseUrl));
  return model?.baseUrl;
}

/** Catalog model ids already present for a provider. */
export function providerCatalogModelIds(providerId: string): string[] {
  return composedCatalog()
    .getModels(providerId)
    .map((model) => model.id);
}
