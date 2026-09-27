import { vesperLight } from "@rakazo/ui-tokens";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

/**
 * Vesper's styles, built once from the brand tokens. Nothing in the Vesper tree
 * should carry a hex literal — if a colour is missing, it belongs in
 * `packages/ui-tokens/src/vesper.ts` first.
 */
export const vt = vesperLight;

export const colors = {
  canvas: vt.background,
  card: vt.card,
  text: vt.foreground,
  muted: vt.mutedForeground,
  line: vt.border,
  blue: vt.chatUser,
  blueDark: vt.extras.accentInk,
  sky: vt.extras.tintSky,
  green: vt.extras.tintGreen,
  lavender: vt.extras.tintLavender,
  orange: vt.extras.tintOrange,
  danger: vt.destructive,
} as const;

function textStyle(style: (typeof vt.type)[keyof typeof vt.type], color: string): TextStyle {
  return { color, ...style } as TextStyle;
}

export function shadow(name: keyof typeof vt.shadow): ViewStyle {
  const value = vt.shadow[name];
  return {
    shadowColor: value.shadowColor,
    shadowOffset: { width: value.shadowOffsetWidth, height: value.shadowOffsetHeight },
    shadowOpacity: value.shadowOpacity,
    shadowRadius: value.shadowRadius,
    elevation: value.elevation,
  };
}

export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  text: textStyle(vt.type.text, colors.text),
  muted: textStyle(vt.type.muted, colors.muted),
  small: textStyle(vt.type.small, colors.muted),
  label: textStyle(vt.type.label, colors.muted),
  title: textStyle(vt.type.title, colors.text),
  heading: textStyle(vt.type.heading, colors.text),
  sectionTitle: textStyle(vt.type.sectionTitle, colors.text),
  chatBody: textStyle(vt.type.chatBody, colors.text),
  card: {
    backgroundColor: colors.card,
    borderRadius: vt.radius.card,
    borderWidth: 0,
    padding: vt.space.cardPadding,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: vt.space.dividerMargin },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: vt.radius.input,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.card,
    minHeight: 45,
  },
  field: { gap: vt.space.fieldGap, marginBottom: vt.space.fieldBottom },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: vt.space.buttonPaddingHorizontal,
    minHeight: vt.space.buttonMinHeight,
    paddingVertical: vt.space.buttonPaddingVertical,
    borderRadius: vt.radius.button,
  },
  buttonSmall: {
    paddingHorizontal: vt.space.buttonSmallPaddingHorizontal,
    minHeight: vt.space.buttonSmallMinHeight,
    paddingVertical: vt.space.buttonSmallPaddingVertical,
  },
  primary: { backgroundColor: vt.primary },
  secondary: { backgroundColor: vt.extras.buttonSecondary },
  buttonText: textStyle(vt.type.buttonText, colors.text),
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: vt.radius.chip,
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
  },
  chipText: textStyle(vt.type.chipText, colors.muted),
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: vt.radius.iconBox,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.sky,
  },
  error: {
    padding: 16,
    borderRadius: vt.radius.errorSurface,
    backgroundColor: vt.extras.errorSurface,
    marginVertical: 10,
    gap: 4,
  },
  modalShade: {
    flex: 1,
    backgroundColor: vt.extras.modalShade,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderRadius: vt.radius.sheet,
    width: "100%",
    maxWidth: vt.size.sheetMaxWidth,
    maxHeight: "94%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
});
