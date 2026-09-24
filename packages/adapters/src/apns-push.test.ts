import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apnsConfigFromEnv, apnsPayload, createApnsProviderToken } from "./apns-push.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("APNs push", () => {
  it("requires a complete provider configuration", () => {
    expect(apnsConfigFromEnv({})).toBeUndefined();
    expect(() => apnsConfigFromEnv({ APNS_KEY_ID: "KEY1234567" })).toThrow(
      /Incomplete APNs configuration/,
    );
    expect(
      apnsConfigFromEnv({
        APNS_KEY_ID: "KEY1234567",
        APNS_TEAM_ID: "TEAM123456",
        APNS_TOPIC: "com.example.app",
        APNS_PRIVATE_KEY_PATH: "/private/key.p8",
      }),
    ).toEqual({
      keyId: "KEY1234567",
      teamId: "TEAM123456",
      topic: "com.example.app",
      privateKeyPath: "/private/key.p8",
    });
  });

  it("creates and caches an ES256 provider token", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rakazo-apns-"));
    dirs.push(dataDir);
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const privateKeyPath = path.join(dataDir, "AuthKey_TEST.p8");
    await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const config = {
      keyId: "KEY1234567",
      teamId: "TEAM123456",
      topic: "com.example.app",
      privateKeyPath,
    };

    const token = await createApnsProviderToken(config, 1_800_000_000_000);
    expect(await createApnsProviderToken(config, 1_800_000_001_000)).toBe(token);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      iss: "TEAM123456",
      iat: 1_800_000_000,
    });
    expect(Buffer.from(signature!, "base64url")).toHaveLength(64);
  });

  it("builds an alert payload with a routable thread", () => {
    expect(
      apnsPayload({
        kind: "help",
        title: "Needs input",
        body: "Please choose an option",
        botId: "bot-1",
        threadId: "thread-1",
      }),
    ).toMatchObject({
      aps: {
        alert: { title: "Needs input", body: "Please choose an option" },
        sound: "default",
        "thread-id": "thread-1",
      },
      kind: "help",
      botId: "bot-1",
      threadId: "thread-1",
    });
  });
});
