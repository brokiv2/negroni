import type { ConnectorRegistry } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  mobileReturnUrl,
  mountConnectionCallbackRoute,
  publicApiUrl,
  requestOrigin,
  resolveConnectionCallbackUrl,
  settleConnectionFromCallback,
} from "./connection-callback.js";

const origins = {
  apiUrl: "http://127.0.0.1:3100",
  webOrigin: "http://127.0.0.1:5173",
  publicApiUrl: "https://tunnel.example.test",
};

describe("resolveConnectionCallbackUrl", () => {
  it("uses the public origin when the phone reached the API through it", () => {
    expect(
      resolveConnectionCallbackUrl(
        { ...origins, requestOrigin: "https://tunnel.example.test" },
        "conn-1",
      ),
    ).toBe("https://tunnel.example.test/connections/callback?connection=conn-1");
  });

  it("keeps desktop and web callbacks on the loopback API", () => {
    expect(
      resolveConnectionCallbackUrl({ ...origins, requestOrigin: "http://127.0.0.1:3100" }, "c"),
    ).toBe("http://127.0.0.1:3100/connections/callback?connection=c");
    expect(
      resolveConnectionCallbackUrl({ ...origins, requestOrigin: "http://127.0.0.1:5173" }, "c"),
    ).toBe("http://127.0.0.1:3100/connections/callback?connection=c");
    expect(
      resolveConnectionCallbackUrl({ ...origins, requestOrigin: "http://localhost:3100" }, "c"),
    ).toBe("http://localhost:3100/connections/callback?connection=c");
  });

  it("ignores unknown request origins and falls back to the public, then API origin", () => {
    expect(
      resolveConnectionCallbackUrl({ ...origins, requestOrigin: "https://evil.example" }, "c"),
    ).toBe("https://tunnel.example.test/connections/callback?connection=c");
    expect(
      resolveConnectionCallbackUrl(
        { ...origins, publicApiUrl: undefined, requestOrigin: "x" },
        "c",
      ),
    ).toBe("http://127.0.0.1:3100/connections/callback?connection=c");
  });
});

describe("request origin and public API url", () => {
  it("honors the first forwarded proto and host", () => {
    const request = new Request("http://127.0.0.1:3100/rpc/connections/begin", {
      headers: {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "tunnel.example.test, 127.0.0.1",
      },
    });
    expect(requestOrigin(request)).toBe("https://tunnel.example.test");
    expect(requestOrigin(new Request("http://127.0.0.1:3100/rpc"))).toBe("http://127.0.0.1:3100");
  });

  it("prefers PUBLIC_API_URL and derives https from the tunnel host", () => {
    expect(publicApiUrl("https://api.example.test/", "tunnel.example.test")).toBe(
      "https://api.example.test",
    );
    expect(publicApiUrl(undefined, "tunnel.example.test")).toBe("https://tunnel.example.test");
    expect(publicApiUrl(undefined, undefined)).toBeUndefined();
  });
});

function callbackDeps(row: Record<string, unknown> | null, ready = true) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const connectionReady = vi.fn().mockResolvedValue(ready);
  const deps = {
    prisma: {
      connection: { findUnique: vi.fn().mockResolvedValue(row), updateMany },
    } as unknown as Pick<PrismaClient, "connection">,
    connectors: { managed: vi.fn(() => ({ connectionReady })) } as unknown as Pick<
      ConnectorRegistry,
      "managed"
    >,
  };
  return { deps, updateMany, connectionReady };
}

const pendingRow = {
  id: "conn-1",
  connectorId: "composio",
  provider: "gmail",
  providerRef: "ca-1",
  status: "pending",
  spaceId: "space-1",
  userId: "user-1",
};

describe("settleConnectionFromCallback", () => {
  it("marks the row connected once the provider confirms the exact account", async () => {
    const { deps, updateMany, connectionReady } = callbackDeps(pendingRow);
    await expect(settleConnectionFromCallback(deps, "conn-1")).resolves.toBe("connected");
    expect(connectionReady).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-1", userId: "user-1" }),
      "gmail",
      "ca-1",
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "conn-1", status: "pending" },
      data: { status: "connected" },
    });
  });

  it("stays pending when the provider is not ready or the id is malformed", async () => {
    const notReady = callbackDeps(pendingRow, false);
    await expect(settleConnectionFromCallback(notReady.deps, "conn-1")).resolves.toBe("pending");
    expect(notReady.updateMany).not.toHaveBeenCalled();
    const malformed = callbackDeps(pendingRow);
    await expect(settleConnectionFromCallback(malformed.deps, "a b<")).resolves.toBe("pending");
    expect(malformed.deps.prisma.connection.findUnique).not.toHaveBeenCalled();
  });
});

describe("callback page", () => {
  it("serves an HTML page that deep-links back to the app", async () => {
    const { deps } = callbackDeps(pendingRow);
    const app = new Hono();
    mountConnectionCallbackRoute(app, deps);
    const response = await app.request(
      "http://127.0.0.1:3100/connections/callback?connection=conn-1&status=success&connectedAccountId=ca-1",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("negroni://integrations?connection=conn-1&amp;status=connected");
    expect(body).toContain("Return to Negroni");
    expect(body).toContain("window.opener");
  });

  it("escapes nothing unsafe into the deep link for bad ids", () => {
    expect(mobileReturnUrl("<script>", "pending")).toBe("negroni://integrations");
  });
});
