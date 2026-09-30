# Connected updates and reliable chat status

A desktop update moved the bundled agent executable. The server still used its old location, so new runs failed before producing an answer. The runtime now resolves the relocated packaged CLI and reports a missing engine explicitly. Native chat shows a failed run in the timeline; queued, leased and running work retains the activity indicator.

## Connected apps

The native entry screen loads saved connections independently of the provider catalog, groups them by service and opens an account list. Add app opens the catalog. Revoked accounts are collapsed separately and remain removable. Account identity is stored independently of a user nickname. Gmail identity can be fetched from the exact connected account. This does not silently switch a call to another mailbox. Live verification also exposed a provider project that rejects the per-call account selector. Execution now pins a single-account session instead, and refuses a selected account that is no longer active. Tests verify that the selector is removed from tool arguments and that a revoked selection does not execute.

The desktop entry screen also prioritizes saved apps and moves discovery and advanced setup into Add app. Existing provider-side disconnect and local removal are combined for the account removal action.

## Background updates

The existing local research scheduler gains a read-only Gmail observer alongside Granola. It fetches at most 20 recent headers/snippets per account within a 24-hour catch-up window, excludes authentication/reset messages, deduplicates previously observed documents and submits at most ten selected documents per cycle. Empty checks skip the model; research also skips the conversational routing classifier. The model uses the configured conversation model, not an unverified claim of the cheapest available model.

Every finding must quote a source read in that cycle, have supported provenance and pass the existing relevance and expiry checks. Ordinary findings stay in the feed. An optional Important updates setting allows a time-sensitive finding into the personal chat only with confidence of at least 0.95, a reason to interrupt, an expiry within 24 hours and local time between 08:00 and 22:00. Delivery is limited to one per hour and two per rolling day. Durable chat publication and deduplication share a database transaction. Existing foreground notification suppression still applies.

This is bounded polling on the user's running Mac, not real-time delivery or an exhaustive mailbox audit. Bursts beyond the per-cycle caps can be missed. Sleeping/offline machines cannot perform background checks. Connector permission failures stop that source; they do not authorize a different account. Existing research cadence, daily budget and empty-result backoff remain in effect.

## Feed

Native posts render Markdown, source links, images, Save, Discuss and contextual topic feedback. Discuss opens a conversation bound to the item. Interest learning requires evidence from user messages, two independent observations for an inferred interest and respect for excluded topics. It does not treat every mentioned subject as a permanent preference.

## Research basis

[Muse's product description](https://introducing.muse.ai/) describes work between conversations and a high bar for interruptions. [Muse's engineering article](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse) describes its persistent execution and connector boundaries. Neither discloses an exact relevance classifier, model price or polling cadence. An [independent first-hand sandbox inspection](https://rohanadwankar.github.io/posts/sandbox2.html) observed heartbeat, preferences and cron artifacts in one installation; it is evidence of that installation rather than a complete private architecture.

The service/account hierarchy follows [ChatGPT's connected-account documentation](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt). Gmail observation uses the [Composio Gmail toolkit](https://docs.composio.dev/toolkits/gmail). Native Gmail push would require [a watch subscription and Pub/Sub configuration](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch), which this release does not introduce.

## Verification

- 62 focused adapter and web component tests passed.
- 32 isolated PostgreSQL tests passed sequentially, including evidence validation, source revocation, deduplication and urgent delivery limits.
- 14 native core tests passed. Adapter, API, worker and web type checks passed.
- Native simulator build and production web build passed.
- In the iPhone simulator, saved apps grouped correctly, account identity was visible, a feed image loaded, Discuss opened the item conversation and an injected failed run displayed its error in the timeline.
- A harmless live model probe exercised the configured runtime, one local fixture tool and the final response. It did not post to a real conversation or send email.

Live Gmail verification resolved identity for three active connections and successfully read bounded message previews. A fourth stored connection was no longer active at the provider and was excluded from monitoring. Live response inspection caught a nested preview shape that the fixture alone had not covered; the parser and regression fixture now cover it.

An end-to-end live background cycle completed, recorded ten source fingerprints and produced no finding worth surfacing. A regression test covers graceful exhaustion of the finding allowance: valid work is retained rather than failing the whole cycle.

Physical-device animation quality remains a separate check.

## Release

Native version 1.0.0 (41) is **VALID** and **IN_BETA_TESTING** in App Store Connect, with export compliance complete. The installed Mac backend and desktop bundle were updated; backend health and the served bundle hash matched. Live background checks and interest learning were enabled for verified supported sources. No database schema migration was required.

## Visible copy

“Your apps”, “Add app”, “Connected accounts” and “Disconnected accounts” distinguish navigation and account state. “Important updates” is the opt-in interrupt control. “Why this post”, “Hide this post” and “Not interested in this topic” appear only on request. “Couldn’t finish this response” appears only after a failed run, so silence is not mistaken for ongoing work.
