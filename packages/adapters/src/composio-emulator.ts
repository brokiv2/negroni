import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorTool,
} from "@rakazo/adapter-kit";
import {
  type ComposioCatalogItem,
  type ComposioProvider,
  filterCatalog,
} from "./composio-connector.js";

const category = (slug: string, name: string) => ({ slug, name });

const DEFAULT_CATALOG: ReadonlyArray<Omit<ComposioCatalogItem, "connected">> = [
  {
    slug: "GMAIL",
    name: "Gmail",
    logo: null,
    noAuth: false,
    categories: [category("email", "email")],
  },
  {
    slug: "GOOGLECALENDAR",
    name: "Google Calendar",
    logo: null,
    noAuth: false,
    categories: [category("scheduling-&-booking", "scheduling & booking")],
  },
  {
    slug: "GOOGLEDRIVE",
    name: "Google Drive",
    logo: null,
    noAuth: false,
    categories: [category("file-management-&-storage", "file management & storage")],
  },
  {
    slug: "SLACK",
    name: "Slack",
    logo: null,
    noAuth: false,
    categories: [category("team-collaboration", "team collaboration")],
  },
  {
    slug: "GITHUB",
    name: "GitHub",
    logo: null,
    noAuth: false,
    categories: [category("developer-tools", "developer tools")],
  },
  {
    slug: "NOTION",
    name: "Notion",
    logo: null,
    noAuth: false,
    categories: [category("productivity", "productivity")],
  },
];

/** Deterministic, offline Composio catalog and connection emulator for product tests. */
export class ComposioEmulator implements ComposioProvider {
  private readonly connectedByUser = new Map<string, Set<string>>();
  readonly executions: Array<{
    userId: string;
    tool: string;
    args: Record<string, unknown>;
  }> = [];

  constructor(
    private readonly directory: ReadonlyArray<
      Omit<ComposioCatalogItem, "connected">
    > = DEFAULT_CATALOG,
  ) {}

  describe() {
    return {
      id: "composio",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  async catalog(context: AdapterContext, query?: string) {
    const connected = this.connectedByUser.get(context.userId) ?? new Set<string>();
    return filterCatalog(
      this.directory.map((item) => ({ ...item, connected: connected.has(item.slug) })),
      query ?? "",
    ).map((item) => ({ ...item, connectorId: "composio" }));
  }

  async warmDirectory(): Promise<void> {}

  async listConnectedSlugs(userId: string): Promise<string[]> {
    return [...(this.connectedByUser.get(userId) ?? [])];
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    return this.listConnectedSlugs(context.userId);
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const connected =
      context.connectedConnections
        ?.filter((connection) => connection.connectorId === "composio")
        .map((connection) => connection.externalId) ??
      context.connectedProviders ??
      [];
    return [...new Set(connected)].map((slug) => ({
      name: `${slug}_EMULATED_ACTION`,
      description: `Run a deterministic ${slug} action`,
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
      },
    }));
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    this.executions.push({ userId: context.userId, tool: call.tool, args: call.args });
    yield { type: "result", data: { ok: true, tool: call.tool, args: call.args } };
  }

  async begin(
    request: { provider: string; redirectUrl: string },
    context: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }> {
    const connected = this.connectedByUser.get(context.userId) ?? new Set<string>();
    connected.add(request.provider);
    this.connectedByUser.set(context.userId, connected);
    return { authorizationUrl: null, state: request.provider };
  }

  async connectionReady(context: AdapterContext, slug: string): Promise<boolean> {
    return this.connectedByUser.get(context.userId)?.has(slug) ?? false;
  }

  async complete(
    request: { state: string; code?: string },
    _context: AdapterContext,
  ): Promise<{ connectionRef: string }> {
    return { connectionRef: request.state };
  }

  async revoke(connectionRef: string, context: AdapterContext): Promise<void> {
    this.connectedByUser.get(context.userId)?.delete(connectionRef);
  }
}
