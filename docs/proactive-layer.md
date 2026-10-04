# Proactive layer (Radar)

Status: design for the `feat/proactive-layer` branch. Sections marked "decided" are binding for implementation; the rest is guidance. Evidence and references: `proactive-agent-research.md`.

## Goal

One assistant keeps watching every connected source on the owner's Mac, decides for each change whether it matters to the owner right now, and does exactly one of: tell the owner now with an offer to handle it, keep it for the next brief, or stay silent and log why. The owner can always see what was checked, why something was or was not sent, and every reaction teaches the filter.

Reference behavior: OpenAI dots (one primary assistant, read-only background research reporting to it), Grok Bot 0.66 (a Main Bot that checks in proactively and offers to take work off the owner's plate: "It looks like you've triple-booked your 2pm. Want me to reschedule?"), Meta Muse (a high bar for interruptions, briefs, ideas with approval). None of them publish thresholds, caps or quiet hours, and models over-flag when left to decide (ProactiveBench), so Negroni keeps delivery decisions in code and logs every decision. Everything runs on the existing Mac backend. No cloud computer, no new vendor.

## Why the existing path is not enough

The connected-source research of builds 39 and 41 is a feed feature. It reads Gmail headers and Granola notes a few times a day, alternates with public discovery, skips cycles while chat is busy, shortlists at most three documents with an instruction that prefers an empty answer, and requires an exact quote and confidence of at least 0.85 before anything is saved. Urgent chat delivery additionally needs confidence 0.95 and is capped at two a day. On a live installation this produced no findings in 40 cycles. The model also has no notion of who matters to the owner or what the owner is working on.

Radar replaces that path (decided). Public discovery stays as it is.

## Pipeline

```
observe (no model) -> store signals -> prefilter (rules, no model)
  -> judge (rubric scores, evidence first) -> second opinion (borderline interrupts only)
  -> decide (deterministic, versioned policy) -> re-read source -> deliver: interrupt | brief | silent
  -> feedback -> rules, priors, threshold offset, profile synthesis
```

### 1. Sources and observers (decided)

An observer turns one connected account into normalized signals using read-only provider operations bound to that single account (reuse `_account` pinning and `beforeRead`). Observers never call a model. Composio slugs below were verified against the provider's tool catalog on 2026-10-04.

| Source | Operations | Cadence | Emits |
| --- | --- | --- | --- |
| Gmail | `GMAIL_FETCH_EMAILS` with `after:<cursor>` and category exclusions, up to 50; `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` for a body excerpt of messages addressed to the owner; `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` for the pre-send re-read; `GMAIL_GET_PROFILE` for the owner's address | 10 min | `email`; `email_sent` (owner reply: closes open updates, never judged) |
| Google Calendar | `GOOGLECALENDAR_EVENTS_LIST` (`timeMin` now−1 h, `timeMax` now+48 h, `singleEvents`, `updatedMin` = cursor; or `syncToken`) | 15 min | `invite` (owner needs to respond), `event_changed`, `event_cancelled`; agenda for briefs and prep |
| Granola | `GRANOLA_MCP_LIST_MEETINGS`, `GRANOLA_MCP_GET_MEETINGS` since the cursor | 30 min | `meeting_notes` |
| Slack (when connected) | `SLACK_SEARCH_MESSAGES` for mentions and direct messages since the cursor | 10 min | `message` |
| Todoist (when connected) | `TODOIST_GET_ALL_TASKS` with filter `today \| overdue` | 60 min | `task_due` |
| Google Drive (when connected) | `GOOGLEDRIVE_LIST_CHANGES` from a stored page token, `GOOGLEDRIVE_LIST_COMMENTS` for changed files | 30 min | `comment`, `share` |

A source without an observer is listed as unsupported and is not read. Errors back off exponentially up to two hours. A revoked connection stops its source and shows a reconnect state. After the Mac sleeps, each overdue source runs once from its cursor; what exceeds the per-check cap is counted, not lost silently ("and 12 more"). Composio's own triggers poll with similar delay, so polling is the right first step; Gmail Pub/Sub pull and Slack Socket Mode are later latency upgrades that need no public URL.

Signal fields: source, connection, external id, thread key, kind, occurred at, actor (name, address), whether the owner is a direct recipient, unread state, title, excerpt (≤ 2000 chars, plain text), url, provider metadata, content hash. Identity: `(connectionId, externalId, contentHash)`; a changed calendar event is a new version of the same thread key. Story key = provider thread / event / meeting id, so later versions update one story instead of creating new ones.

### 2. Prefilter (decided)

Deterministic, before any model call. Marks the signal `silent` with a reason the owner can read:

- sent by the owner, or an owner reply (closes matching open updates instead);
- one-time codes, password resets, sign-in links;
- list or bulk mail (List-Unsubscribe header or no-reply sender) unless the sender matches a person or rule;
- calendar noise: declined events, unchanged versions, events beyond 48 hours;
- a matching `never` rule, or a story inside its decline backoff window.

### 3. Judge (decided shape, tuned on live data)

Each surviving signal is scored by the background model with the owner profile (summary, people, priorities, matching rules), the local time and the next brief time, today's agenda, the earlier versions of the same story and up to five of the owner's own labeled examples nearest to it (same sender or thread first). Score one item per call, or at most five per call when volume demands it; batch order biases judges. Source text is untrusted: prompts say so, and anything outside the schema is ignored.

The model writes the evidence first, then anchored integer scores 0–3:

| Dimension | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| addressed | broadcast, automated, someone else's task | group or cc | direct | direct with an explicit question or request |
| actionRequired | none | optional | expected | required, with a consequence if missed |
| timePressure | none or > 7 days | within 7 days | within 48 hours | before the next brief |
| stakes | trivial | minor | money, commitment, key relationship, deliverable | security, health, legal, travel disruption, large money, escalation |
| relationship | unknown or automated | known contact | frequent collaborator | person who matters (profile or rule) |
| novelty | duplicate or known | cosmetic change | material change to a known story | new story |
| linkage | none | stated interest | active project or ongoing work | blocks or unblocks an open commitment |
| seen | already handled in the source | opened | unknown | unread |

Plus `whoMustAct` (owner, someone_else, nobody, unclear), `verdict` (scored, unclear), `costOfDelay` (none, low, high, critical: what the owner loses by learning this at the next brief instead of now; critical needs concrete harm before the next brief supported by the quote), `confidence` 0–1, `evidence` (verbatim ≤ 200 chars, validated with `quoteInSource`; an invalid quote caps confidence at 0.5), `title` (≤ 60 chars, names the person or system and the change), `why` (one sentence a busy person accepts as a reason to look now, in the owner's language), `action` (reply, decide, prepare, attend, pay, review, none) and `offer` (one thing the assistant can do, phrased as a short question: "Draft a reply proposing 11:00?").

Code computes importance and stores it as 0–100:

```
importance = 100 * (0.20*actionRequired + 0.18*stakes + 0.14*addressed + 0.14*linkage
                    + 0.12*relationship + 0.12*novelty + 0.10*timePressure) / 3
             * (seen == 0 ? 0.3 : 1)
```

Borderline interrupts (importance within 5 points of the threshold, or `critical` from a sender with relationship below 2) get a second opinion from the conversation model; both must agree to interrupt. A pass the model answers unusably (no JSON, a schema or quote that does not hold) counts as an attempt: three attempts, then `silent` with reason "Could not evaluate." A pass the provider does not answer at all (credit or balance used up, rate limit, bad key, server or network error, timeout) says nothing about the update, so it counts no attempt and starts a model outage (section 9). Without a second look a borderline interrupt stays a brief item, and its reason says no second look was available.

### 4. Decision policy (decided; pure function, versioned, table-tested)

Levels set thresholds and the default daily interrupt cap (the cap is also a setting):

| Level | Interrupt at | Brief at | Default cap |
| --- | --- | --- | --- |
| Only urgent | 80 | 50 | 2 |
| Important (default) | 70 | 45 | 4 |
| More | 60 | 35 | 8 |

A per-owner `thresholdOffset` in [−8, +10] shifts the interrupt threshold: +5 when at least 3 of the last 10 rated interrupts were marked not important, −3 when "tell me sooner" was used twice in 7 days, decaying toward 0 over 14 days. Learned sender priors move a single sender's threshold by up to ±10.

Evaluation order:

1. `never` rule → silent. `digest` rule → at most brief. `always` rule → may interrupt regardless of score (still subject to gates 5–8).
2. `verdict` unclear or `whoMustAct` not owner → at most brief.
3. Interrupt when importance ≥ interrupt threshold, `costOfDelay` is high or critical, confidence ≥ 0.85 and seen ≥ 2. Brief when importance ≥ brief threshold or actionRequired ≥ 2. Otherwise silent.
4. Critical = `costOfDelay` critical with importance ≥ 85. Critical skips quiet hours, meetings and spacing, never the daily cap.
5. Paused (`pausedUntil` in the future) → brief.
6. Quiet hours (default 22:00–08:00 local) → deferred to the end of quiet hours, where it opens the morning brief.
7. In a meeting (accepted event with other attendees in progress) → deferred to two minutes after it ends, then re-evaluated.
8. Budget: daily cap reached → brief, marked "held". Less than 30 minutes since the last interrupt → deferred. One interrupt per story per 24 hours unless cost of delay rises to critical.

Every decision stores a trace: scores, importance, thresholds and offset, rules hit, gates applied in order, result. The app renders "why now" and "why not" from this trace and the stored evidence, never from a fresh model answer.

### 5. Delivery (decided)

Before an interrupt is delivered, Radar re-reads the source: a mail thread where the owner already replied or that is no longer unread, or a cancelled event, is downgraded or closed.

- **Interrupt**: one assistant message in the personal thread per delivery batch: one lead sentence in the owner's language, then one `update` block per item. One push per batch:
  - title: the person or system and the change; body: why, then the offer; no greeting, no "I noticed", no codes or sign-in links.
  - `category` by action (`RADAR_REPLY`, `RADAR_DECIDE`, `RADAR_GENERIC`); `thread-id` and `apns-collapse-id` = story key; `relevance-score` = importance / 100.
  - interruption level `active`; `time-sensitive` only for critical items and calendar changes starting within the hour; never `critical`.
  - priority 10; `apns-expiration` = the story's deadline, at most 24 hours ahead (never 0: an offline phone would never get it).
  - payload: `kind: "radar"`, update id, message id, thread id, space id, bot id.
  - **Probably watching**: when a desktop or web client fetched the personal thread in the last 90 seconds, the message lands without a push.
  - Message, signal state and delivery key commit in one transaction; the push is sent after commit and a failed push never duplicates the message.
- **Brief**: see below. Push with interruption level `passive`, priority 5, expiring after 12 hours.
- **Silent**: stored with its reason; visible under Skipped.

Radar never sends anything outward (mail, chat, RSVP, calendar edits). Accepting an offer hands it to the personal conversation with the update attached, where the assistant does the work and the existing approvals apply.

Open updates close automatically when the owner acts in the source (replies in the thread, answers the invite), when the event has passed, or after seven days without action (they leave "Needs you" but stay in history).

### 6. Briefs (decided)

Morning brief at 08:30 local by default, evening wrap off by default (18:30 when enabled). Exactly one per period per local day; if the Mac was asleep the morning brief is still sent until 12:00. "Send a brief now" produces an ad-hoc brief that does not consume a period.

Sections, each omitted when empty, at most seven primary items with the rest behind "N more":

1. **Needs you**: at most three items with the nearest deadlines, each with its offer.
2. **Your day**: today's agenda, calendar changes, prep for the first meetings.
3. **Held**: interrupts that quiet hours, meetings or the budget postponed.
4. **Stayed quiet**: one line with the count of skipped updates and how many were borderline, linking to Skipped.

The narrative is short (OpenAI retired Pulse in June 2026 because unactionable briefs did not hold attention): two to five sentences written by the conversation model in the owner's language, like a chief of staff over coffee, the picture of the day first, then what matters and why. No outline fragments or label-colon notes. The message carries a `brief` block with items and agenda so the app renders tappable rows. A morning brief with nothing to report still lists the agenda; an empty evening wrap is not sent. Brief items hide from "Needs you" once done or expired.

### 7. Meeting prep

Twenty to fifteen minutes before an accepted event with other attendees that involves a person who matters, an external attendee or a story scored ≥ 60, Radar gathers earlier Granola notes and mail threads with the same people from the signal store plus open updates, and asks the conversation model whether there is something useful to bring (at least two concrete points). If yes, it is delivered like an interrupt with its own cap of four per day, respecting quiet hours and pause. Otherwise nothing is sent.

### 8. Feedback and learning (decided)

Feedback kinds: `done`, `snooze` (until), `not_important`, `important` ("tell me sooner" / "this was important"), `mute_sender` ("never about this"), `always_sender`, and implicit `opened`. Acting in the source counts as a strong positive.

Immediate deterministic learning:

- `mute_sender` → explicit `never` rule; `always_sender` → explicit `always` rule.
- `not_important` → the story is suppressed for 24 hours, then 7 days, then 30 days on repeated declines; two for the same sender within 30 days without an `important` → learned `digest` rule for that sender and a lower sender prior.
- `important` on a skipped or briefed item → higher sender prior; two of them → learned `always` rule.
- Snoozed items return at the chosen time as an interrupt if they were one, otherwise in the next brief.
- Labeled items become the nearest-example set for the judge.

Explicit rules are never removed by learning. Inferred patterns stay visible and removable. The assistant gets two tools in the personal conversation: `radar_rule` (turn plain language like "stop interrupting me about invoices from X" into a visible rule) and `radar_status` (what was checked and sent today, and "why didn't you tell me about X?" answered from the stored decision).

Profile synthesis runs nightly and right after enabling: the conversation model reads up to 24 KB from configured context files under the knowledge root, the owner's recent personal messages, frequent correspondents from the signal store and the feedback log, then writes a short summary (≤ 1500 chars), people who matter with addresses and relation, current priorities and noise patterns. Only learned entries are replaced.

### 9. Scheduling

The elected job reconciler gets one more auxiliary reconciler. Per enabled owner it claims a cycle lease, runs due observers, then judging and decisions for pending signals, then due deliveries (deferred interrupts, snoozes, briefs, prep). Model calls use the existing bounded tool-less pass. A daily model allowance (default 300 passes) stops model work without losing signals; they wait. Radar runs regardless of chat activity because it never uses the conversation's run slot. Wake guards: at least 30 seconds between cycles per owner.

**Model outage.** The first judging, brief or prep pass that gets no answer stops model work for the owner for 10 minutes; each further failure doubles the wait, up to 2 hours (kept in the profile's counters, so a restart keeps it). While it lasts no pass runs; observation, screening by rules and delivery of what was already decided carry on, and signals stay pending. The first pass the model answers, usable or not, ends the outage, and pending signals are judged oldest first within the daily allowance (the 3-day staleness rule still applies). `RadarProfile.error` reads "The model is unavailable. If this lasts, check the provider's credit or key." until then; it names no cause because the provider's own reason does not reach Radar. An owner's explicit check ends the wait at once and keeps the count. Profile synthesis neither starts nor ends an outage: it runs before judging and stays due until it succeeds, so it must not hold judging up. Briefs do not wait for a backlog the model cannot take: while it waits they are plain (needs you, held, the day) and end with "I couldn't check N updates yet because the model was unavailable."; they are sent even when nothing else is in them, and never say nothing needs the owner.

Retention: excerpts are cleared after 30 days, signals deleted after 90 days.

## Data model (decided)

- `RadarProfile` (space, user): settings, learned rules and people, priors, threshold offset, summary and its time, version, cycle lease, last/next cycle, per-period last brief dates, desktop presence time, counters, last error.
- `RadarSource` (connection): enabled, cursor, last/next check, failures, last error, items seen today.
- `RadarSignal`: fields above plus status, judge result, disposition, decision trace, deliver-at, delivered at, delivery key (unique), message id, state (pending, open, done, snoozed, dismissed, expired), snoozed until, feedback and its time.
- `RadarBrief` (space, user, period, local date) unique: message id and included signal ids.

`BACKGROUND_MODEL` stays as a deprecated fallback; the model pool gains a `background` routing role chosen in Models settings.

## Contracts and RPC (decided)

`packages/contracts/src/radar.ts` exports settings (including `pausedUntil`), rules, people, source status, the update view (including `offer` and `evidence`), the decision trace, today's counters and status. Message blocks `update` and `brief` are added to `MessageBlock`. RPC namespace `radar`: `status`, `configure`, `source`, `updates` (views open, brief, skipped, all; cursor pagination), `update` (one update with its trace, read only), `feedback`, `rules`, `rule`, `person` (forget a learned or explicit person), `check`, `brief`.

## UX

Copy rules from `AGENTS.md` apply: every word is UI, progressive disclosure, no explainer text.

**Chat.** Radar speaks in the personal conversation as the same assistant, one sentence and then cards, under a "New" divider when the owner was away. An `update` card, top to bottom: source mark, account, sender and time; title; the why line; evidence collapsed behind a quote mark; the offer as the primary button; then Later (1 hour, this evening, tomorrow morning), Not important, and a menu with Never about this, Always tell me, Why this. Accepting the offer posts it to the conversation with the update attached. A `brief` message renders the short narrative, the agenda strip and item rows with the same actions.

**For you.** "Needs you" sits on top: open updates sorted by urgency then importance, swipe for Done and Later, tap for details (why, evidence, how it was decided, open in the source app, feedback). Below it the latest brief, then the existing article feed. When Radar is off, one card asks "When should I interrupt you?" with the three levels; choosing one enables every supported connected account, asks for notification permission and runs a first catch-up over the last 24 hours ("Taking a look around. I'll follow up shortly.").

**Radar screen** (antenna button in For you): a status line (Watching, Paused until 15:00, Needs reconnect), Pause (1 hour, today, until resumed), today's counts (Seen, Told you, In brief, Skipped; Skipped opens the list with reasons and "This was important"), sources with switches and reconnect states, Tell me (Only urgent, Important, More), quiet hours, briefs (morning, evening, send now), meeting prep, what I've learned (the summary; rules and people, each removable), and collapsed advanced settings (daily interrupt cap, context files, language).

**Notifications.** Categories `RADAR_REPLY` (Draft reply, Later, Not important), `RADAR_DECIDE` (Handle it, Later, Not important), `RADAR_GENERIC` (Open, Later, Not important), `RADAR_BRIEF` (Open brief); every Radar category also has a text input action "Tell Negroni…" that posts the text to the personal conversation with the update attached. The primary action opens the app on the conversation with the offer sent; Later and Not important run in the background. The first interrupt carries a one-time line on how to change the level.

Web and Electron mirror the same: block renderers in chat, Needs you and the Radar panel in For you.

## Safety

- Read-only provider operations only, bound to the selected account; arbitrary connector catalogs are never treated as read-only.
- Source content is untrusted and never becomes an instruction or a permission. The model cannot grant itself a breakthrough; only explicit rules can.
- No outward action from the background. Replies, RSVPs and edits go through the personal conversation and existing approvals.
- Raw content stays in the local database, bounded and expiring; logs carry counts and ids only.

## Testing

- Unit: policy table tests (every gate, critical bypass, quiet hours across midnight and time zones, deferral, budget and spacing, story limit, offset bounds), importance formula, prefilter, observer parsers with fixtures, judge parsing and evidence validation, brief scheduling.
- PostgreSQL: signal upsert and versioning, cycle lease and recovery, delivery idempotency (message and push once), re-read downgrade, feedback learning and backoff, snooze return, auto-close on owner reply, brief once per period, revoked source, pause.
- The Composio emulator gains `observe` so a full offline cycle runs in tests.
- Adversarial fixtures: prompt-injection mail, fake-urgency phishing, one-time codes, newsletters with countdowns, forwarded duplicates, cancelled events.
- Live (owner's installation): a dry run on a scratch copy of the database with real read-only provider calls and no push tokens, reviewed before enabling delivery. Metrics afterwards: interrupt precision, false-alarm rate, interrupts per day, "tell me sooner" count, duplicates, cost.
