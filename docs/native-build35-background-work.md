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
