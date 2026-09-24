import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, type StyleProp, type ViewStyle, View } from "react-native";
import type { ResolvedAppearance } from "../lib/appearance";

type GlassSurfaceProps = {
  appearance: ResolvedAppearance;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  fallbackStyle?: StyleProp<ViewStyle>;
};

/** Uses native Liquid Glass where the device API is safe to call. */
export function GlassSurface({ appearance, children, style, fallbackStyle }: GlassSurfaceProps) {
  const canUseGlass = Platform.OS === "ios" && isGlassEffectAPIAvailable();
  if (canUseGlass) {
    return (
      <GlassView colorScheme={appearance} glassEffectStyle="regular" isInteractive style={style}>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, fallbackStyle]}>{children}</View>;
}
