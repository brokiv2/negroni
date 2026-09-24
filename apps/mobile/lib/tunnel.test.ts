import { afterEach, describe, expect, it, vi } from "vitest";
import { tunnelHeaders } from "./tunnel.js";

afterEach(() => vi.unstubAllEnvs());

describe("tunnelHeaders", () => {
  it("omits the private tunnel gate when no build-time key is configured", () => {
    vi.stubEnv("EXPO_PUBLIC_TUNNEL_KEY", "");
    expect(tunnelHeaders()).toEqual({});
  });

  it("adds the private tunnel gate without changing session authorization", () => {
    vi.stubEnv("EXPO_PUBLIC_TUNNEL_KEY", "private-device-key");
    expect(tunnelHeaders()).toEqual({
      "x-negroni-tunnel-key": "private-device-key",
    });
  });
});
