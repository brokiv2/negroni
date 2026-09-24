# Build 20: audible replies and faster voice turns

## Findings

The recent voice run completed successfully in 11.332 seconds, with 77 ms in the queue and a persisted text reply. The selected model was connected. Synthesis through the same bot's voice configuration also returned HTTP 200 and valid MPEG bytes.

The mobile recorder cleanup called `setAudioModeAsync({ allowsRecording: false })`. In Expo Audio 57.0.4, partial iOS mode arguments are passed directly to the native record, whose `playsInSilentMode` defaults to false. This switches playback back to an ambient audio category. It can mute replies when the phone's silent switch is enabled. This is a confirmed code path, but the user's actual switch position was not observed.

## Changes

- Recorder cleanup and each playback explicitly set `playsInSilentMode: true`, `allowsRecording: false`, `interruptionMode: doNotMix` and speaker routing. Playback no longer depends on the previous recorder's audio mode. Cleanup avoids a synchronous native `isRecording` query.
- A voice turn persists `interactionMode: voice` on its run. Ordinary chat retains its existing model preference. The runtime chooses the lowest supported thinking level for voice, including nested agents. Unknown OpenRouter reasoning endpoints retain a positive minimum to avoid the known rejection of effort `none`.
- Voice instructions ask for a prompt, concise spoken response in the user's language, without unnecessary research or delegation. Existing authorization and tool approval rules remain in force.
- The mobile client sends explicit voice intent. Build 19's existing `call-` nonce is recognized for compatibility, so the server improvement also applies to that client. Explicit chat intent takes precedence. A call cannot steer into an already running bot task.
- Migration `20260905130000_voice_run_mode` adds a defaulted column; existing runs remain chat runs. It was applied locally, and the managed backend was restarted after verifying there were no queued or running tasks.

## Verification

216 focused tests passed, including all 164 mobile tests, runtime effort selection, executor regression checks, mode persistence and busy-run isolation. Mobile, API and adapter TypeScript checks passed. The new dependency field required Prisma client generation; dependency versions were not upgraded.

Two synthetic, tools-free comparisons through the selected model returned:

| Run | Ordinary chat | Voice profile |
| --- | ---: | ---: |
| 1, total model time | 5.642 s | 4.466 s |
| 2, total model time | 5.275 s | 4.834 s |
| 2, first text | 4.559 s | 4.167 s |

These are small sequential samples, not a controlled latency benchmark or an end-to-end device measurement. The second sample still waits over four seconds for first text.

A separate synthetic bot exercised the running API, database, queue, worker, configured model and ElevenLabs synthesis. The voice-mode run completed, its mode was verified in the database, and the bot was archived afterward. Model/queue/polling took 5.621 s; synthesis took 0.759 s and returned 66,708 audio bytes; total was 6.379 s. No user conversation text was used in these synthetic checks. They exclude microphone capture, transcription, mobile networking and playback.

## Next architecture

The current implementation remains a sequential recording → transcription → agent task → synthesis → playback loop. Reducing thinking does not make that pipeline real-time.

Recommended next step: add an optional ElevenLabs Agents conversation transport through its React Native WebRTC SDK, with a fast conversational model and low supported reasoning. Keep Negroni's authorization, memory and tools behind its own backend boundary. Let the conversational agent acknowledge and dispatch long tasks to the existing worker, then deliver their results when ready. Inject only the context needed for the call; preserve per-space isolation and approvals. Keep the existing provider-neutral path available.

This requires a server-issued, short-lived conversation credential, native LiveKit/WebRTC dependencies, interrupted-playback handling, transcript reconciliation and physical-device tests. It is not enabled in build 20. Passing the same slow LLM through a custom endpoint would retain its time-to-first-text delay.

Official references, checked 2026-09-05:

- [ElevenLabs React Native SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react-native): Expo support and LiveKit/WebRTC dependencies.
- [Agent model configuration](https://elevenlabs.io/docs/eleven-agents/customization/llm): low reasoning effort for latency-sensitive voice agents.
- [Streaming audio](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming): overlap generated text and synthesized audio instead of waiting for entire responses.

## Remaining checks

Physical-device audibility, including silent mode, has not been verified in this session. Native recording, repeated turns, Bluetooth, speaker echo and interruptions retain the limitations documented for build 19. The simulator's Brio recording stall is not addressed by these changes. Native iPad layout is unchanged and was not re-tested for build 20. There is no full-duplex audio or voice-triggered interruption yet.

The existing Xcode workspace and untracked native project were preserved. Build 20 archive, export, IPA inspection and Apple validation passed. Upload succeeded. Apple build `2ba1f6b1-a87f-457b-8e3f-bc3c8ee19861` is `VALID`, exempt encryption is confirmed, and internal TestFlight state is `IN_BETA_TESTING`. External state is `READY_FOR_BETA_SUBMISSION`; external Beta Review has not been requested. The archive and IPA are in `build/TestFlight-com.artempaskov.aisy-build20/`; validation logs and synthetic benchmark evidence are in its ignored `qa/` directory. IPA SHA-256: `b5827d7a1db980918747f7c90a0fc2b1655fe8c78c3a4e9fe7d848958c5dc8a3`.

Upload repeated the build-19 warnings about missing dSYMs for the prebuilt React, ReactNativeDependencies and hermesvm frameworks. The app dSYM is present; complete third-party framework symbolication is not assured.
