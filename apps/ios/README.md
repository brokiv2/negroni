# Native iOS client

Negroni for iOS is a Swift/UIKit application. The app target has no React Native, Expo, Hermes or JavaScript application bundle. It uses the existing backend RPC contracts and streaming protocol; agent execution remains on the configured server. Android and the previous iOS implementation remain in `apps/mobile`.

The interface uses UIKit navigation and tab bars, native text selection, document and photo pickers, Keychain sessions, Sign in with Apple and APNs. The composer uses `keyboardLayoutGuide` and AVFoundation recording. On supported iOS versions the tab bar and recording controls use system Liquid Glass. Embedded X posts are isolated article content in a nonpersistent WKWebView, loaded only on request.

Colors, avatar geometry and AI-sharing disclosures are generated from the shared packages. The main mascot and AppIcon are the existing product assets. `Scripts/generate-theme.mjs` regenerates the shared source derivatives.

## Develop

Requires Xcode with the iOS 26 SDK, XcodeGen, Node.js and Python 3. Deployment target is iOS 17.

```sh
NEGRONI_API_URL=http://127.0.0.1:3100 apps/ios/Scripts/prepare.sh
open apps/ios/Negroni.xcodeproj
swift test --package-path apps/ios/Core
```

The generated project and `.build-config/ClientConfiguration.plist` are ignored. Never commit a private backend URL, tunnel credential, signing configuration or session. `NEGRONI_TUNNEL_KEY` is optional and is sent only to the configured gateway. Existing mobile sessions migrate from Keychain without deleting the legacy session.

## TestFlight

`Scripts/testflight_release.sh` builds the UIKit project. It reads signing credentials from an ignored `PRIVATE_RELEASE_CONFIG`, and the gateway from `NEGRONI_API_URL` or the adjacent legacy `.env.local`. Set `TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH` in private configuration. The tunnel credential can come from the existing Keychain item.

```sh
apps/ios/Scripts/testflight_release.sh local
apps/ios/Scripts/testflight_release.sh validate
apps/ios/Scripts/testflight_release.sh upload
```

Use `BUILD_NUMBER` and a fresh `OUTPUT_DIR` for subsequent releases. Before upload, the script checks the version, production HTTPS gateway, icon, store provisioning, APNs and Apple sign-in entitlements, encryption declaration, original mascot and absence of cross-platform runtimes. Apple processing and beta availability must be verified separately after delivery.

## Chat and documents

SSE frames are decoded from raw bytes: Foundation's `AsyncBytes.lines` strips the blank delimiters. The visible chat reconciles after foreground pushes, on reconnect and periodically while a run is active. Assistant identity is refreshed independently of computer health when returning to chat.

Foreground notifications still trigger reconciliation, but show no banner or notification-list entry when their thread and space match the chat in the active scene. The visible controller is resolved through native navigation, including presented sheets; other conversations and background delivery retain normal notifications. Offline notification tests cover matching and different threads/spaces, background state, an absent chat and incomplete payloads.

Document uploads and downloads use authenticated binary endpoints and file-backed URLSession transfers. The client reads the server's file budget (currently 512 MiB); Office, Keynote, ODP, PDFs and supported text/archive formats share the backend MIME registry. The legacy JSON transport has its own smaller budget and does not determine native upload capacity. Connecting a personal model key authorizes that provider; explicit revocations remain effective.

## Verification boundaries

Offline tests cover RPC values, endpoint validation, raw streaming frame parsing, message reconciliation and dictation draft preservation. A live isolated-server check reproduces the old missing-delimiter failure and verifies decoded events, completed scripted replies in the open simulator chat, and refreshed assistant identity. A 27 MB PPTX upload/download round trip verifies matching hashes and agent workspace materialization; authorization and interrupted-stream cleanup are tested separately. Simulator review covers readable selectable messages, model menus, feed images, original team avatars, and the recording/edit flow. The isolated dictation test server returns a fixture transcript; this does not verify an external transcription provider.

Build 32 simulator checks inject system notifications with permission enabled: the visible conversation stays silent, another conversation displays a banner, and background delivery displays a banner. A scripted response also appears in the open chat without navigating away and clears the running composer state. These checks do not establish which build is installed on a physical device or resolve an unconfirmed device-only recurrence.

Physical-device microphone quality, keyboard gestures, APNs delivery, subscription-provider OAuth and remote screen sharing require separate live checks. Computer status reports server availability; it does not claim screen-control capability. There is no native remote-desktop viewer in this client yet.

## Build 33 interaction updates

Sending inserts a local message and starts the avatar/dot working indicator before the network request. Server receipts reconcile local messages without duplicating them; an unsuccessful send restores its text and attachments. A failed refresh after an accepted send does not restore the draft. The indicator respects Reduce Motion.

Team includes the personal assistant and opens its existing personal conversation. Group and article chats expose the shared enabled model pool, remember the local selection per space/thread and pass it with new runs. Existing running responses keep their chosen model; changes apply to the next new run. Auto classification failures fall back to the configured workload default, while cancellation remains cancellation.

Feed cards and article content render Markdown headings, inline emphasis, links, lists, quotes and code. Cards offer Save/Hide menus and a Hide swipe; automation rows offer Delete swipes. Connected accounts have tap menus, long-press menus and Delete swipes. Disconnected records can be removed; active accounts are disconnected first. New connections start authorization directly and use provider identity metadata when available; Rename remains optional. Catalog vector logos are rasterized by the backend with external references disabled, without fetching account lists for each icon.

Build 33 verification: 10 offline Swift tests cover optimistic reconciliation, working state, Markdown blocks and notification routing; the native simulator build and Store archive/export pass. Isolated API/database checks verify removal only after disconnection and a completed group run using an explicit model. The actual catalog Gmail SVG converts to PNG. The current computer-use bridge could not access the simulator, so the new screens and animations have not received an interactive visual pass. Physical-device OAuth identity, gestures and push behavior remain to be verified after delivery.

Build 33 passed Apple validation and upload on 2026-09-29. App Store Connect reports PROCESSING with no upload errors or warnings; beta availability is not yet confirmed. The backend changes are installed and the public mobile gateway health and connector PNG endpoint pass. Focused server tests pass 167 cases.
