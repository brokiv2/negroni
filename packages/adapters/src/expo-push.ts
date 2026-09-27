import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import {
  type ApnsConfig,
  type ApnsEnvironment,
  isInvalidApnsToken,
  sendApnsNotification,
} from "./apns-push.js";
import { combineSignals } from "./connector-safety.js";
import { readBodyCapped, withAbort } from "./web-ssrf.js";

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const EXPO_PUSH_TIMEOUT_MS = 15_000;
export const MAX_EXPO_PUSH_RESPONSE_BYTES = 64 * 1024;

export type PushRegistration =
  | { provider: "expo"; token: string; updatedAt: string }
  | { provider: "apns"; token: string; environment: ApnsEnvironment; updatedAt: string };

type PushProviderOptions = {
  apns?: ApnsConfig;
  sendApns?: typeof sendApnsNotification;
};

export function pushTokenPath(dataDir: string, userId: string) {
  return path.join(dataDir, "push-tokens", `${userId}.txt`);
}

export function pushRegistrationsPath(dataDir: string, userId: string) {
  return path.join(dataDir, "push-tokens", `${userId}.json`);
}

export async function loadPushRegistrations(
  dataDir: string,
  userId: string,
): Promise<PushRegistration[]> {
  try {
    const parsed = JSON.parse(await readRegistrationsFile(dataDir, userId));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PushRegistration => {
      if (!item || typeof item !== "object" || typeof item.token !== "string") return false;
      if (item.provider === "expo") return true;
      return (
        item.provider === "apns" &&
        (item.environment === "development" || item.environment === "production")
      );
    });
  } catch {
    const legacy = await loadLegacyPushToken(dataDir, userId);
    return legacy
      ? [{ provider: "expo", token: legacy, updatedAt: new Date(0).toISOString() }]
      : [];
  }
}

