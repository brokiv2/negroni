import type { ComputerStatus } from "@rakazo/contracts";
import { t } from "../i18n";

/**
 * The "Computer · take control" pill that sits under the header on the chat
 * section. Three states, read straight off `computer.status` and its events.
 */
export type ComputerPillState = "offline" | "ready" | "takeControl";

export type ComputerPillInput = Pick<
  ComputerStatus,
  "state" | "controlHolder" | "takeoverRequested"
> | null;

export function computerPillState(status: ComputerPillInput): ComputerPillState {
  if (!status) return "offline";
  if (status.state !== "running") return "offline";
  // The bot holding control, or asking to hand it over, is the moment the pill
  // is for: one tap to take the keyboard.
  if (status.takeoverRequested || status.controlHolder === "bot") return "takeControl";
  return "ready";
}

export function computerPillLabel(state: ComputerPillState): string {
  switch (state) {
    case "offline":
      return t("Computer · offline");
    case "takeControl":
      return t("Computer · take control");
    case "ready":
      return t("Computer · ready");
  }
}

/** The 5px dot: lit whenever the machine is up, regardless of who holds control. */
export function computerPillOnline(state: ComputerPillState): boolean {
  return state !== "offline";
}
