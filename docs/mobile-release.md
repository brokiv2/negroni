# Negroni iOS builds and TestFlight

The iOS project lives in `apps/mobile/ios`. It is committed to Git and opens in Xcode without an EAS build account. Expo still provides the React Native runtime and native modules; Xcode handles signing, archives, and App Store Connect uploads.

## Local development

Install JavaScript and CocoaPods dependencies from the repository root:

```sh
pnpm install
apps/mobile/Scripts/testflight_release.sh prepare
```

Open `apps/mobile/ios/Negroni.xcworkspace`. The `.xcodeproj` omits the Pods integration. The shared scheme is `Negroni`, and the iOS bundle identifier is `com.artempaskov.aisy` because TestFlight uses the former Aisy app record.

For a Debug build, start Metro in a second terminal:

```sh
pnpm --filter @rakazo/mobile start -- --localhost
```

Set the default physical-device server in the ignored `apps/mobile/.env.local` file before a Release build:

```sh
EXPO_PUBLIC_API_URL=http://your-mac.local:3100
```

The `.local` host name is more stable than a DHCP address and follows the same LAN-first principle as Remotto's Bonjour connection. The sign-in screen displays the active host and accepts a custom server URL if it needs to be changed. The API must listen on `0.0.0.0`; keep that port behind the local network or a private tunnel. If a VPN is active on the phone, it must allow local-network access.

## iOS push notifications

Negroni uses the native APNs device token on iOS and sends notifications directly from the API/worker host to Apple. Expo's push relay and an EAS project are not required. Enable Push Notifications for the App ID, then create an APNs authentication key in Apple Developer. Store the downloaded `.p8` outside the repository and configure both API and worker with:

```sh
APNS_KEY_ID=YOUR_KEY_ID
APNS_TEAM_ID=YOUR_TEAM_ID
APNS_TOPIC=com.example.negroni
APNS_PRIVATE_KEY_PATH=/absolute/private/path/AuthKey_YOUR_KEY_ID.p8
```

Release/TestFlight registrations use the production APNs endpoint; Debug device builds use the sandbox endpoint. The server stores up to eight current registrations per user and removes tokens that APNs reports as invalid. A notification permission grant by itself is not considered successful setup: the app must also obtain a device token and register it with the Negroni API.

## TestFlight

Update `expo.version` and `expo.ios.buildNumber` in `apps/mobile/app.json`, then run:

```sh
apps/mobile/Scripts/testflight_release.sh local
```

That command installs Pods, creates a signed archive, exports an IPA, and checks the bundle metadata, embedded JavaScript, configured API URL, desktop-matching icon source, signature, and App Store provisioning profile. Artifacts go to `build/TestFlight-com.artempaskov.aisy-build<build number>/`.

Upload the inspected archive with the Apple account signed into Xcode:

```sh
apps/mobile/Scripts/testflight_release.sh upload
```

For API-key uploads, keep the private identifiers and key path in the ignored `apps/mobile/.env.testflight.local` file:

```sh
ASC_KEY_ID=YOUR_KEY_ID
ASC_ISSUER_ID=YOUR_ISSUER_ID
ASC_KEY_PATH=/absolute/path/to/AuthKey_YOUR_KEY_ID.p8
```

`testflight` runs the local checks and upload in one command. App Store Connect still needs an app record for the bundle identifier and the usual TestFlight beta details. Keep signing keys, review credentials, server addresses, and account identifiers outside Git.

After App Store Connect confirms the uploaded build as `VALID`, run `VERIFIED_BUILD=<number> bash apps/mobile/Scripts/cleanup_local_builds.sh --apply` from the repository root. It keeps the confirmed archive/IPA and the nearest previous local release, and moves older Negroni build folders to Trash. The default `--dry-run` lists candidates first. Clean temporary simulator DerivedData with `xcodebuild clean` after QA; reuse `/tmp/Negroni-DerivedData-qa` for the next QA build. Do not empty the whole Trash as part of this step because it may contain unrelated files.

Before inviting testers, install the processed TestFlight build on a physical iPhone and check sign-in, bot messages, attachments, dictation, background notifications, account deletion, and reconnection after the Mac sleeps or changes networks.

