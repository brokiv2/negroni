import type { AdapterContext, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { appConnectionCard, searchConnectableApps } from "./app-connection-tools.js";
import { filterBuiltinToolsForRun } from "./schedule-tools.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "owner",
  runId: "run",
  signal: new AbortController().signal,
};
const app = {
  connectorId: "catalog",
  slug: "granola",
  name: "Granola",
  description: "Meeting notes",
  logo: "https://example.test/icon.png",
  connected: false,
  noAuth: false,
};
function fixture(items = [app]) {
  const catalog = vi.fn().mockResolvedValue(items);
  const provider = {
    describe: () => ({ id: "catalog" }),
    catalog,
  } as unknown as ManagedConnectorProvider;
  return {
    catalog,
    registry: {
      managed: (id: string) => (id === "catalog" ? provider : undefined),
      managedProviders: () => [provider],
    },
  };
}
describe("contextual app connections", () => {
  it("uses canonical catalog metadata without authorizing or exposing secrets", async () => {
    const { registry, catalog } = fixture();
    const result = await appConnectionCard(registry, context, "catalog", "granola");
    expect(result.block).toEqual({
      kind: "app_connect",
      connectorId: "catalog",
      provider: "granola",
      name: "Granola",
      description: "Meeting notes",
      logo: app.logo,
      status: "pending",
      requestId: "run",
    });
    expect(catalog).toHaveBeenCalledWith(context, "granola");
    expect(JSON.stringify(result)).not.toContain("authorizationUrl");
  });
  it("rejects invented apps, mismatched slugs and unavailable connectors", async () => {
    const { registry } = fixture();
    expect(
      (await appConnectionCard(registry, context, "catalog", "invented")).block,
    ).toBeUndefined();
    expect((await appConnectionCard(registry, context, "other", "granola")).error).toBeTruthy();
    expect((await appConnectionCard(undefined, context, "catalog", "granola")).error).toBeTruthy();
  });
  it("does not ask to reconnect a live account or conflate connector namespaces", async () => {
    const { registry } = fixture();
    const connected = {
      ...context,
      connectedConnections: [
        {
          id: "account",
          connectorId: "catalog",
          externalId: "granola",
          displayName: "Account",
        },
      ],
    };
    expect(await appConnectionCard(registry, connected, "catalog", "granola")).toEqual({
      connected: true,
    });
    expect(
      (
        await appConnectionCard(
          registry,
          {
            ...connected,
            connectedConnections: [{ ...connected.connectedConnections[0]!, connectorId: "other" }],
          },
          "catalog",
          "granola",
        )
      ).block,
    ).toBeDefined();
    expect(
      await appConnectionCard(
        fixture([{ ...app, connected: true }]).registry,
        context,
        "catalog",
        "granola",
      ),
    ).toEqual({ connected: true });
  });
  it("reports partial catalog failure while preserving real matches", async () => {
    const { registry } = fixture();
    const failed = {
      catalog: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as ManagedConnectorProvider;
    const result = await searchConnectableApps(
      {
        ...registry,
        managedProviders: () => [...registry.managedProviders(), failed],
      },
      context,
      "Granola",
    );
    expect(result.apps).toEqual([app]);
    expect(result.unavailable).toBe(true);
    expect((await searchConnectableApps(undefined, context, "Granola")).apps).toEqual([]);
  });
  it("never pushes authorization cards from background work", () => {
    const tools = [{ name: "search_apps" }, { name: "request_app_connection" }];
    for (const trigger of ["routine", "work", "research", "bot_message"]) {
      expect(filterBuiltinToolsForRun(tools, trigger)).toEqual([{ name: "search_apps" }]);
    }
    expect(filterBuiltinToolsForRun(tools, "user")).toEqual(tools);
    expect(filterBuiltinToolsForRun(tools, "follow_up")).toEqual(tools);
  });
});
