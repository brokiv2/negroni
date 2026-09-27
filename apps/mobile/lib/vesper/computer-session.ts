import type { ComputerReleaseReason, ComputerStatus } from "@rakazo/contracts";
import { t } from "../i18n";

/**
 * Control and lifecycle state for the Vesper computer surface.
 *
 * `computer-pill.ts` answers the header's three-state question. This answers the
 * screen's richer one: who holds the keyboard right now, and what the one
 * primary button should do about it.
 */

export type VesperComputerControl =
  | "offline"
  | "booting"
  | "asleep"
  | "failed"
  /** Someone else holds the shared computer through another bot. */
  | "busy"
  /** The bot is driving and has asked to hand over. */
  | "handoffRequested"
  /** The bot is driving and has not asked for anything. */
  | "botDriving"
  /** This person holds the keyboard on this bot's computer. */
  | "youDriving"
  /** Up, nobody holding it. */
  | "idle";

export type VesperComputerSession = Pick<
  ComputerStatus,
  "state" | "controlHolder" | "controlBotId" | "takeoverRequested" | "busyBotName"
> | null;

export function computerControl(
  status: VesperComputerSession,
  botId: string | null,
): VesperComputerControl {
  if (!status) return "offline";
  switch (status.state) {
    case "booting":
      return "booting";
    case "suspended":
      return "asleep";
    case "error":
      return "failed";
    case "stopped":
      return "offline";
    case "running":
      break;
  }
  // Control is held per bot: another bot's lease is not yours to release.
  if (status.controlHolder === "user") {
    return botId && status.controlBotId === botId ? "youDriving" : "busy";
  }
  if (status.takeoverRequested) return "handoffRequested";
  if (status.controlHolder === "bot") return "botDriving";
  return "idle";
}

export function computerControlLabel(
  control: VesperComputerControl,
  busyBotName?: string | null,
): string {
  switch (control) {
    case "offline":
      return t("The computer is off");
    case "booting":
      return t("Starting the computer…");
    case "asleep":
      return t("Asleep. Take control to wake it.");
    case "failed":
      return t("The computer could not start");
    case "handoffRequested":
      return t("Your agent is waiting for you to take over");
    case "botDriving":
      return busyBotName
        ? t("{name} is working on it", { name: busyBotName })
        : t("Your agent is working on it");
    case "youDriving":
      return t("You have control");
    case "busy":
      return busyBotName
        ? t("{name} is using the computer", { name: busyBotName })
        : t("Another chat is using the computer");
    case "idle":
      return t("Ready when you are");
  }
}

/** The screen only accepts touches while this person holds the lease. */
export function canDriveScreen(control: VesperComputerControl): boolean {
  return control === "youDriving";
}

/** A dark frame with nothing behind it reads as broken; say what is going on. */
export function screenPlaceholder(control: VesperComputerControl): string {
  switch (control) {
    case "booting":
      return t("Starting the computer…");
    case "asleep":
      return t("Asleep. Take control to wake it.");
    case "failed":
      return t("The computer could not start");
    case "offline":
      return t("The computer is off. Take control to start it.");
    default:
      return t("Connecting to the screen…");
  }
}

export type VesperReleaseChoice = {
  id: string;
  label: string;
  reason?: ComputerReleaseReason;
  primary?: boolean;
};

/**
 * Handing the keyboard back. When the bot asked for the takeover, "I'm done" and
 * "Skip" mean different things to the waiting run, so both have to stay.
 */
export function releaseChoices(takeoverRequested: boolean): VesperReleaseChoice[] {
  if (!takeoverRequested) return [{ id: "release", label: t("Hand it back") }];
  return [
    { id: "skipped", label: t("Skip"), reason: "skipped" },
    { id: "done", label: t("I’m done"), reason: "done", primary: true },
  ];
}

/** The primary button under the screen, or null while it would do nothing. */
export function primaryControlAction(
  control: VesperComputerControl,
): { id: "take" | "wake" | "start"; label: string } | null {
  switch (control) {
    case "youDriving":
    case "booting":
    case "busy":
      return null;
    case "asleep":
      return { id: "wake", label: t("Wake it up") };
    case "offline":
    case "failed":
      return { id: "start", label: t("Start the computer") };
    default:
      return { id: "take", label: t("Take control") };
  }
}

/**
 * Whether a thread event should make the computer surface re-read its status.
 * The header pill and the screen both hang off this rather than a timer.
 */
export function isComputerEvent(type: string): boolean {
  return (
    type === "computer.status" ||
    type === "computer.takeover.requested" ||
    type === "computer.takeover.granted" ||
    type === "computer.takeover.released"
  );
}

/** Run events that change what the header's status line and bell should say. */
export function isRunActivityEvent(type: string): boolean {
  return type.startsWith("run.") || type === "thread.computer";
}

/**
 * The computer surface's tabs.
 *
 * Terminal is Phase 9: it needs `computer.exec` / `writeFile` / `mkdir`, none of
 * which exist yet. When they land, `"terminal"` joins this list and gets a case
 * in `computerTabLabel` — nothing else in the surface has to change.
 */
export const VESPER_COMPUTER_TABS = ["screen", "files"] as const;

export type VesperComputerTab = (typeof VESPER_COMPUTER_TABS)[number];

export function computerTabLabel(tab: VesperComputerTab): string {
  switch (tab) {
    case "screen":
      return t("Screen");
    case "files":
      return t("Files");
  }
}
