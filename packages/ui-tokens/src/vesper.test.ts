import { describe, expect, it } from "vitest";
import {
  BRANDS,
  type ColorTokens,
  cssVariableName,
  darkTokens,
  isBrand,
  lightTokens,
  renderTokensCss,
  tokensForAppearance,
  tokensForBrand,
  vesperColorTokens,
  vesperLight,
} from "./index.js";

/**
 * Frozen copies of the Negroni palettes as they stood before the Vesper brand axis
 * was added. Adding a brand must not move a single Negroni value, so these are
 * spelled out rather than derived.
 */
const NEGRONI_DARK_BEFORE: ColorTokens = {
  background: "#0B0C0E",
  foreground: "#ECECEE",
  card: "#141518",
  cardForeground: "#ECECEE",
  popover: "#141518",
  popoverForeground: "#ECECEE",
  primary: "#F1F1EF",
  primaryForeground: "#0B0C0E",
  secondary: "#18191E",
  secondaryForeground: "#ECECEE",
  chatUser: "#22242B",
  chatUserForeground: "#ECECEE",
  muted: "#141518",
  mutedForeground: "#85858A",
  accent: "#1A1B20",
  accentForeground: "#ECECEE",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#1E2026",
  input: "#18191E",
  ring: "#3B82F6",
  sidebar: "#111215",
  sidebarForeground: "#ECECEE",
  sidebarBorder: "#1C1D22",
  sidebarAccent: "#1A1B20",
  sidebarAccentForeground: "#ECECEE",
  link: "#3B82F6",
  success: "#4ECB71",
  warning: "#E9C46A",
  overlay: "rgba(4, 4, 5, 0.72)",
  scrollbar: "#1E2026",
  scrollbarHover: "#2E313A",
};

const NEGRONI_LIGHT_BEFORE: ColorTokens = {
  background: "#FAFAF8",
  foreground: "#1A1A1A",
  card: "#FFFFFF",
  cardForeground: "#1A1A1A",
  popover: "#FFFFFF",
  popoverForeground: "#1A1A1A",
  primary: "#1A1A1A",
  primaryForeground: "#F1F1EF",
  secondary: "#F0F0ED",
  secondaryForeground: "#1A1A1A",
  chatUser: "#E2E2DC",
  chatUserForeground: "#1A1A1A",
  muted: "#F0F0ED",
  mutedForeground: "#6C6C70",
  accent: "#EAEAE6",
  accentForeground: "#1A1A1A",
  destructive: "#DC2626",
  destructiveForeground: "#FFFFFF",
  border: "#F0F0ED",
  input: "#EAEAE6",
  ring: "#6C6C70",
  sidebar: "#ECECE9",
  sidebarForeground: "#1A1A1A",
  sidebarBorder: "#E8E8E4",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#1A1A1A",
  link: "#2563EB",
  success: "#228B3B",
  warning: "#B7791F",
  overlay: "rgba(20, 20, 22, 0.45)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
};

describe("brand axis", () => {
  it("leaves every Negroni token byte-identical", () => {
    expect(darkTokens).toEqual(NEGRONI_DARK_BEFORE);
    expect(lightTokens).toEqual(NEGRONI_LIGHT_BEFORE);
  });

  it("keeps tokensForAppearance returning the Negroni palettes", () => {
    expect(tokensForAppearance("dark")).toBe(darkTokens);
    expect(tokensForAppearance("light")).toBe(lightTokens);
  });

  it("names both brands and recognizes only those", () => {
    expect([...BRANDS]).toEqual(["negroni", "vesper"]);
    expect(isBrand("vesper")).toBe(true);
    expect(isBrand("negroni")).toBe(true);
    expect(isBrand("muse")).toBe(false);
    expect(isBrand(null)).toBe(false);
  });

  it("routes negroni through the appearance preference", () => {
    expect(tokensForBrand("negroni", "dark")).toBe(darkTokens);
    expect(tokensForBrand("negroni", "light")).toBe(lightTokens);
  });

  it("keeps vesper light in both appearances", () => {
    expect(tokensForBrand("vesper", "light")).toBe(vesperColorTokens);
    expect(tokensForBrand("vesper", "dark")).toBe(vesperColorTokens);
  });
});

describe("vesper theme", () => {
  it("covers every ColorTokens slot", () => {
    for (const key of Object.keys(lightTokens) as (keyof ColorTokens)[]) {
      expect(vesperColorTokens[key], key).toBeTruthy();
    }
    expect(Object.keys(vesperColorTokens).sort()).toEqual(Object.keys(lightTokens).sort());
  });

  it("carries the airy light canvas and the sky-blue user bubble", () => {
    expect(vesperLight.background).toBe("#FCFCFC");
    expect(vesperLight.foreground).toBe("#11191C");
    expect(vesperLight.card).toBe("#FFFFFF");
    expect(vesperLight.chatUser).toBe("#C8E7FF");
    expect(vesperLight.extras.bubbleAssistant).toBe("#EEEEF0");
    expect(vesperLight.extras.accentInk).toBe("#1473C8");
  });

  it("carries the bubble radius with its tail corner", () => {
    expect(vesperLight.radius.bubble).toBe(22);
    expect(vesperLight.radius.bubbleTail).toBe(7);
    expect(vesperLight.radius.composer).toBe(32);
    expect(vesperLight.radius.navPill).toBe(40);
  });

  it("keeps touch targets at 44 and nav items at 47", () => {
    expect(vesperLight.size.touchTarget).toBe(44);
    expect(vesperLight.size.navItemHeight).toBe(47);
    expect(vesperLight.size.composerInputMinHeight).toBe(44);
    expect(vesperLight.size.composerInputMaxHeight).toBe(140);
  });

  it("has exactly two shadows, one of which brightens on focus", () => {
    expect(vesperLight.shadow.composer.shadowOpacity).toBe(0.06);
    expect(vesperLight.shadow.composerFocused.shadowOpacity).toBe(0.1);
    expect(vesperLight.shadow.composerFocused.shadowColor).toBe(
      vesperLight.shadow.composer.shadowColor,
    );
    expect(vesperLight.shadow.nav.shadowColor).toBe("#132631");
  });

  it("keeps the avatar tints without the reference artwork", () => {
    expect(vesperLight.extras.avatarSky).toBe("#ECF5FA");
    expect(vesperLight.extras.avatarSand).toBe("#FAF0DF");
    expect(vesperLight.extras.avatarLilac).toBe("#F1ECF9");
  });
});

describe("tokens.css brand block", () => {
  it("emits a [data-brand=vesper] block alongside the theme blocks", () => {
    const css = renderTokensCss();
    expect(css).toContain('[data-brand="vesper"] {\n  color-scheme: light;');
    expect(css).toContain(`${cssVariableName("background")}: ${"#FCFCFC".toLowerCase()};`);
    expect(css).toContain(`${cssVariableName("chatUser")}: ${"#C8E7FF".toLowerCase()};`);
  });

  it("keeps the Negroni theme blocks first and unchanged", () => {
    const css = renderTokensCss();
    const rootIndex = css.indexOf(':root,\n[data-theme="dark"]');
    const lightIndex = css.indexOf('[data-theme="light"] {');
    const brandIndex = css.indexOf('[data-brand="vesper"] {');
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(lightIndex).toBeGreaterThan(rootIndex);
    expect(brandIndex).toBeGreaterThan(lightIndex);
  });
});
