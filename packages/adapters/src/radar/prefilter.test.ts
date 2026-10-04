import type { RadarRule } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { ScreenedSignal } from "./prefilter.js";
import { matchRules, prefilter } from "./prefilter.js";
import { backoffUntil, senderShift, thresholdOffset } from "./priors.js";

const now = new Date("2026-10-05T10:00:00Z");
const mail = (patch: Partial<ScreenedSignal> = {}): ScreenedSignal => ({
  source: "gmail",
  kind: "email",
  title: "Budget review",
  excerpt: "Could you send the figures before the review?",
  actor: { name: "A colleague", address: "colleague@example.test" },
  meta: {},
  occurredAt: now,
  ...patch,
});
const none = { never: [], digest: [], always: [] };
const screen = (signal: ScreenedSignal, extra: Partial<Parameters<typeof prefilter>[1]> = {}) =>
  prefilter(signal, {
    ownerAddresses: ["me@example.test"],
    rules: none,
    people: [],
    now,
    ...extra,
  });
const rule = (kind: RadarRule["kind"], match: RadarRule["match"]): RadarRule => ({
  id: `${kind}-${JSON.stringify(match)}`,
  kind,
  match,
  origin: "explicit",
  createdAt: now.toISOString(),
});

describe("rules", () => {
  it("matches every named condition: sender, domain and subdomains, topic, source", () => {
    const rules = [
      rule("never", { sender: "colleague@example.test" }),
      rule("digest", { domain: "example.test" }),
      rule("always", { topic: "BUDGET review", source: "gmail" }),
      rule("never", { topic: "budget", source: "slack" }),
    ];
    expect(matchRules(rules, mail())).toEqual({
      never: [rules[0]!.id],
      digest: [rules[1]!.id],
      always: [rules[2]!.id],
    });
    expect(
      matchRules(
        [rule("digest", { domain: "example.test" })],
        mail({ actor: { address: "a@mail.example.test" } }),
      ).digest,
    ).toHaveLength(1);
    expect(
      matchRules(
        [rule("digest", { domain: "example.test" })],
        mail({ actor: { address: "a@notexample.test" } }),
      ).digest,
    ).toHaveLength(0);
  });
});

