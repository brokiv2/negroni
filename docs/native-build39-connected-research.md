# Native build 39: connected-source anticipation

For you can read explicitly selected Granola accounts, compare changed meeting notes with relevant memory and ongoing assigned work, and save concrete suggestions without posting chat messages or sending notifications. Connecting an account alone does not enable background reading. Public discovery and connected-source checks alternate within the existing daily allowance and use the existing Mac runtime, queue recovery and configured model routing.

The first provider adapter reads meetings from the last seven days with the documented `GRANOLA_MCP_LIST_MEETINGS` and `GRANOLA_MCP_GET_MEETINGS` operations. Each call is bound to one selected account and rechecks authorization. A check reads at most ten meetings per account; unseen IDs take priority, followed by previously checked IDs in oldest-check order. At most ten changed documents enter an evaluation. Unchanged documents update their check time without invoking the model. Fingerprints contain no raw note content. SDK/MCP structured JSON envelopes are supported; unexpected formats fail visibly instead of being interpreted as an empty source.

The isolated evaluation can only save an opportunity with an exact source quotation, usefulness reason, concrete next step, confidence and expiry. It cannot access account mutation, browser, computer, web search, messaging, scheduling or delegation tools. Relevant memory snippets and assigned-work context are retrieved; raw meeting notes are not committed to memory. A successful empty evaluation also advances fingerprints. Failed evaluations can retry.

Publication rechecks profile version, membership, active cycle, completed run, account status, expiry, topic exclusions and the shared daily feed limit in a transaction. A source has one publication identity, so a hidden suggestion cannot return with another title. Public discovery retains its separate tool and data boundary. Clearing source selection cancels in-flight work through the existing version fence.

Controls live under For you → Feed settings in UIKit and web/Electron. Native **Connected sources** contains account switches and **Connect app**, which opens existing connection management. **Reads recent meetings and relevant memory. Suggestions appear quietly in For you.** explains the scope at the point of enabling it. Supported-account availability comes from the server; arbitrary provider tool catalogs are never treated as read-only. Build 39 includes the connected-only status/error footer and service icons. Build 38 was an intermediate upload before that final native status correction.

Validation:

- 191 deterministic tests cover the new source adapter and web account switch, plus connector, executor, router and feed regressions.
- 34 PostgreSQL cases cover connected/public scheduling, unchanged-input skipping, empty evaluation, account revocation before delivery and during reading, pause, dismissed-source changes, invented evidence, expiry, scope isolation and forbidden tool calls. Four of these exercise the complete executor with both public and connected research, including computer isolation.
- Adapter/API/web typechecks and the web production build pass. Native archive/export and release inspection verify Swift/UIKit, production gateway, Store profile and encryption declaration.
- External accounts and model output in these tests are emulated. Actual Granola authorization, live source response compatibility and suggestion quality require a connected account and a live run. No private account was automatically enabled for testing.
- Interactive simulator access remains unavailable through the UI control tool. Physical-device interaction is not verified by an archive or TestFlight availability.

This is the first connected-source increment. Calendar/mail observations, source-event subscriptions, memory-change-triggered reevaluation, semantic clustering across different meetings, and a coordinator that chooses urgent notifications remain future work. This version deliberately delivers suggestions quietly to For you and does not create new obligations from inferred interests.

Provider contract reference: [Granola MCP toolkit](https://docs.composio.dev/toolkits/granola_mcp).
