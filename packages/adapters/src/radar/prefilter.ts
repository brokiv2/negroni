import type { RadarPerson, RadarRule } from "@rakazo/contracts";
import { topicKey } from "../feed-profile.js";
import type { RadarActorValue } from "./observers/types.js";

/** The parts of a signal rules and the prefilter look at. */
export type ScreenedSignal = {
  source: string;
  kind: string;
  title: string;
  excerpt: string;
  actor?: RadarActorValue | null;
  meta?: Record<string, unknown> | null;
  occurredAt: Date;
  deadline?: Date | null;
};

export type RuleHits = { never: string[]; digest: string[]; always: string[] };

const domainOf = (address: string | undefined) => address?.split("@")[1]?.toLowerCase();

/** Every condition a rule names must hold; a rule names at least one. */
export function ruleMatches(rule: RadarRule, signal: ScreenedSignal): boolean {
  const address = signal.actor?.address?.toLowerCase();
  const { sender, domain, topic, source } = rule.match;
  if (sender && sender !== address && sender !== signal.actor?.name?.trim().toLowerCase())
    return false;
  if (domain) {
    const actual = domainOf(address);
    if (!actual || (actual !== domain && !actual.endsWith(`.${domain}`))) return false;
  }
  if (topic && !topicKey(`${signal.title}\n${signal.excerpt}`).includes(topicKey(topic)))
    return false;
  if (source && source !== signal.source.toLowerCase()) return false;
  return true;
}

export function matchRules(rules: RadarRule[], signal: ScreenedSignal): RuleHits {
  const hits: RuleHits = { never: [], digest: [], always: [] };
  for (const rule of rules) if (ruleMatches(rule, signal)) hits[rule.kind].push(rule.id);
  return hits;
}

const SECURITY_CODE =
  /\b(?:one[- ]time (?:pass(?:code|word)|code)|verification code|security code|confirmation code|log ?in code|sign[- ]in (?:code|link)|magic link|2fa|two[- ]factor code|passcode|otp|reset (?:your )?password|password reset|verify your (?:email|sign[- ]in))\b|код (?:подтверждения|для входа|доступа|верификации)|одноразов[а-яё]* (?:код|пароль)|сброс[а-яё]* парол|ссылк[а-яё]* для входа|bestätigungscode|code de vérification|código de verificación/i;

/**
 * An account security event (a new sign-in or device, suspicious activity, a changed
 * password). Unlike a code the owner asked for, it may need them, so it reaches the judge
 * even from an automated sender; the judge's phishing rule still applies.
 */
const SECURITY_ALERT =
  /\b(?:new (?:sign[- ]?in|log[- ]?in|device)|(?:suspicious|unusual|unrecognized|unknown) (?:activity|sign[- ]?in|log[- ]?in|device)|security (?:alert|warning|notice)|sign[- ]?in attempt|password (?:was |has been )?changed|account (?:was |has been )?(?:locked|suspended|compromised|disabled)|(?:2fa|two[- ]factor)[a-z ]* (?:disabled|turned off))\b|нов(?:ый|ого) вход|вход в (?:аккаунт|учётн|учетн)|подозрительн|необычн[а-яё]* (?:активност|вход)|оповещени[а-яё]* (?:о |системы )?безопасност|пароль (?:был )?измен[её]н|аккаунт (?:был )?(?:заблокирован|взломан)|neue anmeldung|sicherheitswarnung|verdächtig|nouvelle connexion|alerte de sécurité|activité suspecte|nuevo inicio de sesión|alerta de seguridad|actividad sospechosa/i;

export type PrefilterVerdict = { reason: string; gate: string; closesThread?: boolean };

/**
 * Deterministic screening before any model call. Returns why a signal stays silent, or
 * nothing when it should be judged.
 */
export function prefilter(
  signal: ScreenedSignal,
  context: {
    ownerAddresses: string[];
    rules: RuleHits;
    people: RadarPerson[];
    /** The story is inside a "not important" backoff window until then. */
    backoffUntil?: Date;
    /** Another update with the same content was already seen. */
    duplicate?: boolean;
    now: Date;
  },
): PrefilterVerdict | undefined {
  const address = signal.actor?.address?.toLowerCase();
  if (signal.kind === "email_sent" || (address && context.ownerAddresses.includes(address)))
    return { reason: "You sent this.", gate: "own", closesThread: true };
  const alert = SECURITY_ALERT.test(signal.title) && !SECURITY_CODE.test(signal.title);
  if (!alert && SECURITY_CODE.test(`${signal.title}\n${signal.excerpt}`))
    return { reason: "Sign-in or security code.", gate: "security_code" };
  if (context.rules.never.length) return { reason: "Muted by your rule.", gate: "rule_never" };
  const known =
    context.rules.always.length > 0 ||
    context.rules.digest.length > 0 ||
    Boolean(address && context.people.some((person) => person.addresses.includes(address)));
  if (signal.meta?.bulk === true && !known && !alert)
    return { reason: "Mailing list or automated mail.", gate: "bulk" };
  if (signal.meta?.response === "declined")
    return { reason: "You declined this event.", gate: "declined" };
  const start = signal.deadline ?? undefined;
  if (
    ["invite", "event_changed", "event_cancelled"].includes(signal.kind) &&
    start &&
    (start.getTime() > context.now.getTime() + 48 * 3_600_000 ||
      start.getTime() < context.now.getTime())
  )
    return { reason: "Outside the next two days.", gate: "calendar_window" };
  if (context.backoffUntil && context.backoffUntil.getTime() > context.now.getTime())
    return { reason: "You said this wasn't important.", gate: "backoff" };
  if (context.duplicate) return { reason: "Same as an earlier update.", gate: "duplicate" };
  return undefined;
}
