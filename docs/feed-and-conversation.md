# Conversation and For you

The assistant follows the current request. Greetings are conversation, not implicit status requests. Past work, interests and brainstorming do not authorize new tasks or schedules. Existing memory remains stored; each normal turn receives a bounded index of document locations, with `read_memory` and `recall_memory` available for relevant retrieval. Open scratchpad entries are retrieved explicitly through `task_catalog` or `scratchpad_list`, not injected on every turn. Thread history and local compaction preserve conversational continuity.

For you contains Feed, Saved, Automations and Hidden. Goals and Ideas are removed from navigation; existing scratchpad records are preserved. Memory remains in Settings. Automations are created on request through chat and can be paused in For you.

Feed records have a source URL, title, summary, optional Markdown notes, image, topic, relevance explanation and publication date. `publish_feed` is available to the assistant for requested research and authorized scheduled curation. It deduplicates source URLs, retains hidden/saved choices and creates no chat message or push notification. No collection schedule is enabled implicitly. X posts use a constrained platform embed after the user requests it, with the original link always available. Arbitrary HTML is not accepted.

Each item has an isolated persisted conversation using the existing executor, model routing, tool authorization and message infrastructure. Source content is untrusted; a summary is not evidence that the complete source has been read. The main chat never receives the article discussion history automatically. Feed records and their conversations are scoped to both user and space.

The desktop model selector lives inside the composer. Mobile uses the same data and executor with native navigation; native UI changes require a new mobile build.
