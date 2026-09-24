// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const catalog = [
  {
    connectorId: "composio",
    slug: "GMAIL",
    name: "Gmail",
    logo: "https://logos.example/gmail",
    connected: true,
    noAuth: false,
    categories: [{ slug: "email", name: "email" }],
  },
  {
    connectorId: "composio",
    slug: "SLACK",
    name: "Slack",
    logo: null,
    connected: false,
    noAuth: false,
    categories: [{ slug: "team-collaboration", name: "team collaboration" }],
  },
  {
    connectorId: "composio",
    slug: "GITHUB",
    name: "GitHub",
    logo: null,
    connected: false,
    noAuth: false,
    categories: [{ slug: "developer-tools", name: "developer tools" }],
  },
];

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

vi.mock("../lib/rpc", () => ({
  rpc: {
    connections: {
      catalog: vi.fn(async () => catalog),
      list: vi.fn(async () => []),
    },
    capabilities: { list: vi.fn(async () => []) },
  },
}));

const { PluginsOverlay } = await import("./PluginsOverlay");

describe("PluginsOverlay", () => {
  it("shows connected apps first, then collapsible category sections with logos", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<PluginsOverlay onClose={() => undefined} />);
    });
    const connected = container.querySelector('[data-testid="connected-integrations"]');
    expect(connected?.textContent).toContain("Gmail");
    expect(connected?.querySelector("img")?.getAttribute("src")).toBe(
      "https://logos.example/gmail",
    );
    const headers = [
      ...container.querySelectorAll('[data-testid="integration-categories"] button[aria-expanded]'),
    ];
    expect(headers.map((header) => header.textContent)).toEqual([
      "Popular1›",
      "Developer tools1›",
      "Team collaboration1›",
    ]);
    const developer = headers[1] as HTMLButtonElement;
    expect(developer.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("GitHub");
    await act(async () => developer.click());
    expect(developer.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("GitHub");
    act(() => root.unmount());
  });
});
