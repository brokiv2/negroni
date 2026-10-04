import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";

export type AppCatalogRegistry = {
  managed(id: string): ManagedConnectorProvider | undefined;
  managedProviders?(): ManagedConnectorProvider[];
};

export async function searchConnectableApps(
  registry: AppCatalogRegistry | undefined,
  context: AdapterContext,
  query: string,
) {
  if (!query.trim())
    return {
      apps: [],
      error: "Provide the app name, not private account data.",
    };
  const results = await Promise.allSettled(
    (registry?.managedProviders?.() ?? []).map(async (provider) => {
      const items = await provider.catalog(context, query.trim().slice(0, 100));
      return items.map((item) => ({
        ...item,
        connectorId: provider.describe().id,
      }));
    }),
  );
  return {
    apps: results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .slice(0, 20),
    unavailable: results.some((result) => result.status === "rejected"),
  };
}

/** Never trust model-supplied logos, authorization URLs or names. */
export async function appConnectionCard(
  registry: AppCatalogRegistry | undefined,
  context: AdapterContext,
  connectorId: string,
  provider: string,
  sourceMessageId?: string,
): Promise<{
  block?: Extract<MessageBlock, { kind: "app_connect" }>;
  connected?: boolean;
  error?: string;
}> {
  const connector = registry?.managed(connectorId);
  if (!connector || !provider.trim())
    return { error: "App connector is unavailable. Search apps first." };
  const app = (await connector.catalog(context, provider)).find((item) => item.slug === provider);
  if (!app)
    return {
      error: "App is not in the available catalog. Do not invent a connection link.",
    };
  if (
    app.connected ||
    context.connectedConnections?.some(
      (item) => item.connectorId === connectorId && item.externalId === provider,
    )
  )
    return { connected: true };
  return {
    block: {
      kind: "app_connect",
      connectorId,
      provider: app.slug,
      name: app.name,
      description: app.description ?? "",
      logo: app.logo,
      status: "pending",
      requestId: context.runId,
      ...(sourceMessageId ? { sourceMessageId } : {}),
    },
  };
}

/** Provider-verified account name stored on a connection, independent of its nickname. */
export function connectionAccountLabel(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const label = (metadata as { accountLabel?: unknown }).accountLabel;
  return typeof label === "string" ? label : undefined;
}