## Apple ID and one shared Negroni account

Build 23 adds native Sign in with Apple to the iPhone app. Apple identifies each Apple ID by its signed, stable subject; display names and email addresses do not merge Negroni users. New Apple-only registration is disabled so an existing account and its chats cannot be bypassed by accidentally creating a blank account.

To connect an Apple ID, sign in to the existing Negroni account with email once, open Account → Apple ID → Connect this Apple ID, and complete Apple's native authorization sheet. Repeat while signed into the second Apple Account, usually on its own device. Both Apple identities then point to the same Negroni user and shared spaces, bots, and chat history. The Account screen shows the number of connected Apple IDs. Keep email sign-in available until both connections and subsequent sign-ins have been verified on physical devices.

The native flow uses a nonce and sends Apple's identity token to Better Auth for signature, issuer, audience, and nonce verification. The backend accepts explicit account linking from an authenticated session; a database uniqueness constraint prevents one Apple subject from belonging to two Negroni users. Web and Electron Apple sign-in require a separate Apple Services ID, private key, and public HTTPS callback. The existing localhost desktop flow does not offer a working Apple redirect until those are configured.

## Tablet, voice and stability changes (2026-09-05)

The mobile source now enables iPad support and rotation. At window widths of 768 points or more, chat screens show a sidebar for bots and groups. Smaller split-screen windows use the phone layout. Chat state is remounted when the selected conversation changes.

Stability changes:

- Attachment count and type checks happen before reading files into base64. Files load sequentially, so selecting a large collection no longer decodes every rejected attachment in parallel.
- Dictation guards against duplicate taps and late permission/transcription results, and stops when the chat loses focus or the app enters the background. The Expo hook retains responsibility for native recorder disposal.
- The root route has an error boundary with a retry action. This handles React rendering errors; native crashes and out-of-memory termination still require device diagnostics.
- Navigation uses resolved string colors instead of stringifying native PlatformColor objects. Embedded desktop views report WebKit renderer termination.
- Voice HTTP requests have cancellation and a 60-second deadline.

The phone button in a bot chat opens a hands-free voice call using the existing voice provider and bot thread. It detects a pause, transcribes the phrase, sends it to the bot, and speaks the reply. A provider supporting both transcription and synthesis must be configured in Voice settings. Calls retain the server and space captured at start. Approval requests return control to the chat. Ending the call stops audio and client requests; already submitted bot work remains in the chat.

This implementation uses sequential transcription, agent execution, and synthesis. During playback, the microphone is off and “Interrupt and speak” stops playback and resumes listening. It does not provide simultaneous full-duplex speech or voice-triggered interruption. Silence detection currently uses a fixed threshold, with a 1.1-second pause and 30-second maximum recording segment. Device testing should include speaker echo, quiet speech, headphones, incoming calls, network loss and locking the screen.

The Mac continuation produced build 19 using the existing native project and local release script. All 164 mobile tests, TypeScript and eight backend boundary tests passed. Signed archive/IPA creation, local inspection and Apple validation passed. TestFlight upload status and the detailed QA record are in [mobile-build19-validation.md](mobile-build19-validation.md).

During Release simulator QA, build 18 reproduced a background watchdog termination while Expo Audio was preparing the microphone. A pinned `expo-audio@57.0.4` patch removes blocking AVAudioRecorder property reads from lifecycle cleanup. Build 19 survived the same preparation/background/foreground sequence with the same process. The original build-17 device crash still has no confirmed cause.

The iPad portrait/landscape layout and chat switching were checked against isolated UI fixtures. Actual provider synthesis and transcription passed against the configured backend. Physical-device acceptance, narrow iPad windows and a complete hands-free voice conversation remain pending. The simulator's Brio 500 audio input still stalls during preparation; the watchdog fix does not claim to repair that host input problem.

Build 20 follow-up: recorder cleanup and playback explicitly preserve audio in silent mode. Voice runs use a persisted per-turn mode and the lowest supported model thinking effort, without changing ordinary chat preferences. Deploy the `20260905130000_voice_run_mode` migration and regenerate Prisma before restarting the backend. Details, measurements and the proposed streaming architecture are in [mobile-build20-voice.md](mobile-build20-voice.md).
