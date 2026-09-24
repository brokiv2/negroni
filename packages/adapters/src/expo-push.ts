import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import {
  type ApnsConfig,
  type ApnsEnvironment,
  isInvalidApnsToken,
  sendApnsNotification,
} from "./apns-push.js";

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
    const parsed = JSON.parse(await readFile(pushRegistrationsPath(dataDir, userId), "utf8"));
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

async function loadLegacyPushToken(dataDir: string, userId: string) {
  try {
    const token = (await readFile(pushTokenPath(dataDir, userId), "utf8")).trim();
    return token || undefined;
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
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registrations, null, 2)}\n`, "utf8");
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
          : this.sendToExpo(registration.token, message),
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

  private async sendToExpo(token: string, message: NotificationMessage): Promise<void> {
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
      });
    } catch (error) {
      console.error("expo push request failed", error);
      throw error;
    }
    const body = await response.json().catch(() => undefined);
    const failure = expoPushErrorMessage(body, response.status);
    if (!failure) return;
    console.error(failure);
    throw new Error(failure);
  }
}
