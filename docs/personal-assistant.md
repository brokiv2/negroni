# Personal assistant: target architecture

Status: spec, 2026-09-24. Implemented iteratively; each iteration lists what landed.

## Why

Today "Personal" is a view mode over the Team data of the root bot. It has no
conversation, persona, run mode or data model of its own:

- "Chat" opens the root bot's single Team thread with delegation blocks hidden.
- Goals and Ideas are the root bot's generic scratchpad items relabelled by
  status (`open` = goal, `parked` = idea). Any bot can add one by accident.
- Activity is the raw run list of the hierarchy, including "you wrote in chat".
- Memory is the shared bot/user memory documents.

The owner wants one personal assistant that owns the conversation, uses the
team of bots as workers when a task needs it, reports results itself, and never
sends the user to another bot's chat.

## Product model (Muse-informed, Grok-Bot-backed)

Two surfaces on one account:

| | Personal | Team |
|---|---|---|
| Who talks to you | One assistant (root bot, e.g. Negroni) | Any bot or group directly |
| Thread | Dedicated personal thread (`Thread.kind = "personal"`) | Team thread per bot, group threads |
| Run mode | `interactionMode: "personal"` | default / voice |
| Delegation | Assistant calls `message_bot` / `run_subagent` on its own; worker chatter stays in Team threads | Explicit, visible |
| What you see | Assistant's own messages, compact "worked with X" chips, approval cards | Everything |

Personal tabs:

- **For you**: a feed, not a dashboard. Order: needs your decision (approvals,
  waiting runs), in progress, upcoming (next routine firings), recent results,
  suggested ideas. Empty state explains what the assistant does.
- **Goals**: outcomes you asked for, tracked over time. A goal has a title,
  why it matters, a category, a status (active / paused / done), progress notes
  written by the assistant, and links to the routines and runs that advance it.
  Created by you (chat or the tab) or by the assistant when you state one in
  conversation. Decomposed into steps the assistant schedules as routines.
- **Ideas**: suggestions from the assistant based on goals, memory and recent
  activity. Each has a rationale and two actions: start (becomes a goal) or
  dismiss. You can also park your own idea.
- **Activity**: what the assistant did, as outcomes ("Booked the dentist",
  "Checked flights, nothing under 300"), grouped by day. Not chat echoes.
- **Memory**: the identity file the assistant keeps about you, editable, plus
  the assistant's own notes. Already exists; needs copy and an intro line.

Voice: the personal assistant has its own voice (provider, voice id, auto
speak) configurable on web and mobile. Backend already supports `Bot.voiceId`
and `Bot.autoSpeak`; mobile lacks the picker.

## Iterations

### Iteration 2: separate the conversation, fix mobile, voice

- `Thread.kind` (`team` | `personal`), one personal thread per root bot,
  created lazily. Personal chat on web and mobile targets that thread.
- `interactionMode: "personal"` for runs started from the personal thread:
  system prompt makes the assistant the owner: delegate silently, summarise
  results, never redirect the user, ask only when a decision is needed.
- Worker results (`returnBotMessageOutcome`) still wake the assistant; the
  assistant's reply lands in the personal thread when the originating run was
  personal.
- Mobile assistant hub layout: consistent tokens from one appearance source,
  card hairlines, tab bar with background and divider, real composer at the
  bottom, full-width CTA, no duplicate welcome card.
- Mobile: per-bot voice picker in bot settings; Personal settings entry.
- Explainer empty states on each tab (one line each, no repetition of the UI).

**Landed (2026-09-24):**

- `Thread.kind` enum (`team` default, `personal`), unique `(botId, kind)`, migration
  `20260924180000_thread_kind`. Existing rows stay `team`. Bot-to-thread lookups
  that mean "the bot's chat" select the Team thread (`teamThreadOnly`), so the
  bot list, unread dot, search, messaging and teaching keep using Team.
- `personal.thread` RPC returns (and lazily creates) the main assistant's
  Personal thread. Every `threads.*` call accepts `threadKind: "personal"` with
  `botId`; snapshots carry `kind`.
- Web Personal view and mobile `view=assistant` talk to the Personal thread
  (get, messages, subscribe, send, stop, answer, react, clear, mark read). Child
  bots, groups and the assistant's own Team runs still open in Team.
- Runs from the Personal thread get `interactionMode: "personal"` (voice calls
  stay `voice`); the executor also treats any run in a Personal thread as
  personal. Role prompt: `PERSONAL_ASSISTANT_INSTRUCTION` in
  `packages/core/src/main-assistant.ts`.
- A worker's reply (auto outcome or explicit `message_bot` back to the
  requester) returns to the thread holding the request (`returnToMessageId`),
  so Personal requests get their result in Personal and wake the assistant
  there in personal mode.
- Personal transcript shows delegation blocks (`bot_message_sent`, `subagent`,
  `child_bot`, `handoff`) as one "Worked with <bot>" chip (web reuses the
  collapsed "Worked for" disclosure, mobile the agent event label); raw worker
  replies stay hidden.
- Mobile hub: one token source, opaque header with safe area, tab bar with
  hairline, hairline cards, full-width CTAs, no duplicate welcome card, a real
  composer that sends into the Personal thread and opens it, 760 pt content
  column for iPad.
- Mobile voice: voice picker and "Read replies aloud" in bot settings
  (`bots.update` with `voiceId`, `autoSpeak`); "Voice" row in the Personal menu
  opens it for the assistant.
- One-line empty state per tab (`personalTabExplainer`), shared by web and
  mobile.

**Not landed / not verified:**

- Personal thread unread is stored but not shown anywhere yet.
- Search covers Team threads only.
- Mobile does not play replies aloud in chat; `autoSpeak` is saved and used by
  web and calls.
- `spawn_bot` with a first task still does not report back automatically (as in
  Team); the assistant should follow up with `message_bot`.
- Clearing the Personal thread skips the semantic-memory purge (generation
  numbers are per thread); compacted summaries of both threads share the bot's
  memory namespace.
- Push notifications for Personal runs open the Team chat on mobile.
- Mobile screenshots were taken without a session (it had expired), so the hub
  shows empty states only; iPad was not captured (a system prompt blocked the
  deep link). Web Personal flow was not clicked through in the app.

### Iteration 3: goals and ideas as real objects

- `Goal` and `Idea` tables (or `ScratchpadItem.kind` with extra columns if the
  migration is cheaper), category, links to routines and runs.
- Agent tools: `goal_create`, `goal_update`, `idea_propose`; scratchpad tools
  stop feeding Goals.
- For you feed assembled server side (`personal.feed` RPC) so web and mobile
  render the same thing.
- Activity shows run outcomes (last assistant message summary) instead of raw
  runs.

### Iteration 4: proactivity

- Digest routine per goal, "notify only when meaningfully new" rule.
- Push (APNS already in adapters) for approvals and results.
