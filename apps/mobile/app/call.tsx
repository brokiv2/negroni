import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { captureApiRequestContext, rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { playCallAudio, recordCallTurn, requestCallMicrophone } from "../lib/call-audio";
import { sendCallTurn } from "../lib/call-session";
import { checkCallActive } from "../lib/call-turn";
import { useResolvedAppearance } from "../lib/native";
import { synthesizeCallSpeech, transcribeRecording } from "../lib/voice";

type Phase = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "ending";
const labels: Record<Phase, string> = {
  ready: "Ready to call",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  ending: "Ending call…",
};

export default function VoiceCall() {
  useResolvedAppearance();
  const tokens = mobileTokens();
  const router = useRouter();
  const params = useLocalSearchParams<{ botId?: string; name?: string }>();
  const botId = typeof params.botId === "string" ? params.botId : "";
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const active = useRef<AbortController | null>(null);
  const playback = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        active.current?.abort();
        playback.current?.abort();
      }
    });
    return () => {
      mounted.current = false;
      active.current?.abort();
      playback.current?.abort();
      sub.remove();
    };
  }, []);

  useFocusEffect(useCallback(() => () => {
    active.current?.abort();
    playback.current?.abort();
  }, [botId]));

  async function start() {
    if (active.current || !botId) return;
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    setPhase("connecting");
    setError(null);
    try {
      const context = await captureApiRequestContext();
      checkCallActive(signal);
      const options = { requestContext: context, signal };
      const status = await rpc<{ ready: boolean; transcribe: boolean }>(
        "voice/status",
        {},
        options,
      );
      if (!status.ready || !status.transcribe)
        throw new Error(
          "Connect a voice provider with speech recognition and a voice in Voice settings.",
        );
      checkCallActive(signal);
      await requestCallMicrophone(signal);
      while (!signal.aborted) {
        setPhase("listening");
        const uri = await recordCallTurn(signal);
        if (!uri) continue;
        setPhase("thinking");
        const spoken = await transcribeRecording(uri, options);
        checkCallActive(signal);
        if (!spoken) continue;
        setTranscript(spoken);
        setReply("");
        const utterances = await sendCallTurn(botId, spoken, context, signal);
        checkCallActive(signal);
        setReply(utterances.join(" "));
        setPhase("speaking");
        const audioController = new AbortController();
        playback.current = audioController;
        const abortAudio = () => audioController.abort();
        signal.addEventListener("abort", abortAudio, { once: true });
        try {
          for (const utterance of utterances) {
            const clip = await synthesizeCallSpeech(utterance, botId, {
              requestContext: context,
              signal: audioController.signal,
            });
            await playCallAudio(clip.bytes, audioController.signal, clip.mimeType);
          }
        } catch (err) {
          if (!audioController.signal.aborted) throw err;
        } finally {
          signal.removeEventListener("abort", abortAudio);
          playback.current = null;
        }
      }
    } catch (err) {
      if (!signal.aborted && mounted.current)
        setError(err instanceof Error ? err.message : "Call failed");
    } finally {
      active.current = null;
      if (mounted.current) setPhase("ready");
    }
  }

  function end() {
    setPhase("ending");
    active.current?.abort();
    playback.current?.abort();
  }
  const buttonStyle = { padding: 18, borderRadius: 28, backgroundColor: tokens.surface2 };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.page }} edges={["bottom"]}>
      <View
        style={{ flex: 1, width: "100%", maxWidth: 680, alignSelf: "center", padding: 28, gap: 24 }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            active.current?.abort();
            playback.current?.abort();
            router.back();
          }}
        >
          <Text style={{ color: tokens.muted }}>Back to chat</Text>
        </Pressable>
        <Text style={{ color: tokens.ink, fontSize: 30, textAlign: "center" }}>
          {params.name || "Bot"}
        </Text>
        <View
          accessibilityLiveRegion="polite"
          style={{
            alignSelf: "center",
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: phase === "listening" ? "#2965EC" : tokens.surface2,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: phase === "listening" ? "#FFFFFF" : tokens.ink, fontSize: 19 }}>
            {labels[phase]}
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 18 }}>
          {transcript ? (
            <Text style={{ color: tokens.muted, fontSize: 17 }}>{transcript}</Text>
          ) : null}
          {reply ? (
            <Text style={{ color: tokens.ink, fontSize: 19, lineHeight: 28 }}>{reply}</Text>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: tokens.ink, fontSize: 16 }}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
        {phase === "speaking" ? (
          <Pressable
            accessibilityRole="button"
            style={buttonStyle}
            onPress={() => playback.current?.abort()}
          >
            <Text style={{ color: tokens.ink, textAlign: "center" }}>Interrupt and speak</Text>
          </Pressable>
        ) : null}
        {phase === "ready" ? (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={!botId}
              style={buttonStyle}
              onPress={() => void start()}
            >
              <Text style={{ color: tokens.ink, textAlign: "center" }}>Start call</Text>
            </Pressable>
            {error ? (
              <Pressable accessibilityRole="button" onPress={() => router.push("/voice")}>
                <Text style={{ color: tokens.muted, textAlign: "center" }}>Voice settings</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={phase === "ending"}
            style={{ ...buttonStyle, backgroundColor: "#B73535" }}
            onPress={end}
          >
            <Text style={{ color: "#FFFFFF", textAlign: "center" }}>End call</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}
