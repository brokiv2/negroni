# Mobile build 19 validation (2026-09-05)

Status: build 19 signed archive, IPA inspection, Apple validation and native watchdog regression check passed. Apple processing is `VALID`, exempt encryption is confirmed, and the internal TestFlight state is `IN_BETA_TESTING`. External state is `READY_FOR_BETA_SUBMISSION`; build 19 has not been submitted for external Beta Review. Build 18 upload was interrupted before delivery after a native watchdog termination was reproduced. Do not release the build 18 archive.

## Source and release configuration

The shared checkout, untracked mobile files and native Xcode project were retained. A backup of the original diff and mobile/native sources is outside iCloud at `~/.codex/tmp/negroni-build18-backup/`. No reset, clean, clone, Expo prebuild or dependency upgrade was used. The native project remains untracked in the existing checkout; do not lose it when moving or committing this work.

The existing `Negroni.xcworkspace`, `Negroni` scheme and `Scripts/testflight_release.sh` produced the archive. Xcode is 26.6 (17F113), with the iOS 26.5 SDK. Dependency installation with the frozen lockfile used Node 24.19.0 because the default Node 24.13.0 is below a locked dependency's engine requirement.

Version is 1.0.0 (19). Bundle identity, signing team, APNs entitlements, deployment target 16.4, icons and embedded server configuration were preserved. Both native configurations target device families 1 and 2. The existing Info.plist enables all four orientations for iPad and permits multitasking.

The release inspector now checks iPad families, orientations and multitasking. Voice bundle checks match the shared voice-request URL construction and the call playback controls. Its former prohibition on speech synthesis contradicted the new call feature.

## Reproduced native failure

Build 18 on the iPhone simulator hung while preparing the microphone. Sending it to the background produced a native `SIGKILL`, namespace `FRONTBOARD`, code `0x8BADF00D`, after a 10-second scene-update watchdog deadline.

The main-thread stack was:

```
AVAudioRecorder.isRecording
AudioRecorder.isRecording.getter
AudioModule.pauseAllRecorders()
AudioModule OnAppEntersBackground
UIApplication._applicationDidEnterBackground
```

Another thread was inside `AVAudioRecorder.prepareToRecord`, waiting on the host CoreAudio input device. The lifecycle callback waited for that recorder's internal lock on the main thread. This is evidence for this reproduced simulator failure; it does not establish the cause of the earlier build-17 device report.

`patches/expo-audio@57.0.4.patch` removes the blocking recorder-property reads from native pause/resume and audio-mode cleanup. It uses the existing `pauseRecording`, `startRecording` and `stopRecording` methods, which check the recorder's cached state. The package version remains 57.0.4; package.json and the lockfile pin the patch. Dictation cleanup calls asynchronous stop without first querying the synchronous native `isRecording` property.

The build-19 regression run reproduced the same pending native `prepareToRecord` call, then entered the background and returned to the chat. The process ID remained unchanged beyond the former 10-second watchdog deadline, no new crash report appeared, and a post-return sample showed the main thread free of the blocking recorder getter. The native microphone preparation itself remained stalled. After cancellation and return, navigation from the inbox to another bot worked in the same process.

Other continuation fixes cancel dictation HTTP work on blur/background, capture the server and space at recording start, suppress stale errors and cancel a voice call when its route loses focus.

## Checks completed

- Frozen dependency installation; all 164 mobile unit tests; mobile TypeScript.
- Eight backend tests covering voice authorization and the existing public-tunnel boundary.
- Native Release builds for iOS and the simulator. Simulator Keychain checks require normal Xcode simulator signing; an unsigned simulator build could not save SecureStore state and was replaced with an ad-hoc signed build.
- Build 19 IPA inspection and Apple validation passed, including signature, distribution profile, production APNs, exempt encryption, device families and orientations.
- Actual configured ElevenLabs provider, through the existing authenticated backend: synthetic speech returned HTTP 200 and 26,584 bytes of MPEG audio; transcription returned the exact synthetic sentence, "This is a Negroni voice test. One, two, three."
- Native iPhone UI on an isolated loopback fixture with fictional accounts/chats: server selection, fixture sign-in, session persistence after relaunch, inbox, opening a bot chat and a denied-microphone error without termination.
- Native iPad UI on the same fixture: portrait and landscape, selected sidebar row, switching between two bots and a group, and the bot call screen.
- React error boundary: a missing field in fixture data produced the recovery screen; after correcting the fixture, Try again restored the inbox without restarting the app.

The fixture tests do not verify real-account sign-in or real bot execution. Provider HTTP checks do not verify microphone capture, audio playback or an end-to-end phone call.

## Remaining limits

The physical iPad Pro is reachable wirelessly but remained passcode-locked; no cable was requested. No build-19 physical-device installation or acceptance test has been performed. App Store Connect crash-feedback access returned HTTP 403, and no original build-17 native crash report was available.

Microphone preparation stalled with the simulator's host Brio 500 audio input. A subsequent call reached Listening, but native `AVAudioRecorder.record` / `AudioQueueStart` then blocked the JavaScript call thread while waiting on CoreAudio. End call did not complete in that state, although the main thread remained free. Successful native call startup and hangup therefore cannot be claimed. The patch addresses the reproduced main-thread watchdog path; preparation and recording-start stalls remain unresolved in this simulator environment and have not been assessed on a physical device. Successful recording/transcription in the native UI, multiple automatic voice turns, playback completion, speaker echo, quiet speech, headphones, incoming calls, lock-screen behavior and real-network interruptions remain unverified on a physical device. Rapid taps, cancellation, playback interruption, request deadlines, approval handling and run/context isolation have deterministic test coverage, but those tests do not replace device checks.

Actual narrow iPad window/Split View behavior was not verified. Portrait and landscape are visually checked; the width breakpoint is 768 points. Excess attachment selections are covered by offline loading/count/type tests; native Files/Photos selection and memory pressure still need device checks. WebView process-termination callbacks were reviewed but not triggered in the simulator.

Calls chain transcription, bot execution and synthesis. The microphone pauses during playback, and interruption uses a button. Full-duplex audio and voice-triggered interruption are not implemented. Already submitted bot work can continue in the chat after a call ends.

## Delivery artifacts

The signed archive and exported IPA are in `build/TestFlight-com.artempaskov.aisy-build19/`. The IPA SHA-256 is `68403f648c896800eee0c3ce91f7fdadbc89fab915971150a776c2f3435d12d8`. The ignored `qa/` directory contains validation logs, simulator captures, native samples and the Apple processing result. Build-18 captures cover the detailed iPad portrait/landscape and call layout checks; a build-19 capture confirms the final native iPad inbox launch.

Apple build ID: `9d529e8b-821d-473f-bc31-2256613b7731`. Internal availability was verified through App Store Connect's build beta detail after processing.

Upload succeeded with warnings about missing dSYMs for the prebuilt React, ReactNativeDependencies and hermesvm frameworks. The app dSYM is present, but full symbolication within those frameworks is not assured.
