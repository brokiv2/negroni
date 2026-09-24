import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:http2";
import type { NotificationMessage } from "@rakazo/adapter-kit";

export type ApnsEnvironment = "development" | "production";

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  topic: string;
  privateKeyPath: string;
}

export interface ApnsResponse {
  status: number;
  reason?: string;
  apnsId?: string;
}

type CachedProviderToken = { value: string; createdAt: number };

const providerTokens = new Map<string, CachedProviderToken>();

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function apnsConfigFromEnv(source: NodeJS.ProcessEnv): ApnsConfig | undefined {
  const values = {
    keyId: source.APNS_KEY_ID?.trim(),
    teamId: source.APNS_TEAM_ID?.trim(),
    topic: source.APNS_TOPIC?.trim(),
    privateKeyPath: source.APNS_PRIVATE_KEY_PATH?.trim(),
  };
  if (!Object.values(values).some(Boolean)) return undefined;
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Incomplete APNs configuration: missing ${missing.join(", ")}`);
  }
  return values as ApnsConfig;
}

export async function createApnsProviderToken(
  config: ApnsConfig,
  now = Date.now(),
): Promise<string> {
  const cacheKey = `${config.teamId}:${config.keyId}:${config.privateKeyPath}`;
  const cached = providerTokens.get(cacheKey);
  if (cached && now - cached.createdAt < 50 * 60_000) return cached.value;

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1_000) }));
  const signingInput = `${header}.${claims}`;
  const privateKey = createPrivateKey(await readFile(config.privateKeyPath, "utf8"));
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const value = `${signingInput}.${base64Url(signature)}`;
  providerTokens.set(cacheKey, { value, createdAt: now });
  return value;
}

export function apnsPayload(message: NotificationMessage) {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      "thread-id": message.threadId,
    },
    kind: message.kind,
    botId: message.botId,
    threadId: message.threadId,
  };
}

export async function sendApnsNotification(
  config: ApnsConfig,
  token: string,
  environment: ApnsEnvironment,
  message: NotificationMessage,
  signal?: AbortSignal,
): Promise<ApnsResponse> {
  const authorization = await createApnsProviderToken(config);
  const authority =
    environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  const client = connect(authority);

  return await new Promise<ApnsResponse>((resolve, reject) => {
    let settled = false;
    let responseStatus = 0;
    let responseApnsId: string | undefined;
    const chunks: Buffer[] = [];

    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      client.close();
      work();
    };
    const abort = () => {
      client.destroy();
      finish(() => reject(signal?.reason ?? new Error("APNs request aborted")));
    };

    signal?.addEventListener("abort", abort, { once: true });
    client.once("error", (error) => finish(() => reject(error)));

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${authorization}`,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
      "apns-collapse-id": message.threadId.slice(0, 64),
      "content-type": "application/json",
    });
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      responseStatus = Number(headers[":status"] ?? 0);
      const id = headers["apns-id"];
      responseApnsId = Array.isArray(id) ? id[0] : id;
    });
    request.on("data", (chunk: string) => chunks.push(Buffer.from(chunk)));
    request.setTimeout(15_000, () => request.destroy(new Error("APNs request timed out")));
    request.once("error", (error) => finish(() => reject(error)));
    request.once("end", () => {
      let reason: string | undefined;
      const body = Buffer.concat(chunks).toString("utf8");
      if (body) {
        try {
          const parsed = JSON.parse(body) as { reason?: unknown };
          if (typeof parsed.reason === "string") reason = parsed.reason;
        } catch {
          reason = body;
        }
      }
      const response = { status: responseStatus, reason, apnsId: responseApnsId };
      if (responseStatus === 200) {
        finish(() => resolve(response));
      } else {
        finish(() => reject(new ApnsPushError(response)));
      }
    });
    request.end(JSON.stringify(apnsPayload(message)));
  });
}

export class ApnsPushError extends Error {
  readonly status: number;
  readonly reason: string | undefined;
  readonly apnsId: string | undefined;

  constructor(response: ApnsResponse) {
    super(`APNs rejected notification (${response.status}): ${response.reason ?? "unknown error"}`);
    this.name = "ApnsPushError";
    this.status = response.status;
    this.reason = response.reason;
    this.apnsId = response.apnsId;
  }
}

export function isInvalidApnsToken(error: unknown): boolean {
  return (
    error instanceof ApnsPushError &&
    (error.reason === "BadDeviceToken" ||
      error.reason === "DeviceTokenNotForTopic" ||
      error.reason === "Unregistered")
  );
}
