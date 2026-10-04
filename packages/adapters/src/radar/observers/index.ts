import { calendarObserver } from "./calendar.js";
import { driveObserver } from "./drive.js";
import { gmailObserver } from "./gmail.js";
import { granolaObserver } from "./granola.js";
import { slackObserver } from "./slack.js";
import { todoistObserver } from "./todoist.js";
import type { RadarObserver } from "./types.js";

/** Toolkit slug → observer. A connected account without one is listed as unsupported. */
export const RADAR_OBSERVERS: Readonly<Record<string, RadarObserver>> = {
  gmail: gmailObserver,
  googlecalendar: calendarObserver,
  granola_mcp: granolaObserver,
  slack: slackObserver,
  todoist: todoistObserver,
  googledrive: driveObserver,
};

export function radarObserverFor(slug: string): RadarObserver | undefined {
  return Object.hasOwn(RADAR_OBSERVERS, slug.trim().toLowerCase())
    ? RADAR_OBSERVERS[slug.trim().toLowerCase()]
    : undefined;
}

export { SourceReadError } from "./envelope.js";
export { duplicateKey } from "./gmail.js";
export { granolaMeetings } from "./granola.js";
export type {
  AgendaEvent,
  ObservedSignal,
  ObserveResult,
  RadarObserver,
  RadarSignalKind,
  RereadOutcome,
} from "./types.js";
