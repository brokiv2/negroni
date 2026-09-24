import type { ConnectionCatalogItem } from "@rakazo/contracts";
import { FEATURED_CONNECTOR_IDS, matchFeaturedConnectorId } from "./featured-connectors.js";

export type ConnectorCatalogSection = {
  id: string;
  title: string;
  items: ConnectionCatalogItem[];
};

export type ConnectorCatalogView = {
  /** Apps with at least one connected account; not affected by the search query. */
  connected: ConnectionCatalogItem[];
  /** Popular apps first (only without a query), then one section per primary category. */
  sections: ConnectorCatalogSection[];
};

export const POPULAR_CONNECTOR_SECTION_ID = "popular";
export const OTHER_CONNECTOR_SECTION_ID = "other";

function featuredRank(item: ConnectionCatalogItem): number {
  const id = matchFeaturedConnectorId(item.slug) ?? matchFeaturedConnectorId(item.name);
  return id === null ? -1 : FEATURED_CONNECTOR_IDS.indexOf(id);
}

export function connectorCategoryTitle(name: string): string {
  const trimmed = name.trim().replace(/[-_]+/g, " ");
  return trimmed ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : "Other";
}

export function matchesConnectorQuery(item: ConnectionCatalogItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    item.slug.toLowerCase().includes(needle) ||
    item.connectorId.toLowerCase().includes(needle)
  );
}

/** Group a connector catalog into connected apps, popular apps and category sections. */
export function buildConnectorCatalogView(
  catalog: readonly ConnectionCatalogItem[],
  query = "",
): ConnectorCatalogView {
  const connected = catalog
    .filter((item) => item.connected)
    .sort((a, b) => {
      const rank = (item: ConnectionCatalogItem) => {
        const featured = featuredRank(item);
        return featured === -1 ? FEATURED_CONNECTOR_IDS.length : featured;
      };
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  const searching = query.trim().length > 0;
  const available = catalog.filter((item) => !item.connected && matchesConnectorQuery(item, query));
  const sections: ConnectorCatalogSection[] = [];
  if (!searching) {
    const popular = available
      .filter((item) => featuredRank(item) !== -1)
      .sort((a, b) => featuredRank(a) - featuredRank(b));
    if (popular.length > 0) {
      sections.push({ id: POPULAR_CONNECTOR_SECTION_ID, title: "Popular", items: popular });
    }
  }
  const byCategory = new Map<string, ConnectorCatalogSection>();
  for (const item of available) {
    const category = item.categories?.[0];
    const id = category?.slug.trim() || OTHER_CONNECTOR_SECTION_ID;
    let section = byCategory.get(id);
    if (!section) {
      section = {
        id,
        title: category ? connectorCategoryTitle(category.name || category.slug) : "Other",
        items: [],
      };
      byCategory.set(id, section);
    }
    section.items.push(item);
  }
  const categories = [...byCategory.values()].sort((a, b) => {
    if (a.id === OTHER_CONNECTOR_SECTION_ID) return 1;
    if (b.id === OTHER_CONNECTOR_SECTION_ID) return -1;
    return a.title.localeCompare(b.title);
  });
  return { connected, sections: [...sections, ...categories] };
}
