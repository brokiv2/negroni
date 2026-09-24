import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { publicTunnelGate } from "./public-tunnel.js";

function testApp(host = "negroni.ngrok-free.dev", key = "device-key") {
  const app = new Hono();
  app.use("*", publicTunnelGate(host, key, ["/connections/callback"]));
  app.post("/rpc/health", (context) => context.json({ ok: true }));
  app.get("/connections/callback", (context) => context.html("<p>ok</p>"));
  app.post("/connections/callback", (context) => context.json({ ok: true }));
  app.get("/connections/callback/extra", (context) => context.json({ ok: true }));
  return app;
}

describe("publicTunnelGate", () => {
  it("rejects requests to the public tunnel without its separate device key", async () => {
    const response = await testApp().request("https://negroni.ngrok-free.dev/rpc/health", {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });

  it("allows requests to the public tunnel with the device key", async () => {
    const response = await testApp().request("https://negroni.ngrok-free.dev/rpc/health", {
      method: "POST",
      headers: { "x-negroni-tunnel-key": "device-key" },
    });
    expect(response.status).toBe(200);
  });

  it("leaves local requests unchanged", async () => {
    const response = await testApp().request("http://127.0.0.1:3100/rpc/health", {
      method: "POST",
    });
    expect(response.status).toBe(200);
  });

  it("uses ngrok's forwarded host when the upstream request URL is local", async () => {
    const response = await testApp().request("http://127.0.0.1:3100/rpc/health", {
      method: "POST",
      headers: { "x-forwarded-host": "negroni.ngrok-free.dev" },
    });
    expect(response.status).toBe(401);
  });

  it("lets browser redirects reach the public callback page without the device key", async () => {
    const response = await testApp().request(
      "https://negroni.ngrok-free.dev/connections/callback?connection=conn-1&status=success",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("device-key");
  });

  it("keeps other methods and nested paths on the callback prefix gated", async () => {
    const post = await testApp().request("https://negroni.ngrok-free.dev/connections/callback", {
      method: "POST",
    });
    const nested = await testApp().request(
      "https://negroni.ngrok-free.dev/connections/callback/extra",
    );
    expect(post.status).toBe(401);
    expect(nested.status).toBe(401);
  });
});
