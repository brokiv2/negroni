/**
 * Vesper brand axis.
 *
 * Vesper is the second shell inside the same binary as Negroni: one Expo project,
 * one iOS bundle, one Electron app, two shells switched at the top level. Its
 * palette, radii, spacing, type scale and the two shadows it uses are all frozen
 * here so no surface has to hard-code a hex again.
 *
 * Values are measurements taken from the OpenMuse iOS app (MIT). Colour values and
 * layout measurements are facts, not code; nothing in this file is copied source.
 *
 * Light only, deliberately: the reference design ships `userInterfaceStyle: "light"`
 * and has no dark palette to port. `tokensForBrand("vesper", "dark")` therefore
 * returns the same light palette rather than inventing one.
 */
import type { ColorTokens } from "./index.js";

export const BRANDS = ["negroni", "vesper"] as const;

export type Brand = (typeof BRANDS)[number];

export function isBrand(value: string | null | undefined): value is Brand {
  return value === "negroni" || value === "vesper";
}

/**
 * Colours the shadcn-style `ColorTokens` set has no slot for. Every entry is a
 * literal the reference design uses in exactly one role.
 */
export type VesperExtras = {
  /** Assistant message bubble, typing-dot pill, browser tool card body. */
  bubbleAssistant: string;
  /** Generic tool-result card surface. */
  surfaceToolCard: string;
  /** Mail tool card surface. */
  surfaceMailCard: string;
  /** Secondary button fill. */
  buttonSecondary: string;
  /** Selected bottom-nav item fill. */
  navActive: string;
  /** Bottom-nav pill hairline. */
  navBorder: string;
  /** Neutral pill fill (the "Computer · take control" pill). */
  pillNeutral: string;
  /** Composer border, idle. */
  inputBorder: string;
  /** Composer border while focused. */
  inputBorderFocus: string;
  /** Send button fill when there is nothing to send. */
  sendIdleBg: string;
  /** Send arrow ink when there is nothing to send. */
  sendIdleInk: string;
  /** Composer placeholder ink. */
  placeholder: string;
  /** Skeleton bars in an empty preview. */
  skeleton: string;
  /** Empty preview surface behind the skeleton bars. */
  previewPlaceholder: string;
  /** Filled part of a progress bar. */
  progressFill: string;
  /** Success check inside a tool card. */
  checkOk: string;
  /** Computer pill status dot, online. */
  statusOnline: string;
  /** Computer pill status dot, offline. */
  statusOffline: string;
  /** Error notice surface. */
  errorSurface: string;
  /** Modal scrim. */
  modalShade: string;
  /** Bottom-sheet grab handle. */
  grabHandle: string;
  /** Inline code and code-block background. */
  code: string;
  /** PDF badge on a file card. */
  pdfBadge: string;
  /** Tracking (monitor) list dot / ring / ink. */
  trackingDot: string;
  trackingRing: string;
  trackingInk: string;
  /** Goal list dot / ring. */
  goalDot: string;
  goalRing: string;
  /** Disclosure chevron and secondary list glyph. */
  listChevron: string;
  listGlyph: string;
  /** Category row icon and ink. */
  categoryIcon: string;
  categoryInk: string;
  /** Document thumbnail sub-palette. */
  docThumbBg: string;
  docPage: string;
  docPageBorder: string;
  docLineAccent: string;
  docLine: string;
  /** Avatar tints. The treatment is reproduced; the art on top is ours. */
  avatarSky: string;
  avatarSand: string;
  avatarLilac: string;
  /** Tinted icon-box / info-card backgrounds. */
  tintSky: string;
  tintGreen: string;
  tintLavender: string;
  tintOrange: string;
  /** Accent ink used for icons inside tinted boxes, links and spinners. */
  accentInk: string;
};

/**
 * The finance card is deliberately dark against the light canvas, so it is a
 * scoped group rather than loose extras.
 */
export type VesperFinanceTokens = {
  body: string;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
  tile: string;
  tileLabel: string;
  tileValue: string;
  savedValue: string;
  footnote: string;
  caption: string;
  barTrack: string;
};

