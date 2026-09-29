import { t } from "../i18n";

/**
 * The Apps section.
 *
 * Vesper does not show all of Negroni. Per the port spec's settled answer to
 * Q4, six Negroni surfaces appear here plus the switch back to the full
 * workspace; the team-shaped and operator-shaped surfaces stay hidden, and a
 * person who needs them opens Negroni.
 *
 * Where Negroni already has a screen, the row routes to it rather than
 * rebuilding it. Those screens keep Negroni's own chrome on purpose — restyling
 * them would fork surfaces this shell does not own.
 */

export const VESPER_APP_ROWS = [
  "context",
  "connectors",
  "models",
  "voice",
  "approvals",
  "account",
  "negroni",
] as const;

export type VesperAppRow = (typeof VESPER_APP_ROWS)[number];

/**
 * Negroni surfaces Vesper deliberately does not show. Named so the decision is
 * reviewable rather than implicit in what happens to be missing.
 */
export const VESPER_HIDDEN_SURFACES = [
  "spaces",
  "bots",
  "groups",
  "skills",
  "mcp",
  "messaging",
  "usage",
  "deployment",
] as const;

export type VesperHiddenSurface = (typeof VESPER_HIDDEN_SURFACES)[number];

/**
 * Where a row goes. `null` means Vesper renders it itself inside the shell
 * rather than handing over to a Negroni screen.
 */
export function vesperAppRoute(row: VesperAppRow): string | null {
  switch (row) {
    case "context":
      return "/(vesper)/personal-context";
    case "approvals":
      return "/(vesper)/approvals";
    case "connectors":
      return "/integrations";
    case "models":
      return "/models";
    case "voice":
      return "/voice";
    case "account":
      return "/account";
    case "negroni":
      return null;
  }
}

/** True when the row hands over to a screen Vesper does not own. */
export function leavesVesper(row: VesperAppRow): boolean {
  const route = vesperAppRoute(row);
  return !!route && !route.startsWith("/(vesper)");
}

export type VesperAppRowCopy = { title: string; detail: string };

export function vesperAppRowCopy(row: VesperAppRow): VesperAppRowCopy {
  switch (row) {
    case "context":
      return {
        title: t("Personality and memory"),
        detail: t("Name, tone, avatar, and everything your assistant remembers."),
      };
    case "connectors":
      return {
        title: t("Connections"),
        detail: t("The apps and accounts your assistant is allowed to reach."),
      };
    case "models":
      return { title: t("Models"), detail: t("Which model answers, and the keys behind it.") };
    case "voice":
      return {
        title: t("Voice"),
        detail: t("How your assistant sounds, and whether it speaks first."),
      };
    case "approvals":
      return {
        title: t("Approval rules"),
        detail: t("What your assistant may do on its own, and what it must ask about."),
      };
    case "account":
      return { title: t("Account"), detail: t("Sign-in, password and this device.") };
    case "negroni":
      return {
        title: t("Team workspace"),
        detail: t("The full workspace: spaces, bots, groups and settings."),
      };
  }
}

/** Search over the visible rows. Matching is on the copy a person can actually read. */
export function filterAppRows(
  rows: readonly VesperAppRow[],
  query: string,
): readonly VesperAppRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    const copy = vesperAppRowCopy(row);
    return `${copy.title} ${copy.detail}`.toLowerCase().includes(needle);
  });
}
