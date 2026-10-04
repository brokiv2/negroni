// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ status: vi.fn(), set: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { computer: { vpnStatus: api.status, setVpn: api.set } } }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
vi.mock("@rakazo/ui-web", () => ({
  Switch: (props: {
    checked: boolean;
    disabled: boolean;
    onCheckedChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onCheckedChange(event.target.checked)}
    />
  ),
}));

import { HostVpnSwitch } from "./HostVpnSwitch";

it("tracks a switch on another device, survives tunnel errors, and stops on unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  api.status
    .mockResolvedValueOnce({ state: "disconnected", switching: false })
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue({ state: "connected", switching: false });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<HostVpnSwitch initialStatus={{ state: "disconnected", switching: false }} />),
    );
    const toggle = () => container.querySelector("input") as HTMLInputElement;
    expect(toggle().checked).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(toggle().checked).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(toggle().checked).toBe(true);
    const signal = api.status.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(api.status).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