export type VesperRadiusTokens = {
  card: number;
  input: number;
  button: number;
  buttonSmall: number;
  chip: number;
  iconBox: number;
  iconBoxLarge: number;
  sheet: number;
  errorSurface: number;
  /** Message bubble; the tail corner uses `bubbleTail`. */
  bubble: number;
  bubbleTail: number;
  composer: number;
  composerButton: number;
  navPill: number;
  navItem: number;
  toolCardInner: number;
  computerPill: number;
  toast: number;
  checkbox: number;
  iconButton: number;
  progressBar: number;
  financeCard: number;
  financeTile: number;
};

export type VesperSpaceTokens = {
  cardPadding: number;
  sheetHeaderPadding: number;
  sheetHeaderPaddingCompact: number;
  sheetBodyPadding: number;
  sheetBodyPaddingCompact: number;
  fieldGap: number;
  fieldBottom: number;
  buttonPaddingHorizontal: number;
  buttonMinHeight: number;
  buttonPaddingVertical: number;
  buttonSmallPaddingHorizontal: number;
  buttonSmallMinHeight: number;
  buttonSmallPaddingVertical: number;
  dividerMargin: number;
  messageGap: number;
  messageListPaddingTop: number;
  messageListPaddingBottom: number;
  bubblePaddingHorizontal: number;
  bubblePaddingVertical: number;
  composerPadding: number;
  composerGap: number;
  navPaddingHorizontal: number;
  navPaddingTop: number;
  navPaddingBottom: number;
  navPaddingBottomDesktop: number;
  screenPaddingHorizontal: number;
  screenPaddingHorizontalDesktop: number;
  chatPaddingHorizontal: number;
  chatPaddingHorizontalDesktop: number;
};

export type VesperSizeTokens = {
  /** Content column. */
  contentMaxWidth: number;
  navPillMaxWidth: number;
  toolCardMaxWidth: number;
  sheetMaxWidth: number;
  sheetMaxWidthWide: number;
  emptyDetailMaxWidth: number;
  chatEmptyHeadlineMaxWidth: number;
  /** Minimum touch target for icon buttons and the composer's two buttons. */
  touchTarget: number;
  navItemHeight: number;
  headerHeight: number;
  headerHeightDesktop: number;
  composerInputMinHeight: number;
  composerInputMaxHeight: number;
  /** Width at or above which the shell uses its desktop metrics. */
  desktopBreakpoint: number;
  /** Width below which a sheet slides up from the bottom instead of fading in. */
  sheetCompactBreakpoint: number;
};

export type VesperTypeStyle = {
  fontSize: number;
  lineHeight?: number;
  fontWeight?: string;
  letterSpacing?: number;
  textTransform?: "uppercase";
};

export type VesperTypeTokens = {
  text: VesperTypeStyle;
  muted: VesperTypeStyle;
  small: VesperTypeStyle;
  label: VesperTypeStyle;
  title: VesperTypeStyle;
  heading: VesperTypeStyle;
  buttonText: VesperTypeStyle;
  chipText: VesperTypeStyle;
  /** Both bubbles use the same body size. */
  chatBody: VesperTypeStyle;
  composerInput: VesperTypeStyle;
  headerName: VesperTypeStyle;
  headerStatus: VesperTypeStyle;
  sectionTitle: VesperTypeStyle;
  chatEmptyHeadline: VesperTypeStyle;
  welcomeHeadline: VesperTypeStyle;
  markdownH1: VesperTypeStyle;
  markdownH2: VesperTypeStyle;
  markdownH3: VesperTypeStyle;
};

export type VesperShadow = {
  shadowColor: string;
  shadowOffsetWidth: number;
  shadowOffsetHeight: number;
  shadowRadius: number;
  shadowOpacity: number;
  elevation: number;
};

export type VesperShadowTokens = {
  composer: VesperShadow;
  composerFocused: VesperShadow;
  nav: VesperShadow;
};

export type ShapeTokens = {
  radius: VesperRadiusTokens;
  space: VesperSpaceTokens;
  size: VesperSizeTokens;
  type: VesperTypeTokens;
  shadow: VesperShadowTokens;
};

