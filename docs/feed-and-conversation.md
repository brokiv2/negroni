# Conversation and For you

The assistant follows the current request. Greetings are conversation, not implicit status requests. Past work, interests and brainstorming do not authorize new tasks or schedules. Existing memory remains stored; each normal turn receives a bounded index of document locations, with `read_memory` and `recall_memory` available for relevant retrieval. Open scratchpad entries are retrieved explicitly through `task_catalog` or `scratchpad_list`, not injected on every turn. Thread history and local compaction preserve conversational continuity.

For you contains Feed, Saved, Automations and Hidden. Goals and Ideas are removed from navigation; existing scratchpad records are preserved. Memory remains in Settings. Automations are created on request through chat and can be paused in For you.

Feed records have a source URL, title, summary, optional Markdown notes, image, topic, relevance explanation and publication date. `publish_feed` is available to the assistant for requested research and authorized scheduled curation. It deduplicates source URLs, retains hidden/saved choices and creates no chat message or push notification. No collection schedule is enabled implicitly. X posts use a constrained platform embed after the user requests it, with the original link always available. Arbitrary HTML is not accepted.

Each item has an isolated persisted conversation using the existing executor, model routing, tool authorization and message infrastructure. Source content is untrusted; a summary is not evidence that the complete source has been read. The main chat never receives the article discussion history automatically. Feed records and their conversations are scoped to both user and space.

The desktop model selector lives inside the composer. Mobile uses the same data and executor with native navigation; native UI changes require a new mobile build.

## Selective feed learning

The user can enable conversation learning in Customize feed. The Codex-based runtime evaluates the current user's message and may call `learn_feed_interest` for a high-confidence public topic. It is instructed to ignore greetings, transient troubleshooting, source quotations and sensitive personal or project details. The server verifies that the evidence occurs in the current user message, accepts at most one new topic observation per message, and deduplicates retries. Inferred topics need two distinct messages before curation uses them and expire after 30 days without reinforcement. Model judgment remains fallible; the profile exposes candidates, learned topics and reasons for correction.

The profile is private to user and space, with serialized updates. It stores bounded topic summaries and source message IDs, not a copy of the transcript. Explicitly followed topics persist; exclusions win over inferred learning. Turning learning off stops new inference while preserving editable existing preferences. Forget removes a topic; Exclude additionally prevents it being learned again. Existing conversation history is not batch-imported.

Requested feed collections receive the current profile. The publisher enforces exact excluded topic labels and selected source domains outside the model prompt; automated runs also have a per-user rolling 24-hour publication cap. Semantic relevance and synonym matching remain model judgments. Learning never starts searches, schedules or push notifications by itself. Create recurring collection through New automation/chat, using the existing scheduler. Automation descriptions are collapsed by default; pause, edit and delete are available on expansion. Deletion removes the schedule and cancels its pending scheduler wakeup; it does not retract prior results or stop a run already underway.

Mobile renders feed cards through a virtualized list with small rendering batches and pull-to-refresh. Article conversations retain their existing isolated threads; automation creation/editing puts an editable draft in the main chat rather than sending it immediately.
