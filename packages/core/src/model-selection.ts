import type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";

export interface ConnectedModelOption {
  key: string;
  provider: string;
  modelId: string;
  label: string;
}

export function modelOptionKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

export function parseModelOptionKey(key: string) {
  const separator = key.indexOf("::");
  if (separator <= 0 || separator + 2 >= key.length) return null;
  return { provider: key.slice(0, separator), modelId: key.slice(separator + 2) };
}

/** Models available through existing connections, including custom model IDs. */
export function connectedModelOptions(
  credentials: readonly Pick<ModelCredential, "provider" | "modelId" | "label">[],
  catalog: readonly ModelCatalogEntry[],
): ConnectedModelOption[] {
  const optionsForConnections: ConnectedModelOption[] = [];
  const seenOptions = new Set<string>();
  for (const credential of credentials) {
    const providerModels = catalog.filter(
      (entry) => entry.provider === credential.provider && !entry.placeholder,
    );
    const credentialInCatalog = Boolean(
      credential.modelId && providerModels.some((entry) => entry.id === credential.modelId),
    );
    // Catalog providers expand to every model for that connection. Free-form
    // credentials (model id not in the catalog) stay a single connected pair.
    const options =
      credential.modelId && !credentialInCatalog
        ? [
            {
              key: modelOptionKey(credential.provider, credential.modelId),
              provider: credential.provider,
              modelId: credential.modelId,
              label: `${credential.label} · ${credential.modelId}`,
            },
          ]
        : providerModels.map((entry) => ({
            key: modelOptionKey(entry.provider, entry.id),
            provider: entry.provider,
            modelId: entry.id,
            label: `${entry.providerName ?? entry.provider} · ${entry.label}`,
          }));
    for (const option of options) {
      if (seenOptions.has(option.key)) continue;
      seenOptions.add(option.key);
      optionsForConnections.push(option);
    }
  }

  return optionsForConnections;
}
