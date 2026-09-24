import type { ConnectionCatalogItem } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { buildConnectorCatalogView, connectorCategoryTitle } from "./connector-catalog.js";

function app(
  slug: string,
  name: string,
  category?: [string, string],
  connected = false,
): ConnectionCatalogItem {
  return {
    connectorId: "composio",
    slug,
    name,
    logo: null,
    connected,
    noAuth: false,
    categories: category ? [{ slug: category[0], name: category[1] }] : [],
  };
}

const catalog = [
  app("github", "GitHub", ["developer-tools", "developer tools"]),
  app("gmail", "Gmail", ["email", "email"], true),
  app("slack", "Slack", ["team-collaboration", "team collaboration"]),
  app("notion", "Notion", ["productivity", "productivity"]),
  app("custom", "Custom"),
  app("outlook", "Outlook", ["email", "email"]),
];

describe("buildConnectorCatalogView", () => {
  it("puts connected apps first, then popular apps, then sorted categories with Other last", () => {
    const view = buildConnectorCatalogView(catalog);
    expect(view.connected.map((item) => item.slug)).toEqual(["gmail"]);
    expect(view.sections.map((section) => section.title)).toEqual([
      "Popular",
      "Developer tools",
      "Email",
      "Productivity",
      "Team collaboration",
      "Other",
    ]);
    expect(view.sections[0]?.items.map((item) => item.slug)).toEqual(["slack", "notion"]);
    expect(view.sections.find((section) => section.id === "email")?.items).toHaveLength(1);
  });

  it("filters categories by query, drops Popular and keeps connected apps", () => {
    const view = buildConnectorCatalogView(catalog, "out");
    expect(view.connected.map((item) => item.slug)).toEqual(["gmail"]);
    expect(view.sections).toEqual([
      { id: "email", title: "Email", items: [expect.objectContaining({ slug: "outlook" })] },
    ]);
  });

  it("sentence-cases provider category names", () => {
    expect(connectorCategoryTitle("images & design")).toBe("Images & design");
    expect(connectorCategoryTitle("ai-agents")).toBe("Ai agents");
  });
});
