# Native build 36: chat layout and contextual connections

Assistant replies use the conversation canvas instead of full-width grey bubbles. User messages retain their bubble; text margins, paragraph spacing and the list insets are tighter. Viewport changes keep a conversation already at the bottom anchored above the keyboard. Text selection, Markdown and native tool activity remain available.

The agent has `search_apps` and `request_app_connection`. They consult configured managed connector catalogs and publish the existing `app_connect` message format. Only a current user/follow-up turn can propose authorization; background work cannot generate these cards. Names, logos and provider identifiers come from the catalog, not model-supplied authorization URLs. Duplicate requests within a run share a durable message nonce. Connected accounts are reused.

UIKit renders the card with a service icon and **Connect** action. Chat and Settings use the same native sheet and `ASWebAuthenticationSession`, without requesting a manual account name. Server completion must report `connected` before continuation. Cancel returns to the sheet; errors leave a retry. After connection, a stable send nonce resumes the original question using its reply target and preserves the current composer draft and attachments. Group continuations mention the assistant that requested the connection.

Visible copy: **Connect**, **Connecting…**, **Connected**, **Continue**, **Connection cancelled.**, **Try again**. These labels show only in the relevant card/sheet. Connection state uses actual connected-account records and refreshes after authorization. A connected request card remains openable to recover an interrupted continuation; replaying it cannot enqueue the same continuation twice.

Validation:

- 167 deterministic adapter/API checks cover connector discovery, exact provider identity, unavailable catalogs, background gating, executor behavior and connection callback regressions.
- One PostgreSQL workflow test exercises a real queued run, duplicate proposals, OAuth emulator completion and idempotent continuation with an explicit reply target.
- 12 Swift core tests include card visibility and continuation identity/group routing.
- Native simulator compilation and device archive/export succeed. Release IPA inspection confirms UIKit, build 36, production gateway, Store profile and encryption declaration.
- Live read-only catalog lookup confirms an available Granola connector. No real account authorization was performed for QA.
- Interactive simulator review could not run because the native UI control tool failed to access the surface. Physical-device keyboard, layout and OAuth return behavior remain unverified.

The web client already renders `app_connect` cards. Automatic continuation in this change is native iOS; web users can connect through the existing card and continue in chat.
