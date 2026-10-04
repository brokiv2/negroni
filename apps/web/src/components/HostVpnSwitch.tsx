import { Trans, useLingui } from "@lingui/react/macro";
import type { HostVpnStatus } from "@rakazo/contracts";
import { switchHostVpn, vpnSettled } from "@rakazo/core";
import { Switch } from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

/** The host Mac's WARP switch for the deployment owner. Hidden once WARP reports unavailable. */
export function HostVpnSwitch({ initialStatus }: { initialStatus: HostVpnStatus }) {
  const { t } = useLingui();
  const id = useId();
  const [status, setStatus] = useState<HostVpnStatus>(initialStatus);
  const [target, setTarget] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (target !== null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await rpc.computer.vpnStatus(undefined, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(next);
        if (vpnSettled(next, null)) setError(null);
      } catch {
        // Keep the last known state while the host tunnel reconnects.
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3_000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [target]);

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
      if (!settled || !vpnSettled(settled, enabled)) {
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

  if (status.state === "unavailable" && target === null) return null;

  // WARP can sit in "connecting" on a bad network; keep the switch usable so it can be turned off.
  const busy = target !== null || status.switching;
  const switching = busy || status.state === "connecting";

  return (
    <div data-testid="host-vpn" className="mt-3">
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
