import { createHash } from "node:crypto";
import {
  addressList,
  asArray,
  asRecord,
  asString,
  clip,
  normalizeAddress,
  parseMailbox,
  plainText,
  providerData,
  validDate,
} from "./envelope.js";
import type { ObservedSignal, RadarObserver } from "./types.js";

/** Messages read per check; the rest is counted, not silently dropped. */
const CAP = 50;
/** Full bodies are read only for mail addressed to the owner, and only this many. */
const BODY_CAP = 15;
/** The marker may start the address or follow a separator: "noreply@", "builds_no_reply@". */
const NO_REPLY =
  /^(?:[^@]*[-_.+])?(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|bounces?|postmaster)[^@]*@/i;

const headerMap = (payload: unknown) =>
  new Map(
    asArray(asRecord(payload).headers).map((header) => [
      asString(header.name).toLowerCase(),
      asString(header.value),
    ]),
  );

/** Subject and body with forwarding and quoting stripped, so a forwarded copy matches. */
export function duplicateKey(subject: string, text: string): string {
  const cleanSubject = subject
    .replace(/^(?:\s*(?:re|fwd?|fw|aw|wg|sv|tr|отв|пересл)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
  const body = text
    .split("\n")
    .filter(
      (line) =>
        !/^\s*>/.test(line) &&
        !/^-{2,}\s*(?:forwarded|original) message/i.test(line) &&
        !/^\s*(?:from|sent|date|to|cc|subject|от|кому|тема|дата)\s*:/i.test(line),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 300);
  return createHash("sha256").update(`${cleanSubject}\n${body}`).digest("hex").slice(0, 32);
}

function mailUrl(owner: string | undefined, threadId: string) {
  const account = owner ? `?authuser=${encodeURIComponent(owner)}` : "";
  return `https://mail.google.com/mail/${account}#all/${encodeURIComponent(threadId)}`;
}

export const gmailObserver: RadarObserver = {
  cadenceMinutes: 10,

  async observe({ call, cursor, now, since, ownerAddresses }) {
    let owner = normalizeAddress(cursor.ownerAddress);
    if (!owner) {
      const profile = providerData(
        await call("GMAIL_GET_PROFILE", { user_id: "me" }),
        "emailAddress",
      );
      owner = normalizeAddress(profile.emailAddress);
    }
    const mine = new Set([...ownerAddresses, ...(owner ? [owner] : [])]);
    const after =
      typeof cursor.after === "number" ? cursor.after : Math.floor(since.getTime() / 1000);
    const listed = providerData(
      await call("GMAIL_FETCH_EMAILS", {
        user_id: "me",
        // Gmail's own bulk categories never reach the judge; sent mail stays so an owner
        // reply can close the update it answers.
        query: `after:${after} -in:spam -in:trash -in:drafts -category:promotions -category:social -category:forums`,
        max_results: CAP,
        include_payload: false,
        verbose: false,
      }),
      "messages",
    );
    const messages = asArray(listed.messages).slice(0, CAP);
    const estimate = Number(listed.resultSizeEstimate) || 0;
    const overflow = asString(listed.nextPageToken) ? Math.max(estimate - messages.length, 1) : 0;
    let bodies = 0;
    const signals: ObservedSignal[] = [];
    for (const message of messages) {
      const id = asString(message.messageId ?? message.id);
      const threadId = asString(message.threadId) || id;
      if (!/^[\w-]{1,200}$/.test(id)) continue;
      const labels = Array.isArray(message.labelIds) ? message.labelIds.map(asString) : [];
      const sender = parseMailbox(message.sender ?? message.from);
      const to = addressList(message.to);
      const sent = labels.includes("SENT") || Boolean(sender?.address && mine.has(sender.address));
      const direct = to.some((address) => mine.has(address));
      const subject = clip(asString(message.subject) || "(no subject)", 300);
      const preview = asRecord(message.preview);
      let text = plainText(
        asString(preview.body) || asString(message.snippet) || asString(message.messageText),
      );
      let headers = headerMap(message.payload);
      const noReply = Boolean(sender?.address && NO_REPLY.test(sender.address));
      if (direct && !sent && !noReply && bodies < BODY_CAP) {
        bodies += 1;
        try {
          const full = providerData(
            await call("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
              message_id: id,
              user_id: "me",
              format: "full",
            }),
            "messageId",
          );
          text = plainText(asString(full.messageText)) || text;
          headers = headerMap(full.payload);
        } catch {
          // The preview is still a usable excerpt.
        }
      }
      const listUnsubscribe = headers.has("list-unsubscribe") || headers.has("list-id");
      const precedence = (headers.get("precedence") ?? "").toLowerCase();
      const autoSubmitted = (headers.get("auto-submitted") ?? "no").toLowerCase() !== "no";
      signals.push({
        externalId: id,
        threadKey: threadId,
        storyKey: `gmail:${threadId}`,
        kind: sent ? "email_sent" : "email",
        occurredAt: validDate(message.messageTimestamp ?? message.internalDate) ?? now,
        ...(sender ? { actor: sender } : {}),
        direct,
        unread: labels.includes("UNREAD"),
        title: subject,
        excerpt: clip(text, 2000),
        url: mailUrl(owner, threadId),
        meta: {
          labels: labels.slice(0, 20),
          to: to.slice(0, 20),
          cc: addressList(headers.get("cc") ?? message.cc).slice(0, 20),
          bulk:
            listUnsubscribe ||
            noReply ||
            autoSubmitted ||
            ["bulk", "list", "junk"].includes(precedence),
          noReply,
          ...(owner ? { owner } : {}),
          dupKey: duplicateKey(subject, text),
        },
        version: `${subject}\n${text.slice(0, 2000)}`,
      });
    }
    return {
      signals,
      // Overlap two minutes: identity makes a repeated message a no-op.
      cursor: {
        ...(owner ? { ownerAddress: owner } : {}),
        after: Math.floor(now.getTime() / 1000) - 120,
      },
      overflow,
      ...(owner ? { ownerAddress: owner } : {}),
    };
  },

  async reread({ call, externalId, threadKey, occurredAt, ownerAddresses }) {
    const thread = providerData(
      await call("GMAIL_FETCH_MESSAGE_BY_THREAD_ID", { thread_id: threadKey, user_id: "me" }),
      "messages",
    );
    const messages = asArray(thread.messages);
    if (!messages.length) return "gone";
    const mine = new Set(ownerAddresses);
    const replied = messages.some((message) => {
      const labels = Array.isArray(message.labelIds) ? message.labelIds.map(asString) : [];
      const from = parseMailbox(message.sender ?? message.from)?.address;
      const at = validDate(message.messageTimestamp ?? message.internalDate);
      return (
        (labels.includes("SENT") || Boolean(from && mine.has(from))) &&
        (!at || at.getTime() > occurredAt.getTime())
      );
    });
    if (replied) return "handled";
    const self = messages.find(
      (message) => asString(message.messageId ?? message.id) === externalId,
    );
    if (!self) return "gone";
    const labels = Array.isArray(self.labelIds) ? self.labelIds.map(asString) : [];
    return labels.includes("UNREAD") ? "keep" : "opened";
  },
};
