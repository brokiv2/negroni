import { t } from "../i18n";

/** The five destinations in the floating bottom nav, in order. */
export const VESPER_SECTIONS = ["chat", "activity", "ideas", "goals", "apps"] as const;

export type VesperSection = (typeof VESPER_SECTIONS)[number];

export const DEFAULT_VESPER_SECTION: VesperSection = "chat";

export function isVesperSection(value: string | null | undefined): value is VesperSection {
  return VESPER_SECTIONS.includes(value as VesperSection);
}

export function normalizeVesperSection(value: string | null | undefined): VesperSection {
  return isVesperSection(value) ? value : DEFAULT_VESPER_SECTION;
}

/** Accessible label for the nav item. Chat has no visible title of its own. */
export function vesperSectionLabel(section: VesperSection): string {
  switch (section) {
    case "chat":
      return t("Chat");
    case "activity":
      return t("Activity");
    case "ideas":
      return t("Ideas");
    case "goals":
      return t("Goals");
    case "apps":
      return t("Apps");
  }
}

export type VesperSectionHeading = { title: string; subtitle: string };

/** Title and subtitle above a non-chat section. Chat renders no heading. */
export function vesperSectionHeading(section: VesperSection): VesperSectionHeading | null {
  switch (section) {
    case "chat":
      return null;
    case "activity":
      return {
        title: t("Activity"),
        subtitle: t("Plans, progress, decisions and results."),
      };
    case "ideas":
      return {
        title: t("Ideas"),
        subtitle: t("Useful next steps, grounded in your world."),
      };
    case "goals":
      return {
        title: t("Goals"),
        subtitle: t("Longer-term goals and things to keep an eye on."),
      };
    case "apps":
      return {
        title: t("Apps"),
        subtitle: t("Connections, capabilities and what your agent remembers."),
      };
  }
}
