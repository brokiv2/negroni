# Native tool activity — build 34

Long tool runs previously left iOS showing only an avatar animation; synthetic tool-step messages could render as empty bubbles. Their event sequence numbers also contaminated optimistic message reconciliation, leaving duplicate user messages visible after delivery.

The native chat now shows the three latest tool actions below the conversation, using service icons where available and native symbols otherwise. Running calls animate; completed, failed, interrupted and approval-waiting calls have distinct states. Tapping an action opens a native sheet with the full recent run timeline and durations. “View all N actions” appears only when more than three calls exist. These labels expose actual execution progress while keeping the transcript compact. No argument payloads, tool results or reasoning are returned by this endpoint, and no result counts are invented.

`threads.activity` resolves the owned personal, team, group or feed thread before querying runs and audit events. It returns a bounded recent window (five runs, at most 400 audit events), or one explicitly selected run. Existing clients remain compatible. The Mac remains the execution host.

Optimistic sends now reconcile against user-message sequence numbers only. Active-run follow-ups use the same nonce-backed send endpoint as ordinary messages. Invisible tool-only blocks never create empty native cells. Temporary Codex directory cleanup retries transient failures without changing a completed answer into a failed run.

Validation: 188 focused backend/core regression tests and 11 Swift core tests passed. Type checking passed for the affected packages. The simulator target compiled. An isolated API probe verified tool status pairing and exclusion of private arguments; another verified same-nonce retry receipts and distinct receipts for identical follow-up messages. Interactive visual QA and physical-device behavior remain unverified because computer-control access was unavailable during this pass. Release processing is recorded separately from these checks.

Release verification: build 34 archived, exported, passed Apple validation and uploaded. App Store Connect reports `VALID` and internal `IN_BETA_TESTING`. The installed backend serves the new activity endpoint through the mobile gateway with HTTP 200; a read-only production probe returned recent actions without argument or result payloads. External beta submission and physical-device QA are separate from internal availability.
