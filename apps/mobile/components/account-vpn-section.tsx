import type { HostVpnStatus } from "@rakazo/contracts";
import { switchHostVpn } from "@rakazo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";

const VPN_READ_TIMEOUT_MS = 5_000;

/**
 * Settings → Computer: the host Mac's WARP switch. Only the deployment owner
 * gets a status back, and a Mac without warp-cli reports `unavailable`; both
 * hide the whole section.
 */
export function AccountVpnSection() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const [status, setStatus] = useState<HostVpnStatus | null>(null);
  const [target, setTarget] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const readStatus = useCallback(
    (signal?: AbortSignal) =>
      rpc<HostVpnStatus>("computer/vpnStatus", {}, { signal, timeoutMs: VPN_READ_TIMEOUT_MS }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    readStatus(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setStatus(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [readStatus]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      const signal = abortRef.current?.signal;
      if (target !== null || !signal) return;
      setTarget(enabled);
      setError(null);
      try {
        const settled = await switchHostVpn({
          enabled,
          setVpn: (value) => rpc<{ accepted: boolean }>("computer/setVpn", { enabled: value }),
          readStatus: () => readStatus(signal),
          onStatus: setStatus,
          signal,
        });
        if (signal.aborted) return;
        if (!settled || settled.state !== (enabled ? "connected" : "disconnected")) {
          setError(t("Could not switch the VPN"));
        }
      } catch (failure) {
        if (!signal.aborted) {
          setError(failure instanceof Error ? failure.message : t("Could not switch the VPN"));
        }
      } finally {
        if (!signal.aborted) setTarget(null);
      }
    },
    [readStatus, target, t],
  );

  if (!status || (status.state === "unavailable" && target === null)) return null;

  // WARP can sit in "connecting" on a bad network; keep the switch usable so it can be turned off.
  const busy = target !== null || status.switching;
  const switching = busy || status.state === "connecting";
  const value = target ?? status.state !== "disconnected";

  return (
    <View accessibilityLabel={t("Computer")} style={styles.section}>
      <Text style={styles.title}>{t("Computer")}</Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{t("WARP VPN")}</Text>
          {switching ? <Text style={styles.detail}>{t("Switching…")}</Text> : null}
        </View>
        <Switch
          accessibilityLabel={t("WARP VPN")}
          disabled={busy}
          value={value}
          onValueChange={(next) => void toggle(next)}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Mirrors the Account screen's section card, title and switch row. */
function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    section: {
      borderRadius: 16,
      backgroundColor: native.fill,
      padding: 18,
      gap: 4,
    },
    title: {
      color: native.label,
      fontSize: 17,
      fontWeight: "600",
    },
    row: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    label: {
      color: native.label,
      fontSize: 15,
    },
    detail: {
      color: native.secondaryLabel,
      fontSize: 12.5,
      marginTop: 2,
    },
    error: {
      color: tokens.destructive,
      fontSize: 14,
    },
  });
}
