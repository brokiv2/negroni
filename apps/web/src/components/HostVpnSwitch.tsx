import { Trans, useLingui } from "@lingui/react/macro";
import type { HostVpnStatus } from "@rakazo/contracts";
import { switchHostVpn } from "@rakazo/core";
import { Switch } from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

/**
 * The host Mac's WARP switch for the deployment owner. Hidden when the server
 * refuses the status read or the Mac has no warp-cli.
 */
export function HostVpnSwitch() {
  const { t } = useLingui();
  const id = useId();
  const [status, setStatus] = useState<HostVpnStatus | null>(null);
  const [target, setTarget] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    rpc.computer
      .vpnStatus(undefined, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setStatus(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function toggle(enabled: boolean) {
    const signal = abortRef.current?.signal;
    if (target !== null || !signal) return;
    setTarget(enabled);
    setError(null);
    try {
      const settled = await switchHostVpn({
        enabled,
        setVpn: (value) => rpc.computer.setVpn({ enabled: value }),
        readStatus: () => rpc.computer.vpnStatus(undefined, { signal }),
        onStatus: setStatus,
        signal,
      });
      if (signal.aborted) return;
      if (!settled || settled.state !== (enabled ? "connected" : "disconnected")) {
        setError(t`Could not switch the VPN`);
      }
    } catch (failure) {
      if (!signal.aborted) {
        setError(failure instanceof Error ? failure.message : t`Could not switch the VPN`);
      }
    } finally {
      if (!signal.aborted) setTarget(null);
    }
  }

  if (!status || (status.state === "unavailable" && target === null)) return null;

  // WARP can sit in "connecting" on a bad network; keep the switch usable so it can be turned off.
  const busy = target !== null || status.switching;
  const switching = busy || status.state === "connecting";

  return (
    <div data-testid="host-vpn" className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13.5px] text-foreground">
          <Trans>WARP VPN</Trans>
          {switching ? (
            <span className="ms-2 text-muted-foreground">
              <Trans>Switching…</Trans>
            </span>
          ) : null}
        </label>
        <Switch
          id={id}
          data-testid="host-vpn-toggle"
          checked={target ?? status.state !== "disconnected"}
          disabled={busy}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
