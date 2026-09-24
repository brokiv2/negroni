# Negroni mobile continuation: build 18

## Objective

Finish and validate the existing mobile changes in PROJECTS/Sandbox/negroni on the Mac that produced the previous TestFlight releases. Use the existing local Xcode/TestFlight pipeline. Keep the current native project and signing configuration.

Read the repository instructions, docs/mobile-release.md, apps/mobile/Scripts/testflight_release.sh, and the current diff before changing anything. Changes are in the shared working tree, including new untracked files. Wait for iCloud to download them; do not reset, clean, or replace the checkout with a fresh clone.

## What is already implemented

- apps/mobile/app.json: tablet support, rotation, proposed iOS build number 18.
- components/tablet-shell.tsx: sidebar for bots and groups at widths >=768 points, selected-chat highlight. Smaller windows use the phone layout.
- app/thread.tsx: call button, conversation remount on identity change, dictation lifecycle guards and background cleanup.
- app/call.tsx and lib/call-{audio,session,turn}.ts: automatic speech turns, existing bot thread/context, synthesis, button interruption, hangup/background cancellation. Voice provider credentials remain on the existing backend.
- lib/voice.ts: bounded and cancellable voice requests with captured server/space context.
- lib/pick-attachments.ts: count/type limits before reading files; sequential reads to avoid decoding arbitrarily many attachments at once.
- app/_layout.tsx: render error boundary and string navigation colors.
- app/computer.tsx: WebView process-termination callbacks.
- Tests in lib/call-*.test.ts, lib/pick-attachments-loading.test.ts, and adjustments to existing tests.

## Evidence and limits

158 mobile tests and TypeScript passed in a temporary copy with downloaded dependencies. The latest iOS JavaScript/Hermes bundle exported. Temporary prebuild produced version 18, device families 1,2 and iPad orientations. Repeat checks against this Mac's actual locked dependencies.

A native simulator Release build did not pass on the other environment's Xcode 26.0.1: ExpoModulesJSI Swift sources require a newer compiler. The earlier .run/testflight-build15.log shows the iOS 26.5 SDK. This is a build-environment failure, not a confirmed cause of the reported device crash. Experimental dependency edits remained only in that environment's /tmp directory; do not reproduce them.

The original apps/mobile/ios and Scripts directories were iCloud placeholders and were not modified in that environment. Consequently, app.json changes still need to be propagated to the existing native project.

The reported crash on fresh build 17 has not been reproduced. Requesting a cable is not useful: the user cannot connect the iPad. Inspect any existing Xcode Organizer/TestFlight crash reports available through the established account, and reproduce startup and navigation in Release on simulators/devices available on this Mac.

## Work to complete

1. Confirm the shared source and all new files have downloaded. Inspect the diff without discarding earlier unrelated work. Use the existing package lock, patches, native project and release script. Confirm the selected Xcode version matches the previously successful toolchain.
2. Apply tablet support and rotation to the existing Xcode project. Check TARGETED_DEVICE_FAMILY=1,2, iPad orientations, iPad multitasking, and a currently unused build number (18 is only proposed). Preserve bundle ID, signing, APNs entitlements, deployment target, icons and embedded server configuration. Do not blindly regenerate the native project with Expo prebuild; first inspect whether the established script uses it and preserves customizations.
3. Run mobile TypeScript/tests and build the actual native Release target. Follow the existing testflight_release.sh local workflow after reading it. Fix any errors in project source or the established build configuration, then repeat affected checks.
4. Verify launch, authentication, inbox and switching chats on iPhone and iPad; iPad portrait/landscape and narrow split-screen; attachments including excess selections; dictation start/stop, denied permission, rapid taps, navigating away and backgrounding. Confirm rendering failures are recoverable. Do not describe the build-17 crash as fixed without evidence.
5. Test a voice conversation using the already configured provider: multiple automatic turns, bot response playback completion, button interruption, hangup during microphone preparation/transcription/playback, network failure and backgrounding. Check that approval requests return to chat and that late responses cannot enter another conversation. Do not copy provider keys into the client or logs.
6. Review the resulting diff, create and validate the signed archive/IPA through the existing local release pipeline, and report the build number and validation results. A successful JavaScript export alone is not an installable or tested iOS release. Do not submit to App Store review.

## Voice scope

The current implementation chains transcription, bot execution and synthesis. It is hands-free between turns but pauses the microphone during playback; interruption is a button. Full-duplex speech and voice-triggered interruption comparable to ChatGPT are not implemented. State this accurately. If continuing toward that part of the user's original request, design and test an actual streaming audio path while retaining the same bot identity, history, tools and approval rules; do not label the current turn-based path as full realtime.