describe("prefilter", () => {
  it("lets ordinary direct mail through to the judge", () => {
    expect(screen(mail())).toBeUndefined();
  });

  it("keeps the owner's own mail silent and lets it close the thread", () => {
    expect(screen(mail({ kind: "email_sent" }))).toMatchObject({ gate: "own", closesThread: true });
    expect(screen(mail({ actor: { address: "me@example.test" } }))).toMatchObject({ gate: "own" });
  });

  it.each([
    "Your verification code is 482913",
    "Use this one-time code to sign in",
    "Reset your password",
    "Magic link for your account",
    "Ваш код подтверждения: 1234",
    "Одноразовый пароль для входа",
    "Ihr Bestätigungscode",
  ])("never judges sign-in and security codes: %s", (title) => {
    expect(screen(mail({ title, excerpt: "" }))).toMatchObject({ gate: "security_code" });
  });

  it("lets account security alerts reach the judge even from automated senders", () => {
    const alert = (title: string, excerpt = "If this wasn't you, reset your password.") =>
      mail({
        title,
        excerpt,
        actor: { address: "security@mail.service.example.test" },
        meta: { bulk: true },
      });
    for (const title of [
      "New login to your account from Chrome on Linux",
      "Security alert: new trusted device added to your account",
      "Suspicious sign-in attempt blocked",
      "Your password was changed",
      "Новый вход в аккаунт с незнакомого устройства",
      "Neue Anmeldung bei Ihrem Konto",
    ])
      expect(screen(alert(title)), title).toBeUndefined();
    // A code the owner asked for, or a plain newsletter, stays screened out.
    expect(screen(alert("Your verification code", "482913"))).toMatchObject({
      gate: "security_code",
    });
    expect(screen(alert("Security tips for your team", "Read our blog."))).toMatchObject({
      gate: "bulk",
    });
  });

  it("drops bulk mail unless the sender matters", () => {
    const newsletter = mail({
      title: "Sale ends in 2 hours!",
      excerpt: "Hurry, only 2 hours left to save 50%.",
      actor: { address: "news@shop.example.test" },
      meta: { bulk: true },
    });
    expect(screen(newsletter)).toMatchObject({ gate: "bulk" });
    expect(
      screen(newsletter, {
        people: [
          {
            name: "Shop",
            addresses: ["news@shop.example.test"],
            relation: "",
            weight: 1,
            origin: "learned",
          },
        ],
      }),
    ).toBeUndefined();
    expect(screen(newsletter, { rules: { never: [], digest: [], always: ["r"] } })).toBeUndefined();
  });

  it("silences muted senders, declined events, far events, backoff and duplicates", () => {
    expect(screen(mail(), { rules: { never: ["r"], digest: [], always: [] } })).toMatchObject({
      gate: "rule_never",
    });
    expect(screen(mail({ kind: "event_changed", meta: { response: "declined" } }))).toMatchObject({
      gate: "declined",
    });
    expect(
      screen(mail({ kind: "event_changed", deadline: new Date("2026-10-09T10:00:00Z") })),
    ).toMatchObject({ gate: "calendar_window" });
    expect(
      screen(mail({ kind: "event_cancelled", deadline: new Date("2026-10-05T09:00:00Z") })),
    ).toMatchObject({
      gate: "calendar_window",
    });
    expect(screen(mail(), { backoffUntil: new Date("2026-10-06T10:00:00Z") })).toMatchObject({
      gate: "backoff",
    });
    expect(screen(mail(), { backoffUntil: new Date("2026-10-05T09:00:00Z") })).toBeUndefined();
    expect(screen(mail(), { duplicate: true })).toMatchObject({ gate: "duplicate" });
  });
});

describe("threshold learning", () => {
  const day = 86_400_000;
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day);

  it("raises the owner's threshold after declined interrupts and fades it over two weeks", () => {
    const declined = [1, 2, 3].map((d) => ({
      feedback: "not_important",
      at: at(d),
      disposition: "interrupt",
    }));
    expect(thresholdOffset(declined, now)).toBe(4.6);
    expect(thresholdOffset(declined.slice(0, 2), now)).toBe(0);
    expect(
      thresholdOffset(
        declined.map((e) => ({ ...e, at: new Date(e.at.getTime() - 14 * day) })),
        now,
      ),
    ).toBe(0);
    // Declines on briefs do not count toward interrupt precision.
    expect(
      thresholdOffset(
        declined.map((e) => ({ ...e, disposition: "brief" })),
        now,
      ),
    ).toBe(0);
  });

  it("lowers it after two requests to be told sooner within a week", () => {
    const sooner = [0, 3].map((d) => ({ feedback: "important", at: at(d), disposition: "brief" }));
    expect(thresholdOffset(sooner, now)).toBe(-3);
    expect(thresholdOffset([sooner[0]!, { ...sooner[1]!, at: at(9) }], now)).toBe(0);
  });

  it("bounds a sender's shift and backs off a declined story", () => {
    expect(senderShift({ important: 0, notImportant: 2 })).toBe(10);
    expect(senderShift({ important: 3, notImportant: 0 })).toBe(-10);
    expect(senderShift({ important: 1, notImportant: 1 })).toBe(0);
    expect(backoffUntil([])).toBeUndefined();
    expect(backoffUntil([at(0)])?.toISOString()).toBe("2026-10-06T10:00:00.000Z");
    expect(backoffUntil([at(0), at(2)])?.toISOString()).toBe("2026-10-12T10:00:00.000Z");
    expect(backoffUntil([at(0), at(2), at(3), at(4)])?.toISOString()).toBe(
      "2026-11-04T10:00:00.000Z",
    );
  });
});