export type ThemeTokens = ColorTokens &
  ShapeTokens & {
    extras: VesperExtras;
    finance: VesperFinanceTokens;
  };

const vesperColors = {
  background: "#FCFCFC",
  foreground: "#11191C",
  card: "#FFFFFF",
  cardForeground: "#11191C",
  popover: "#FFFFFF",
  popoverForeground: "#11191C",
  primary: "#C8E7FF",
  primaryForeground: "#11191C",
  secondary: "#F1F2F3",
  secondaryForeground: "#11191C",
  chatUser: "#C8E7FF",
  chatUserForeground: "#11191C",
  muted: "#EEEEF0",
  mutedForeground: "#697176",
  accent: "#EDF7FD",
  accentForeground: "#1473C8",
  destructive: "#AA4A45",
  destructiveForeground: "#FFFFFF",
  border: "#EEEEF0",
  input: "#EEEEF0",
  ring: "#1473C8",
  sidebar: "#FCFCFC",
  sidebarForeground: "#11191C",
  sidebarBorder: "#EEEEF0",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#11191C",
  link: "#1473C8",
  success: "#E3F3E8",
  warning: "#FDF0DF",
  overlay: "rgba(35,48,44,0.25)",
  scrollbar: "#EEEEF0",
  scrollbarHover: "#D8DBDE",
} as const satisfies ColorTokens;

