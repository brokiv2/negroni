import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { native, useThemedStyles } from "../lib/native";

type VoiceCatalogEntry = {
  id: string;
  name: string;
  description: string;
  transcribe: boolean;
};
type VoiceCredential = {
  id: string;
  provider: string;
};
type VoiceStatus = {
  provider: string | null;
};

export default function VoiceSettings() {
  const styles = useThemedStyles(createVoiceStyles);
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<VoiceCredential[]>([]);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (nextProvider?: string) => {
    const [nextCatalog, nextCredentials, nextStatus] = await Promise.all([
      rpc<VoiceCatalogEntry[]>("voice/catalog"),
      rpc<VoiceCredential[]>("voice/credentials"),
      rpc<VoiceStatus>("voice/status"),
    ]);
    const transcriptionCatalog = nextCatalog.filter((entry) => entry.transcribe);
    const selected = nextProvider || nextStatus.provider || transcriptionCatalog[0]?.id || "";
    setCatalog(transcriptionCatalog);
    setCredentials(nextCredentials);
    setProvider(selected);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load()
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "Could not load voice settings"),
        )
        .finally(() => setLoading(false));
    }, [load]),
  );

  const selected = catalog.find((entry) => entry.id === provider);
  const credential = credentials.find((entry) => entry.provider === provider);

  async function connect() {
    if (!selected || apiKey.trim().length < 8) return;
    setPending(true);
    setError(null);
    try {
      await rpc("voice/connect", {
        provider: selected.id,
        apiKey: apiKey.trim(),
      });
      setApiKey("");
      await load(selected.id);
      setNotice(`Connected ${selected.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color="#ECECEE" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Text style={styles.lede}>Connect a voice provider for dictation and voice calls.</Text>
        {catalog.map((entry) => {
          const connected = credentials.some((cred) => cred.provider === entry.id);
          return (
            <Pressable
              key={entry.id}
              onPress={() => {
                setProvider(entry.id);
                void load(entry.id).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "Could not load voice settings"),
                );
              }}
              style={[styles.card, provider === entry.id && styles.cardActive]}
            >
              <Text style={styles.cardTitle}>{entry.name}</Text>
              <Text style={styles.cardMeta}>{connected ? "Connected" : "Speech to text"}</Text>
            </Pressable>
          );
        })}
        {selected ? (
          <>
            <Text style={styles.help}>{selected.description}</Text>
            <TextInput
              accessibilityLabel="API key"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              importantForAutofill="no"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={credential ? "Paste a replacement key" : "Paste your API key"}
              placeholderTextColor="#6C6C70"
              secureTextEntry
              style={styles.input}
              textContentType="none"
            />
            <Pressable
              disabled={pending || apiKey.trim().length < 8}
              onPress={() => void connect()}
              style={[styles.button, (pending || apiKey.trim().length < 8) && styles.disabled]}
            >
              <Text style={styles.buttonLabel}>{credential ? "Replace key" : "Connect"}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createVoiceStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 10 },
    lede: { color: native.secondaryLabel, fontSize: 14, lineHeight: 20, marginBottom: 8 },
    error: { color: tokens.danger, marginBottom: 8 },
    notice: { color: tokens.successSoft, marginBottom: 8 },
    card: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tokens.border,
      padding: 14,
      backgroundColor: tokens.inset,
    },
    cardActive: { borderColor: tokens.scrollHover, backgroundColor: tokens.surface2 },
    cardTitle: { color: native.label, fontSize: 16 },
    cardMeta: { color: native.tertiaryLabel, marginTop: 4, fontSize: 12 },
    help: { color: native.secondaryLabel, fontSize: 13.5, lineHeight: 20, marginTop: 8 },
    input: {
      marginTop: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tokens.border,
      color: native.label,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    button: {
      marginTop: 8,
      backgroundColor: tokens.cream,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },
    disabled: { opacity: 0.4 },
    buttonLabel: { color: tokens.creamInk, fontWeight: "600" },
  });
}
