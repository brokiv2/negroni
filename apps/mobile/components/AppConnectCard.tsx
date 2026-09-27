import type { MessageBlock } from "@rakazo/contracts";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewProps } from "react-native";
import { rpc } from "../lib/api";
import { appConnectPresentation } from "../lib/app-connect";
import { authorizeConnection } from "../lib/connection-auth";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { openConnectionAuthSession } from "../lib/open-auth-session";
import { AppLogo } from "./AppLogo";

export function AppConnectCard({
  botId,
  block,
  accessibilityActions,
  onAccessibilityAction,
}: {
  botId: string;
  block: Extract<MessageBlock, { kind: "app_connect" }>;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
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
          connectorId: block.connectorId,
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
        setError(t("Still pending. Finish in the browser, then try again."));
        return;
      }
      await rpc("onboarding/appConnected", {
        botId,
        provider: block.provider,
        connectorId: block.connectorId,
      });
      if (controller.signal.aborted) return;
      setLocalStatus("connected");
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t("Could not authorize this app"));
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
      accessibilityLabel={t("{name} connection", { name: block.name })}
      style={{
        width: "90%",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AppLogo name={block.name} logo={block.logo} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={onAccessibilityAction}
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
          >
            {view.title}
          </Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13.5 }} numberOfLines={2}>
            {view.description}
          </Text>
        </View>
        {view.showAuthorize ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Authorize {name}", { name: block.name })}
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
          <Text style={{ color: tokens.success, fontSize: 13.5, fontWeight: "600" }}>
            {view.actionLabel}
          </Text>
        )}
      </View>
      {error ? <Text style={{ color: tokens.destructive, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}
