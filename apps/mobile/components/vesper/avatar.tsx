import { Image, View } from "react-native";
import { colors, vt } from "./theme";

/**
 * Vesper's face in the header.
 *
 * The three tints are the reference design's sky / sand / lilac treatment; the
 * art on top is ours. The asset is referenced from exactly one place so swapping
 * the colourway is a one-file change.
 */
export type VesperAvatarVariant = "sky" | "sand" | "lilac";

const VESPER_AVATAR = require("../../assets/vesper-avatar.png");

export function VesperAvatar({
  size = 42,
  variant = "sky",
  label,
}: {
  size?: number;
  variant?: VesperAvatarVariant;
  label?: string;
}) {
  const tint = {
    sky: vt.extras.avatarSky,
    sand: vt.extras.avatarSand,
    lilac: vt.extras.avatarLilac,
  }[variant];
  return (
    <View
      accessible={!!label}
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        borderWidth: 1,
        borderColor: colors.line,
        // The art ships on a plain white square; the circle is cut here so the
        // asset never has to be re-exported for a new shape.
        overflow: "hidden",
      }}
    >
      <Image
        source={VESPER_AVATAR}
        resizeMode="cover"
        style={{ width: size, height: size }}
        accessible={false}
      />
    </View>
  );
}
