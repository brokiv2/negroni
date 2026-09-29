# Personal assistant direction

Reference: [OpenAI, Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot), reviewed September 29, 2026. The relevant product pattern is one named assistant, conversation as the entry point, persistent context, visible ongoing/scheduled/completed work, and user control over its actions. This is a behavioral reference, not a claim of compatibility or access to OpenAI's implementation.

## Negroni decisions

- Keep the native Swift/UIKit iOS app and the existing personal conversation as the primary entry point. Team is an optional view of the same work.
- Execute on the connected Mac. Do not add a virtual or cloud computer.
- Preserve provider-neutral model connections, manual model selection, and automatic routing. Use the current Codex runtime for tool execution.
- Show real tool activity inline, with service identity and progressive disclosure. Build 34 implements the first version described in `native-build34-activity.md`.
- Keep project memory and existing short-lived/persistent delegation primitives. Do not invent unsolicited goals, reminders or task summaries from a greeting.
- Keep For you as an article feed with discussion, with automations under its existing category.

## Remaining implementation and acceptance

A unified assistant profile should expose current work, completed work, schedules, memory, connected accounts, model routing and action rules. Each control must connect to a real backend operation. A future pause control must persist and gate scheduling/execution; hiding the UI or archiving an agent does not implement pause.

Acceptance requires checking personal, group and feed conversations against the same runtime; reconnect and foreground delivery; tool success/failure/cancellation; follow-ups during long work; account removal; schedule management; and the native keyboard/safe-area layouts. Archive, upload, Apple processing, tester availability and physical-device QA are distinct states. This document is the target and remaining-work map, not a declaration that the full redesign has shipped.
