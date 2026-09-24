# Negroni 1.0.0 (25) — UX pass, 2026-09-24

## Delivered changes

- Chat composer and typography aligned to the supplied Grok references: system fonts, separate attachment control, capsule input, dictation, voice and send states; recording timer and level meter.
- Workspace navigation moved out of the conversation footer. Personal provides For you, Goals, Ideas, Activity and Memory, backed by existing account data and the shared agent hierarchy.
- Opaque mobile action sheets replace overlapping chat-management menus. Settings group common preferences and collapse credential forms.
- Personal discussion actions preserve drafts and open the correct agent/group. Desktop chat retains reading position across Personal navigation and scrolls to the latest message on first reveal.
- Expired mobile sessions show a recovery action instead of an unexplained RPC error; existing authentication storage is preserved.

## Verification

- Desktop installed application: real account, light/dark themes, Personal feed, correct child-agent activity navigation, draft retention, Markdown preview, scroll retention, composer and Settings. No test messages sent or account content changed.
- Mobile simulator: synthetic read-only fixture used because the pre-existing simulator session is expired against the real server. This is not physical-device or production-account mobile acceptance.
- Web unit suite: 173 tests passed in 30 files. Mobile/web TypeScript checks passed. Focused keyboard/platform/hierarchy/presentation/error tests passed.
- Initial build 25 archive/export/signature/resource inspection and Apple validation passed. Final release/upload evidence is recorded below once completed.

## Remaining device checks

Physical iPhone microphone/dictation/live voice, iPad presentation, Android device behavior and fresh Apple sign-in were not verified in this pass. The design uses the supplied Grok references and researched Muse interaction patterns; no official reusable Grok/Muse UI kit was found.

## Final archive

- `build/TestFlight-com.artempaskov.aisy-build25-attempt2/Negroni.xcarchive` and `export/Negroni.ipa` are the final artifacts.
- Fixed the signed safe-area offset in `KeyboardStickyView`: its transform adds `opened` to the negative keyboard height. Positive bottom inset now matches the chat scroll view's `keyboardHeight - bottomInset` lift; the previous negative value created a two-inset mismatch.
- Final archive, export, IPA inspection and mobile TypeScript passed. Apple validation returned `VERIFY SUCCEEDED with no errors` at 18:27 local time.
- Simulator showed the latest reply clear of the composer after the offset change. Drag-dismiss acceptance remains unverified because Simulator/CUA gestures did not reliably apply; software/hardware keyboard toggling also produced inconsistent frames. Do not treat this as physical-iPhone keyboard QA.
- Temporary fixture and fixture-configured Metro were stopped. Ordinary Metro was restarted without the fixture endpoint override, preserving SecureStore/authentication. Test input was not sent.
- Upload completed successfully (`Uploaded Negroni`, `EXPORT SUCCEEDED`). Apple emitted non-blocking missing-dSYM warnings for prebuilt ReactNativeDependencies and Hermes frameworks; this limits symbolication for those dependencies, not installation.
- After restoring the ordinary endpoint, the simulator visibly showed `Your session has expired` with a `Sign in again` action. No fixture content remained in the displayed account view.

## TestFlight acceptance

- App Store Connect build ID: `2e514635-292f-482b-8d42-513c8fe8e4a9`.
- Build `25`: `VALID`; internal testing: `IN_BETA_TESTING`; auto-notify enabled. External testing is `READY_FOR_BETA_SUBMISSION`, not externally released.
- Own Release DerivedData cleaned successfully via `xcodebuild clean`; roughly 2 GiB reclaimed in the final cleanup, about 20 GiB available afterward (below the desired 40 GiB target). Current and preceding release archives retained.