/** O_NOFOLLOW so a planted symlink in the data dir cannot redirect the read. */
async function readRegistrationsFile(dataDir: string, userId: string): Promise<string> {
  const handle = await open(
    pushRegistrationsPath(dataDir, userId),
    constants.O_RDONLY | O_NOFOLLOW,
  );
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function loadLegacyPushToken(dataDir: string, userId: string) {
  try {
    const handle = await open(pushTokenPath(dataDir, userId), constants.O_RDONLY | O_NOFOLLOW);
    try {
      const token = (await handle.readFile("utf8")).trim();
      return token || undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

export async function loadPushToken(dataDir: string, userId: string): Promise<string | undefined> {
  return (await loadPushRegistrations(dataDir, userId)).at(-1)?.token;
}

export async function savePushToken(dataDir: string, userId: string, token: string): Promise<void> {
  await savePushRegistration(dataDir, userId, { provider: "expo", token });
}

export async function savePushRegistration(
  dataDir: string,
  userId: string,
  registration:
    | { provider: "expo"; token: string }
    | { provider: "apns"; token: string; environment: ApnsEnvironment },
): Promise<void> {
  const token = registration.token.trim();
  if (!token) throw new Error("Push token is empty");
  const existing = await loadPushRegistrations(dataDir, userId);
  const next = [
    ...existing.filter(
      (item) => !(item.provider === registration.provider && item.token === token),
    ),
    { ...registration, token, updatedAt: new Date().toISOString() },
  ].slice(-8) as PushRegistration[];
  await writePushRegistrations(dataDir, userId, next);
  await unlink(pushTokenPath(dataDir, userId)).catch(() => undefined);
}

async function writePushRegistrations(
  dataDir: string,
  userId: string,
  registrations: PushRegistration[],
): Promise<void> {
  const target = pushRegistrationsPath(dataDir, userId);
  await mkdir(path.dirname(target), { recursive: true });
  // rename() replaces a symlink rather than following it, so refuse outright:
  // a planted link means the store was tampered with, not that it moved.
  const existing = await lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error("Push registration path is a symlink");
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  // O_NOFOLLOW + 0600 so a planted symlink in the data dir cannot redirect the write.
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(registrations, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

export async function deletePushRegistration(
  dataDir: string,
  userId: string,
  token: string,
): Promise<void> {
  const existing = await loadPushRegistrations(dataDir, userId);
  const next = existing.filter((item) => item.token !== token);
  if (next.length === existing.length) return;
  if (next.length === 0) {
    await unlink(pushRegistrationsPath(dataDir, userId)).catch(() => undefined);
    return;
  }
  await writePushRegistrations(dataDir, userId, next);
}

export async function deletePushToken(dataDir: string, userId: string): Promise<void> {
  await Promise.all(
    [pushTokenPath(dataDir, userId), pushRegistrationsPath(dataDir, userId)].map((target) =>
      unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }),
    ),
  );
}

export type ExpoPushTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

export function expoPushTickets(body: unknown): ExpoPushTicket[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) {
    return data.filter((item): item is ExpoPushTicket => Boolean(item) && typeof item === "object");
  }
  if (data && typeof data === "object") return [data as ExpoPushTicket];
  return [];
}

export function expoPushErrorMessage(body: unknown, status: number): string | undefined {
  if (body && typeof body === "object" && "errors" in body) {
    const errors = (body as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((error) => error.message ?? "expo push error").join("; ");
    }
  }
  const failed = expoPushTickets(body).filter((ticket) => ticket.status === "error");
  if (failed.length > 0) {
    return failed
      .map((ticket) => ticket.message ?? ticket.details?.error ?? "expo push ticket error")
      .join("; ");
  }
  if (status < 200 || status >= 300) return `expo push failed (${status})`;
  return undefined;
}

export class ExpoPushProvider implements NotificationProvider {
  private readonly sendApns: typeof sendApnsNotification;

  constructor(
    private readonly dataDir: string,
    private readonly options: PushProviderOptions = {},
  ) {
    this.sendApns = options.sendApns ?? sendApnsNotification;
  }

  describe() {
    return {
      id: "push",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { push: true, email: false },
    };
  }

  async send(message: NotificationMessage, context: AdapterContext): Promise<void> {
    const registrations = await loadPushRegistrations(this.dataDir, context.userId);
    if (registrations.length === 0) return;
    const results = await Promise.allSettled(
      registrations.map((registration) =>
        registration.provider === "apns"
          ? this.sendToApns(registration, message, context)
          : this.sendToExpo(registration.token, message, context),
      ),
    );
    if (results.some((result) => result.status === "fulfilled")) return;
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw failed?.reason ?? new Error("Push notification delivery failed");
  }

  private async sendToApns(
    registration: Extract<PushRegistration, { provider: "apns" }>,
    message: NotificationMessage,
    context: AdapterContext,
  ) {
    if (!this.options.apns) {
      throw new Error("APNs is not configured on this server");
    }
    try {
      await this.sendApns(
        this.options.apns,
        registration.token,
        registration.environment,
        message,
        context.signal,
      );
    } catch (error) {
      if (isInvalidApnsToken(error)) {
        await deletePushRegistration(this.dataDir, context.userId, registration.token);
      }
      throw error;
    }
  }

  private async sendToExpo(
    token: string,
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<void> {
    const signal = combineSignals(context.signal, AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS));
    let response: Response;
    try {
      response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          to: token,
          title: message.title,
          body: message.body,
          collapseId: message.threadId,
          tag: message.threadId,
          data: { kind: message.kind, botId: message.botId, threadId: message.threadId },
        }),
        signal,
      });
    } catch (error) {
      getLogger().error("expo push request failed", error);
      throw error;
    }
    const body = await readExpoPushBody(response, signal);
    if (response.ok && body === undefined) {
      throw new Error("Expo push returned an invalid response.");
    }
    const failure = expoPushErrorMessage(body, response.status);
    if (!failure) return;
    getLogger().error(failure);
    throw new Error(failure);
  }
}

async function readExpoPushBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_EXPO_PUSH_RESPONSE_BYTES) {
    const cancel = response.body?.cancel() ?? Promise.resolve();
    await withAbort(
      cancel.catch(() => undefined),
      signal,
    ).catch(() => undefined);
    throw new Error("Expo push response is too large.");
  }
  try {
    const bytes = await readBodyCapped(response, MAX_EXPO_PUSH_RESPONSE_BYTES, signal);
    if (bytes.byteLength === 0) return undefined;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === "Response is too large") {
      throw new Error("Expo push response is too large.");
    }
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
