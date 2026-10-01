import type { HostVpnStatus } from "@rakazo/contracts";
import { switchHostVpn } from "@rakazo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import { colors, s, vt } from "../theme";

const VPN_READ_TIMEOUT_MS = 5_000;

/**
 * The host Mac's WARP switch. Only the deployment owner gets a status back, and
 * a Mac without warp-cli reports `unavailable`; both hide the row.
 */
export function VesperVpnRow() {
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
    [readStatus, target],
  );

  if (!status || (status.state === "unavailable" && target === null)) return null;

  // WARP can sit in "connecting" on a bad network; keep the switch usable so it can be turned off.
  const busy = target !== null || status.switching;
  const switching = busy || status.state === "connecting";
  const value = target ?? status.state !== "disconnected";

  return (
    <View style={{ gap: 6 }}>
      <View
        style={[
          s.between,
          {
            gap: 12,
            minHeight: vt.size.touchTarget,
            paddingHorizontal: 14,
            borderRadius: vt.radius.card,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.text, { fontWeight: "500" }]}>{t("WARP VPN")}</Text>
          {switching ? <Text style={s.small}>{t("Switching…")}</Text> : null}
        </View>
        <Switch
          accessibilityLabel={t("WARP VPN")}
          disabled={busy}
          value={value}
          onValueChange={(next) => void toggle(next)}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[s.small, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
