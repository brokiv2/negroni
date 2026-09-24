import {
  AudioModule,
  type AudioPlayer,
  type AudioRecorder,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { CallTurnDetector, callDelay, checkCallActive } from "./call-turn";

export async function requestCallMicrophone(signal: AbortSignal) {
  const permission = await requestRecordingPermissionsAsync();
  checkCallActive(signal);
  if (!permission.granted) throw new Error("Enable microphone access in Settings to call a bot.");
}

export async function recordCallTurn(signal: AbortSignal): Promise<string | null> {
  checkCallActive(signal);
  let recorder: AudioRecorder | null = null;
  let keep = false;
  let stopped = false;
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
    checkCallActive(signal);
    const preset = RecordingPresets.HIGH_QUALITY;
    recorder = new AudioModule.AudioRecorder({
      ...preset,
      ...(Platform.OS === "ios"
        ? preset.ios
        : Platform.OS === "android"
          ? preset.android
          : preset.web),
      numberOfChannels: 1,
      isMeteringEnabled: true,
    });
    await recorder.prepareToRecordAsync();
    checkCallActive(signal);
    recorder.record();
    const detector = new CallTurnDetector();
    const started = Date.now();
    while (true) {
      await callDelay(100, signal);
      const status = recorder.getStatus();
      if (!status.isRecording) throw new Error("Microphone interrupted. Start the call again.");
      const action = detector.sample(Date.now() - started, status.metering);
      if (action === "listen") continue;
      await recorder.stop();
      stopped = true;
      checkCallActive(signal);
      keep = action === "send";
      return keep ? recorder.uri : null;
    }
  } finally {
    try {
      if (recorder && !stopped) await recorder.stop();
    } catch {
      /* Already stopped by iOS. */
    }
    const uri = recorder?.uri;
    recorder?.release();
    if (!keep && uri) {
      try {
        new File(uri).delete();
      } catch {
        /* Temporary file. */
      }
    }
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }
}

export async function playCallAudio(
  bytes: Uint8Array,
  signal: AbortSignal,
  mimeType = "audio/mpeg",
) {
  checkCallActive(signal);
  const extension = mimeType.includes("wav")
    ? "wav"
    : mimeType.includes("mp4") || mimeType.includes("aac")
      ? "m4a"
      : "mp3";
  const file = new File(
    Paths.cache,
    `call-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
  );
  let player: AudioPlayer | null = null;
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldRouteThroughEarpiece: false,
    });
    checkCallActive(signal);
    file.write(bytes);
    player = createAudioPlayer(file.uri);
    const currentPlayer = player;
    await new Promise<void>((resolve, reject) => {
      let subscription: { remove(): void } | undefined;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        subscription?.remove();
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new Error("Call ended"));
      const timer = setTimeout(() => finish(new Error("Audio playback timed out.")), 120_000);
      subscription = currentPlayer.addListener("playbackStatusUpdate", (status) => {
        // didJustFinish is emitted as an event; the currentStatus getter always returns false.
        if (status.didJustFinish) finish();
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else {
        try {
          currentPlayer.play();
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Could not play audio."));
        }
      }
    });
  } finally {
    player?.remove();
    try {
      file.delete();
    } catch {
      /* Temporary file. */
    }
  }
}