export const vesperLight: ThemeTokens = {
  ...vesperColors,
  extras: {
    bubbleAssistant: "#EEEEF0",
    surfaceToolCard: "#F0F1F2",
    surfaceMailCard: "#F0EFF2",
    buttonSecondary: "#F1F2F3",
    navActive: "#F0F1F2",
    navBorder: "#F8F8F8",
    pillNeutral: "#F1F3F4",
    inputBorder: "#EEF0F2",
    inputBorderFocus: "#C7E4F9",
    sendIdleBg: "#F3F5F6",
    sendIdleInk: "#9CB5C5",
    placeholder: "#949B9F",
    skeleton: "#E3E9ED",
    previewPlaceholder: "#FAFAFB",
    progressFill: "#6AAEE0",
    checkOk: "#47896C",
    statusOnline: "#57AD85",
    statusOffline: "#ACB0B5",
    errorSurface: "#FBEFED",
    modalShade: "rgba(35,48,44,0.25)",
    grabHandle: "#D8DBDE",
    code: "#E2E4E7",
    pdfBadge: "#FC2359",
    trackingDot: "#24A46B",
    trackingRing: "#D9F1E2",
    trackingInk: "#189A58",
    goalDot: "#3D9BDE",
    goalRing: "#D7E9FA",
    listChevron: "#A3A6A8",
    listGlyph: "#A7AAAC",
    categoryIcon: "#989C9F",
    categoryInk: "#666A6D",
    docThumbBg: "#EDEFEA",
    docPage: "#FFFFFF",
    docPageBorder: "#DDE3DD",
    docLineAccent: "#A4BED0",
    docLine: "#E3E7E3",
    avatarSky: "#ECF5FA",
    avatarSand: "#FAF0DF",
    avatarLilac: "#F1ECF9",
    tintSky: "#EDF7FD",
    tintGreen: "#E3F3E8",
    tintLavender: "#F0EEFA",
    tintOrange: "#FDF0DF",
    accentInk: "#1473C8",
  },
  finance: {
    body: "#080B10",
    gradientFrom: "#281066",
    gradientVia: "#163BBF",
    gradientTo: "#148CE8",
    tile: "#1D2025",
    tileLabel: "#A4A7AD",
    tileValue: "#FFFFFF",
    savedValue: "#58D3AE",
    footnote: "#7E8289",
    caption: "#D4DCFC",
    barTrack: "#DFE8EB",
  },
  radius: {
    card: 23,
    input: 19,
    button: 24,
    buttonSmall: 24,
    chip: 20,
    iconBox: 13,
    iconBoxLarge: 18,
    sheet: 26,
    errorSurface: 14,
    bubble: 22,
    bubbleTail: 7,
    composer: 32,
    composerButton: 24,
    navPill: 40,
    navItem: 28,
    toolCardInner: 12,
    computerPill: 20,
    toast: 20,
    checkbox: 5,
    iconButton: 22,
    progressBar: 4,
    financeCard: 16,
    financeTile: 12,
  },
  space: {
    cardPadding: 20,
    sheetHeaderPadding: 24,
    sheetHeaderPaddingCompact: 20,
    sheetBodyPadding: 24,
    sheetBodyPaddingCompact: 20,
    fieldGap: 7,
    fieldBottom: 16,
    buttonPaddingHorizontal: 17,
    buttonMinHeight: 42,
    buttonPaddingVertical: 10,
    buttonSmallPaddingHorizontal: 13,
    buttonSmallMinHeight: 38,
    buttonSmallPaddingVertical: 7,
    dividerMargin: 18,
    messageGap: 13,
    messageListPaddingTop: 15,
    messageListPaddingBottom: 20,
    bubblePaddingHorizontal: 16,
    bubblePaddingVertical: 13,
    composerPadding: 8,
    composerGap: 7,
    navPaddingHorizontal: 22,
    navPaddingTop: 10,
    navPaddingBottom: 7,
    navPaddingBottomDesktop: 22,
    screenPaddingHorizontal: 22,
    screenPaddingHorizontalDesktop: 42,
    chatPaddingHorizontal: 17,
    chatPaddingHorizontalDesktop: 42,
  },
  size: {
    contentMaxWidth: 760,
    navPillMaxWidth: 370,
    toolCardMaxWidth: 440,
    sheetMaxWidth: 790,
    sheetMaxWidthWide: 1050,
    emptyDetailMaxWidth: 360,
    chatEmptyHeadlineMaxWidth: 350,
    touchTarget: 44,
    navItemHeight: 47,
    headerHeight: 122,
    headerHeightDesktop: 146,
    composerInputMinHeight: 44,
    composerInputMaxHeight: 140,
    desktopBreakpoint: 900,
    sheetCompactBreakpoint: 600,
  },
  type: {
    text: { fontSize: 15, lineHeight: 23 },
    muted: { fontSize: 14, lineHeight: 21 },
    small: { fontSize: 11, lineHeight: 17 },
    label: { fontSize: 10, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },
    title: { fontSize: 23, fontWeight: "600", letterSpacing: -0.7 },
    heading: { fontSize: 16, fontWeight: "600", letterSpacing: -0.25 },
    buttonText: { fontSize: 14, fontWeight: "600" },
    chipText: { fontSize: 10, fontWeight: "600" },
    chatBody: { fontSize: 16, lineHeight: 24 },
    composerInput: { fontSize: 17, lineHeight: 24 },
    headerName: { fontSize: 16, fontWeight: "600", letterSpacing: -0.4 },
    headerStatus: { fontSize: 11 },
    sectionTitle: { fontSize: 25, fontWeight: "600", letterSpacing: -0.7 },
    chatEmptyHeadline: { fontSize: 28, letterSpacing: -1 },
    welcomeHeadline: { fontSize: 32, fontWeight: "500", letterSpacing: -1 },
    markdownH1: { fontSize: 21, lineHeight: 27 },
    markdownH2: { fontSize: 19, lineHeight: 25 },
    markdownH3: { fontSize: 17, lineHeight: 23 },
  },
  shadow: {
    composer: {
      shadowColor: "#18384B",
      shadowOffsetWidth: 0,
      shadowOffsetHeight: 4,
      shadowRadius: 20,
      shadowOpacity: 0.06,
      elevation: 4,
    },
    composerFocused: {
      shadowColor: "#18384B",
      shadowOffsetWidth: 0,
      shadowOffsetHeight: 4,
      shadowRadius: 20,
      shadowOpacity: 0.1,
      elevation: 4,
    },
    nav: {
      shadowColor: "#132631",
      shadowOffsetWidth: 0,
      shadowOffsetHeight: 2,
      shadowRadius: 18,
      shadowOpacity: 0.07,
      elevation: 3,
    },
  },
};

/** Colour-only view of the Vesper theme, for callers that take `ColorTokens`. */
export const vesperColorTokens: ColorTokens = vesperColors;
