export type ToolkitCategory = { slug: string; name: string };

export type ToolkitDirectoryEntry = {
  slug: string;
  name: string;
  logo: string | null;
  noAuth: boolean;
  categories: ToolkitCategory[];
  description?: string;
};

export type ToolkitMetadata = Pick<ToolkitDirectoryEntry, "categories" | "description" | "logo">;

/** Attach provider metadata (categories, description, logo fallback) to directory entries by slug. */
export function withToolkitMetadata(
  directory: Array<Omit<ToolkitDirectoryEntry, "categories" | "description">>,
  metadata: ReadonlyMap<string, ToolkitMetadata>,
): ToolkitDirectoryEntry[] {
  return directory.map((item) => {
    const meta = metadata.get(item.slug.trim().toLowerCase());
    return {
      ...item,
      logo: item.logo ?? meta?.logo ?? null,
      categories: meta?.categories ?? [],
      ...(meta?.description ? { description: meta.description } : {}),
    };
  });
}

export type ToolkitCatalogEntry = ToolkitDirectoryEntry & { connected: boolean };

export const COMPOSIO_DIRECTORY_TTL_MS = 60 * 60 * 1000;

export function mergeCatalogWithConnected(
  directory: ToolkitDirectoryEntry[],
  connectedSlugs: Iterable<string>,
): ToolkitCatalogEntry[] {
  const connected = new Set([...connectedSlugs].map((slug) => slug.trim().toLowerCase()));
  return directory.map((item) => ({
    ...item,
    connected: connected.has(item.slug.trim().toLowerCase()),
  }));
}

export function createToolkitDirectoryCache(opts?: { ttlMs?: number; now?: () => number }) {
  const ttlMs = opts?.ttlMs ?? COMPOSIO_DIRECTORY_TTL_MS;
  const now = opts?.now ?? Date.now;
  let entry: { items: ToolkitDirectoryEntry[]; fetchedAt: number } | undefined;
  let inflight: Promise<ToolkitDirectoryEntry[]> | undefined;

  async function load(loader: () => Promise<ToolkitDirectoryEntry[]>) {
    inflight ??= loader()
      .then((items) => {
        entry = { items, fetchedAt: now() };
        return items;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  }

  return {
    peek(): ToolkitDirectoryEntry[] | undefined {
      return entry?.items;
    },
    async get(loader: () => Promise<ToolkitDirectoryEntry[]>): Promise<ToolkitDirectoryEntry[]> {
      if (!entry) return load(loader);
      if (now() - entry.fetchedAt < ttlMs) return entry.items;
      if (!inflight) void load(loader);
      return entry.items;
    },
    invalidate() {
      entry = undefined;
    },
  };
}

export const composioToolkitDirectory = createToolkitDirectoryCache();
