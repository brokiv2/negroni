import type { FeedProfile } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { rpc } from "../../lib/api";
import { Button } from "./kit";
import { colors, s } from "./theme";
export function FeedSettings() {
  const [profile, setProfile] = useState<FeedProfile | null>(null);
  const [topic, setTopic] = useState("");
  const [domains, setDomains] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void rpc<FeedProfile>("feed/profile", {}, { signal: abort.signal })
      .then((p) => {
        if (!abort.signal.aborted) {
          setProfile(p);
          setDomains(p.sourceDomains.join(", "));
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Could not load settings.");
      });
    return () => abort.abort();
  }, []);
  async function apply(method: string, input: unknown) {
    setBusy(true);
    setError("");
    try {
      setProfile(await rpc<FeedProfile>(method, input));
    } catch {
      setError("Could not save. Check the values and retry.");
    } finally {
      setBusy(false);
    }
  }
  const inputStyle = {
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    minHeight: 44,
  };
  return (
    <View style={{ gap: 12 }}>
      {!!error && (
        <Text accessibilityRole="alert" style={s.text}>
          {error}
        </Text>
      )}
      {profile && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={[s.text, { flex: 1 }]}>Learn interests from conversations</Text>
            <Switch
              accessibilityLabel="Learn interests from conversations"
              disabled={busy}
              value={profile.learningEnabled}
              onValueChange={(value) => void apply("feed/configure", { learningEnabled: value })}
            />
          </View>
          <TextInput
            accessibilityLabel="Add a feed topic"
            placeholder="Add a topic"
            placeholderTextColor={colors.muted}
            style={inputStyle}
            value={topic}
            onChangeText={setTopic}
            maxLength={100}
          />
          <Button
            disabled={busy || !topic.trim()}
            onPress={() =>
              void apply("feed/interest", { topic: topic.trim(), action: "follow" }).then(() =>
                setTopic(""),
              )
            }
          >
            Follow
          </Button>
          {profile.interests.map((i) => (
            <View key={i.topic} style={{ gap: 8 }}>
              <Text style={s.text}>
                {i.topic} ·{" "}
                {i.origin === "explicit"
                  ? "Following"
                  : i.evidenceIds.length >= 2
                    ? "Learned"
                    : "Candidate"}
              </Text>
              <Text style={s.muted}>{i.reason}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  small
                  disabled={busy}
                  onPress={() => void apply("feed/interest", { topic: i.topic, action: "exclude" })}
                >
                  Exclude
                </Button>
                <Button
                  small
                  disabled={busy}
                  onPress={() => void apply("feed/interest", { topic: i.topic, action: "forget" })}
                >
                  Forget
                </Button>
              </View>
            </View>
          ))}
          {profile.excludedTopics.map((topic) => (
            <View key={topic} style={{ gap: 6 }}>
              <Text style={s.text}>{topic} · Excluded</Text>
              <Button
                small
                disabled={busy}
                onPress={() => void apply("feed/interest", { topic, action: "follow" })}
              >
                Follow again
              </Button>
            </View>
          ))}
          <Text style={s.text}>Sources (domains, optional)</Text>
          <TextInput
            accessibilityLabel="Source domains"
            style={inputStyle}
            value={domains}
            onChangeText={setDomains}
            autoCapitalize="none"
            placeholder="example.com, another.org"
            placeholderTextColor={colors.muted}
          />
          <Button
            disabled={busy}
            onPress={() =>
              void apply("feed/configure", {
                sourceDomains: domains
                  .split(",")
                  .map((v) => v.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
          >
            Save sources
          </Button>
          <Text style={s.text}>Articles per collection: {profile.maxItems}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 3, 5, 10].map((n) => (
              <Button
                small
                key={n}
                disabled={busy || n === profile.maxItems}
                onPress={() => void apply("feed/configure", { maxItems: n })}
              >
                {n}
              </Button>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
