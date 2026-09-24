import type { MessageBlock } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { appConnectPresentation } from "../lib/app-connect";
import { authorizeConnection } from "../lib/connection-auth";
import { native } from "../lib/native";
import { openConnectionAuthSession } from "../lib/open-auth-session";
import { AppLogo } from "./AppLogo";

export function AppConnectCard({
  botId,
  block,
}: {
  botId: string;
  block: Extract<MessageBlock, { kind: "app_connect" }>;
}) {
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<"pending" | "connected">(block.status);
  const [error, setError] = useState<string | null>(null);
  const connectionAttempt = useRef<AbortController | null>(null);
  const status = block.status === "connected" ? "connected" : localStatus;
  const view = appConnectPresentation({ ...block, status }, busy);

  useEffect(() => () => connectionAttempt.current?.abort(), []);

  async function authorize() {
    connectionAttempt.current?.abort();
    const controller = new AbortController();
    connectionAttempt.current = controller;
    setBusy(true);
    setError(null);
    try {
      const started = await rpc<{ connectionId: string; authorizationUrl: string | null }>(
        "connections/begin",
        {
          provider: block.provider,
          displayName: block.name,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const outcome = await authorizeConnection({
        connectionId: started.connectionId,
        authorizationUrl: started.authorizationUrl,
        openAuthSession: openConnectionAuthSession,
        complete: (connectionId) =>
          rpc<{ status: string }>(
            "connections/complete",
            { connectionId },
            { signal: controller.signal },
          ),
        signal: controller.signal,
      });
      if (outcome === "aborted") return;
      if (outcome === "pending") {
        setError("Still pending. Finish in the browser, then try again.");
        return;
      }
      await rpc("onboarding/appConnected", { botId, provider: block.provider });
      if (controller.signal.aborted) return;
      setLocalStatus("connected");
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Could not authorize this app");
      }
    } finally {
      if (connectionAttempt.current === controller) {
        connectionAttempt.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <View
      accessibilityLabel={`${block.name} connection`}
      style={{
        width: "90%",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "#232326",
        backgroundColor: "#17171A",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AppLogo name={block.name} logo={block.logo} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: "#ECECEE", fontSize: 15, fontWeight: "600" }}>{view.title}</Text>
          <Text style={{ color: "#85858A", fontSize: 13.5 }} numberOfLines={2}>
            {view.description}
          </Text>
        </View>
        {view.showAuthorize ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Authorize ${block.name}`}
            disabled={busy}
            onPress={() => void authorize()}
            style={{
              minHeight: 36,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: native.fillPressed,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {busy ? (
              <ActivityIndicator color={native.label} />
            ) : (
              <Text style={{ color: native.label, fontSize: 14, fontWeight: "600" }}>
                {view.actionLabel}
              </Text>
            )}
          </Pressable>
        ) : (
          <Text style={{ color: "#4ECB71", fontSize: 13.5, fontWeight: "600" }}>
            {view.actionLabel}
          </Text>
        )}
      </View>
      {error ? <Text style={{ color: "#E96B6B", fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}
