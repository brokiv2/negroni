# Native build 35: ongoing work and public discovery

Build 35 uses the existing app identity and native Swift/UIKit target. It preserves existing conversations, assistants, connections and feed data. The installed Mac backend has the matching contracts and additive migrations. No virtual computer was introduced.

## Behavior

- Explicit continuing requests can persist an objective, original authorization, next check, deadline and run allowance. Individual run completion does not claim that the objective was achieved. Paused/stopped work rejects late updates, and a renamed retry cannot recreate a stopped responsibility from the same user request.
- Chat → Ongoing work exposes details, pause/resume and swipe-to-stop.
- For you → Feed settings exposes public discovery, checks per day, current state and next check. It reuses the existing learned/explicit topics, exclusions, source domains and daily article limit. Conversation learning and background discovery remain distinct controls.
- Discovery has a private internal thread and a restricted runtime request. It cannot occupy the chat queue, steer the computer, access connectors, send messages or delegate. Only public search, reading and private evidence submission are exposed; dispatch and publication recheck scope.
- A finding requires an observed source and exact supporting quote. Selected cards use normal Markdown rendering, source links, page-provided preview images and the existing article discussion. Previously seen or hidden sources do not return. Empty checks back off; no chat narration or push is generated.
- With no eligible interests, discovery waits without making model calls. Learning needs evidence from two distinct relevant user messages; explicit topics can be added in settings.

## Verification

- 391 tests passed across 18 affected suites, including PostgreSQL lifecycle checks, full executor scenarios, API routing, shared thread behavior and web boundaries. One additional PostgreSQL regression then passed for renamed retries after cancellation; the associated executor test was rerun successfully.
- API/worker/adapter typechecks pass. UIKit simulator build succeeds.
- Clean-schema migration exercise succeeds, including the internal research-thread enum. Production additive migrations succeeded after an archive-format database backup was verified.
- Local backend health and authenticated mobile-gateway activity, ongoing-work and discovery endpoints respond successfully after restart. Production uses Codex and the desktop execution provider.
- Exported IPA inspection confirms build 35, native UIKit, production gateway, Store provisioning and encryption compliance. Apple validation and upload succeeded.

## Release status

Build 35 is `VALID` in App Store Connect and `IN_BETA_TESTING` for internal testers. Encryption compliance is recorded as false. External beta submission and physical-device QA are separate from internal availability.

## Evidence boundaries

Tests use fake model and web services; they establish the lifecycle and enforcement behavior, not the relevance of real model-selected articles. Interactive native QA was attempted, but the native UI automation tool could not access the simulator. Physical-device touch behavior remains unverified.

This public discovery mode does not read signed-in account sources. Existing authorized tools remain available to explicitly assigned ongoing work. Event-driven wakeups, semantic clustering across different URLs and a single stop-all-background-work action are not part of this build.

## Live discovery follow-up

A bounded run with the connected DeepSeek model exposed gaps that scripted services did not: the keyless search page was a human-verification challenge, and exhaustion of the tool allowance could be swallowed by the runtime and reported as a successful empty check. A repeat of the concurrent-claim regression also exposed a race during first creation of the internal research thread.

The backend now recognizes unavailable HTML search, aborts a research turn on terminal capability/budget/search errors, and distinguishes unreadable sources from a successful empty collection. The internal thread is created under the profile lock. Low-confidence candidates are declined without a validation error encouraging the model to increase its score; date-validation errors are concise and the tool instructions specify UTC timestamps.

For the selected Vercel Gateway connection, search uses the official provider-executed Perplexity tool through the existing key and model. The adapter accepts correlated tool-result data only, never model-written links. Reading still uses the restricted public HTTP adapter. Search inference tokens are recorded on the run; provider search charges remain visible in Gateway. Fake/custom web adapters and non-Gateway model connections retain their configured web provider. This is also used by explicit chat search. The SDK reference is [Gateway web search](https://vercel.com/docs/ai-gateway/models-and-providers/web-search).

The corrected live scenario searched swift.org, read original pages and published one source-backed card into a disposable test profile, with zero chat messages. The exact-quote gate first rejected an assembled quotation, then accepted a verbatim source excerpt. All fixture data was removed; production interests and conversations were unchanged. The OpenAI-domain scenario could search successfully but direct page reads received HTTP 403, so no card was published. This remains a source-access limitation, not evidence that those sources were read.

Validation for this follow-up: 163 checks across seven affected suites pass, covering real PostgreSQL concurrency, actual executor dispatch, swallowed errors, provider-result provenance, cancellation, HTTP source boundaries and neighboring execution/recovery paths. Native build 35 remains the released client; the follow-up requires only the Mac backend update.

Deployment verified: the installed Mac runtime includes this follow-up, dependencies are installed, and the authenticated mobile gateway returns healthy discovery/profile/work responses after restart. Existing private runtime configuration is unchanged. Native UI interaction remains blocked by the UI-control tool access failure.
