import { useState } from "react";
import { Image, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { native } from "../lib/native";

/** Composio serves SVG logos without an extension; RN Image cannot draw SVG. */
function isSvgLogo(uri: string): boolean {
  return /\.svg(?:$|[?#])/i.test(uri) || uri.includes("logos.composio.dev/");
}

export function AppLogo({
  name,
  logo,
  size = 36,
}: {
  name: string;
  logo: string | null | undefined;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const inner = Math.round(size * 0.66);
  if (logo && !failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: native.fillPressed,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {isSvgLogo(logo) ? (
          <SvgUri uri={logo} width={inner} height={inner} onError={() => setFailed(true)} />
        ) : (
          <Image
            source={{ uri: logo }}
            style={{ width: inner, height: inner }}
            resizeMode="contain"
            onError={() => setFailed(true)}
          />
        )}
      </View>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: native.fillPressed,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: native.label, fontSize: size * 0.42, fontWeight: "600" }}>
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </Text>
    </View>
  );
}
