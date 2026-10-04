/** What one connected account turned into since the last check. Observers never call a model. */

export const RADAR_SIGNAL_KINDS = [
  "email",
  "email_sent",
  "invite",
  "event_changed",
  "event_cancelled",
  "meeting_notes",
  "message",
  "task_due",
  "comment",
  "share",
  "prep",
] as const;
export type RadarSignalKind = (typeof RADAR_SIGNAL_KINDS)[number];

export type RadarActorValue = { name?: string; address?: string };

export type ObservedSignal = {
  externalId: string;
  threadKey?: string;
  /** Provider thread, event or meeting: later versions update one story. */
  storyKey: string;
  kind: RadarSignalKind;
  occurredAt: Date;
  actor?: RadarActorValue;
  /** The owner is a direct recipient (To, a DM, an invitee). */
  direct?: boolean;
  unread?: boolean;
  title: string;
  /** Plain text, at most 2000 characters. */
  excerpt: string;
  url?: string;
  deadline?: Date;
  /** Provider facts for the prefilter and judge: labels, bulk markers, response status. */
  meta?: Record<string, unknown>;
  /** What makes a new version when it changes; defaults to title and excerpt. */
  version?: string;
};

/** One upcoming event, kept for briefs, meeting prep and the meeting gate. */
export type AgendaEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  /** Other attendees' addresses, lowercased. */
  attendees: string[];
  /** accepted, tentative, needsAction or declined; organizers count as accepted. */
  response?: string;
  url?: string;
};

export type ObserveResult = {
  signals: ObservedSignal[];
  cursor: Record<string, unknown>;
  /** Items the cap left unread this check. */
  overflow: number;
  agenda?: AgendaEvent[];
  /** The account's own address, when the provider reports it. */
  ownerAddress?: string;
};

/** A read-only provider operation bound to the one account being observed. */
export type ObserverCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export type ObserveInput = {
  call: ObserverCall;
  cursor: Record<string, unknown>;
  now: Date;
  /** Where a first check starts. */
  since: Date;
  timeZone: string;
  ownerAddresses: string[];
};

/** What a fresh look at one item found right before an interrupt goes out. */
export type RereadOutcome = "keep" | "opened" | "handled" | "gone";

export interface RadarObserver {
  cadenceMinutes: number;
  observe(input: ObserveInput): Promise<ObserveResult>;
  reread?(input: {
    call: ObserverCall;
    externalId: string;
    threadKey: string;
    occurredAt: Date;
    ownerAddresses: string[];
  }): Promise<RereadOutcome>;
}
