import { useRef } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { retainScreenSource } from "../../../lib/computer";
import { colors, s, vt } from "../theme";

/**
 * The live desktop.
 *
 * The transport is Negroni's: a noVNC stream behind a sealed, expiring
 * capability from `computer.screenUrl`, proxied by `apps/api/src/screen-proxy.ts`.
 * `retainScreenSource` keeps the connected stream across token rotation so the
 * picture does not blink every time the capability is renewed. Only the chrome
 * around it is Vesper's.
 */
export function VesperScreenView({
  url,
  interactive,
  onError,
}: {
  url: string;
  /** Touches only reach the desktop while this person holds the lease. */
  interactive: boolean;
  onError: () => void;
}) {
  const held = useRef(url);
  held.current = retainScreenSource(held.current, url);
  return (
    <WebView
      key={held.current}
      source={{ uri: held.current }}
      style={{ flex: 1, backgroundColor: colors.canvas }}
      pointerEvents={interactive ? "auto" : "none"}
      javaScriptEnabled
      domStorageEnabled
      keyboardDisplayRequiresUserAction={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      originWhitelist={["*"]}
      mixedContentMode="always"
      setSupportMultipleWindows={false}
      scrollEnabled={false}
      overScrollMode="never"
      onError={onError}
      onHttpError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
    />
  );
}

/** What fills the frame when there is no stream to show. */
export function VesperScreenPlaceholder({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        gap: 14,
        backgroundColor: vt.extras.previewPlaceholder,
      }}
    >
      <View style={{ width: "70%", maxWidth: 260, gap: 8 }}>
        {[1, 0.75, 0.45].map((fraction) => (
          <View
            key={fraction}
            style={{
              height: 9,
              width: `${fraction * 100}%`,
              borderRadius: vt.radius.progressBar,
              backgroundColor: vt.extras.skeleton,
            }}
          />
        ))}
      </View>
      <Text style={[s.muted, { textAlign: "center" }]}>{message}</Text>
    </View>
  );
}
