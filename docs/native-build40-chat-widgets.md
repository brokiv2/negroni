# Native chat actions and widgets

The chat previously hid answer choices behind a generic Reply button. The working indicator lived in a manually sized table footer, outside the message layout. This release puts choices directly below their question and moves live activity into a self-sizing timeline row. Ordinary free-text questions use the existing composer. Secret entry remains a protected native prompt.

Scrolling follows new content while reading the latest response, preserves an older reading position, and keeps the activity row above the keyboard. Polls with unchanged content do not rebuild that row. Tool activity belongs to the latest run rather than the last run that happened to use tools. Completed or expired questions no longer offer live actions.

## Structured cards

- `show_weather` publishes a validated weather card after the agent obtains source data. It includes observation time, location, unit, current conditions, up to eight forecast entries, and an HTTPS source. Shared fallback rows preserve compatibility with older clients. The native renderer uses SF Symbols and the shared semantic palette. This is a presentation tool, not a weather-data provider.
- `review_email` persists a draft and pauses the run without contacting a mail provider. Native iOS opens a UIKit editor; web and desktop expose editable fields. Send submits the reviewed recipients, subject and body, bound to the account named on that card. The server resumes the agent with the reviewed content. The agent then uses the existing connected mail tool. The card says **Send requested**, not **Sent**: delivery is reported by the subsequent tool result. It does not create a provider-side draft automatically.
- Native email edits remain in the editor on a submission error. Closing with changes requires choosing to discard them. Concurrent answers are rejected by the existing waiting-run transition; the editor also disables repeat submission.
- Background runs cannot open email-review prompts. Normal draft text and source provenance remain in conversation history so later questions can refer to them.
- Older native/Android clients retain weather rows and the email subject/body with their existing ask interface. The richer editor requires this release.

## Verification

- 207 focused contract, persistence, runtime, web component and regression tests passed.
- 14 NegroniCore tests passed; native simulator build succeeded.
- Adapter, database and web type checks passed; production web build succeeded.
- Visually exercised on an iPhone simulator with an isolated local backend and fake accounts: inline choice selection and continuation; working avatar across refreshes; screen keyboard; scrolling away and returning; weather card; editing email subject/body and submitting the exact edits.
- Email review tests cover malformed recipients, changed account, cancellation, request failure/retry, and stopping before mail connector execution.
- The approval test fixture was updated for the routing and feed reads added in earlier releases; existing approval cases pass again.

Simulator fixtures establish layout and request/state behavior. Physical-device animation performance, fresh live weather retrieval, model tool selection and real mailbox delivery are separate checks; no real mail was sent during this QA pass.

Apple reference pages for the native interaction patterns: [progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

## Visible copy

“Edit & send” opens the email editor. “Send” requests sending the reviewed content. “Send requested” avoids claiming provider delivery prematurely. “Discard edits?” with “Keep editing” / “Discard edits” appears only when closing an edited draft. “Enter securely” appears only for protected input. Weather cards display source-provided labels, the observation time and source link.

## Release

Native version 1.0.0 (40). Apple processing and installed-runtime verification are recorded after delivery.
