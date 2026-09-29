import { ChatMarkdown } from "@rakazo/chat-ui/native";
import type { FeedItem, Routine } from "@rakazo/contracts";
import { xPostId } from "@rakazo/contracts";
import { assistantHierarchyIds } from "@rakazo/core";
import { useRouter } from "expo-router";
import { memo, useEffect, useState } from "react";
import { Alert, FlatList, Image, Linking, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { MobileBot } from "../../lib/api";
import { rpc } from "../../lib/api";
import { FeedSettings } from "./feed-settings";
import { Button } from "./kit";
import { colors, s } from "./theme";

type Tab = "feed" | "saved" | "automations" | "hidden";
export function PersonalFeedScreen({
  botId,
  onAsk,
}: {
  botId: string | null;
  onAsk: (draft: string) => void;
}) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("feed");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [embed, setEmbed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const load =
      tab === "automations"
        ? rpc<MobileBot[]>("bots/list", {}, { signal: abort.signal }).then(async (bots) => {
            const ids = botId ? [...assistantHierarchyIds(botId, bots)] : [];
            const rows = await Promise.all(
              ids.map((id) =>
                rpc<Routine[]>("routines/list", { botId: id }, { signal: abort.signal }),
              ),
            );
            if (!abort.signal.aborted) setRoutines(rows.flat());
          })
        : rpc<FeedItem[]>(
            "feed/list",
            { saved: tab === "saved", hidden: tab === "hidden" },
            { signal: abort.signal },
          ).then((rows) => {
            if (!abort.signal.aborted) setItems(rows);
          });
    void load
      .catch(() => {
        if (!abort.signal.aborted) setError("Could not load. Please retry.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [tab, botId, revision]);
  async function change(item: FeedItem, patch: { saved?: boolean; hidden?: boolean }) {
    setBusy(true);
    try {
      await rpc("feed/update", { id: item.id, ...patch });
      setSelected(null);
      setRevision((v) => v + 1);
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const postId = selected ? xPostId(selected.url) : null;
  return (
    <FlatList
      data={!selected && tab !== "automations" ? items : []}
      keyExtractor={(item) => item.id}
      initialNumToRender={5}
      maxToRenderPerBatch={5}
      windowSize={5}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}
      refreshing={loading}
      onRefresh={() => setRevision((v) => v + 1)}
      renderItem={({ item }) => (
        <FeedCard
          item={item}
          onOpen={() => {
            setSelected(item);
            setEmbed(false);
          }}
        />
      )}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <Text style={s.sectionTitle}>For you</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["feed", "saved", "automations", "hidden"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: value === tab }}
                onPress={() => {
                  setTab(value);
                  setSelected(null);
                }}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  backgroundColor: value === tab ? colors.card : colors.canvas,
                }}
              >
                <Text style={s.text}>
                  {
                    { feed: "Feed", saved: "Saved", automations: "Automations", hidden: "Hidden" }[
                      value
                    ]
                  }
                </Text>
              </Pressable>
            ))}
          </View>
          <Button onPress={() => setSettingsOpen((v) => !v)}>
            {settingsOpen ? "Close settings" : "Customize feed"}
          </Button>
          {settingsOpen && <FeedSettings />}
          {!!error && (
            <Text accessibilityRole="alert" style={s.text}>
              {error}
            </Text>
          )}
          {loading ? (
            <Text style={s.text}>Loading…</Text>
          ) : selected ? (
            <>
              <Button onPress={() => setSelected(null)}>Back to feed</Button>
              <Text style={s.sectionTitle}>{selected.title}</Text>
              {selected.imageUrl && (
                <Image
                  source={{ uri: selected.imageUrl }}
                  style={{ width: "100%", height: 220, borderRadius: 16 }}
                />
              )}
              {selected.url && (
                <Button onPress={() => void Linking.openURL(selected.url!)}>Open source</Button>
              )}
              {postId &&
                (embed ? (
                  <WebView
                    style={{ height: 520 }}
                    source={{
                      uri: `https://platform.twitter.com/embed/Tweet.html?id=${postId}&dnt=true`,
                    }}
                    originWhitelist={["https://*"]}
                    onShouldStartLoadWithRequest={(request) => {
                      if (
                        !request.isTopFrame ||
                        request.url.startsWith("https://platform.twitter.com/")
                      )
                        return true;
                      if (request.url.startsWith("https://")) void Linking.openURL(request.url);
                      return false;
                    }}
                  />
                ) : (
                  <Button onPress={() => setEmbed(true)}>Show post from X</Button>
                ))}
              <ChatMarkdown>{selected.summary}</ChatMarkdown>
              {!!selected.content && <ChatMarkdown>{selected.content}</ChatMarkdown>}
              <Button
                onPress={() =>
                  router.push({
                    pathname: "/(vesper)/feed-discussion",
                    params: { itemId: selected.id, botId: selected.botId, title: selected.title },
                  })
                }
              >
                Discuss this post
              </Button>
              <Button
                disabled={busy}
                onPress={() => void change(selected, { saved: !selected.saved })}
              >
                {selected.saved ? "Unsave" : "Save"}
              </Button>
              <Button
                disabled={busy}
                onPress={() => void change(selected, { hidden: !selected.hidden })}
              >
                {selected.hidden ? "Restore" : "Hide"}
              </Button>
            </>
          ) : tab === "automations" ? (
            <>
              <Button onPress={() => onAsk("Хочу создать автоматизацию: ")}>New automation</Button>
              {!routines.length && (
                <Text style={s.text}>
                  Ask Negroni in chat to schedule a task. It will appear here.
                </Text>
              )}
              {routines.map((routine) => (
                <View
                  key={routine.id}
                  style={{ padding: 16, borderRadius: 16, backgroundColor: colors.card, gap: 12 }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expanded === routine.id }}
                    onPress={() => setExpanded(expanded === routine.id ? null : routine.id)}
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Text style={s.sectionTitle}>
                      {routine.name} {expanded === routine.id ? "⌃" : "⌄"}
                    </Text>
                  </Pressable>
                  {expanded === routine.id && (
                    <>
                      <Text style={s.text}>{routine.prompt}</Text>
                      <Text style={s.muted}>
                        {routine.active ? "Active" : "Paused"}
                        {routine.nextRunAt && routine.active
                          ? ` · ${new Date(routine.nextRunAt).toLocaleString()}`
                          : ""}
                      </Text>
                      <Button
                        disabled={busy}
                        onPress={() => {
                          setBusy(true);
                          void rpc("routines/update", {
                            routineId: routine.id,
                            active: !routine.active,
                          })
                            .then(() => setRevision((v) => v + 1))
                            .catch(() => setError("Could not update automation."))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {routine.active ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        onPress={() =>
                          onAsk(
                            `Изменим автоматизацию ${JSON.stringify(routine.name)} (id ${routine.id}): `,
                          )
                        }
                      >
                        Edit in chat
                      </Button>
                      <Button
                        danger
                        disabled={busy}
                        onPress={() =>
                          Alert.alert("Delete automation?", routine.name, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => {
                                setBusy(true);
                                void rpc("routines/remove", { routineId: routine.id })
                                  .then(() => setRevision((v) => v + 1))
                                  .catch(() => setError("Could not delete automation."))
                                  .finally(() => setBusy(false));
                              },
                            },
                          ])
                        }
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </View>
              ))}
            </>
          ) : (
            <>
              {!items.length && (
                <Text style={s.text}>
                  {tab === "feed"
                    ? "Ask Negroni to collect articles, posts or news for your feed. Topics and sources can be changed in chat."
                    : "No posts here yet."}
                </Text>
              )}
            </>
          )}
        </View>
      }
    />
  );
}
const FeedCard = memo(function FeedCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={{ backgroundColor: colors.card, borderRadius: 18, overflow: "hidden" }}
    >
      {item.imageUrl && (
        <Image
          source={{ uri: item.imageUrl }}
          resizeMode="cover"
          style={{ width: "100%", height: 180 }}
        />
      )}
      <View style={{ padding: 18, gap: 10 }}>
        <Text style={s.muted}>
          {item.topic || item.kind} ·{" "}
          {new Date(item.publishedAt ?? item.createdAt).toLocaleDateString()}
        </Text>
        <Text style={s.sectionTitle}>{item.title}</Text>
        <Text style={s.text} numberOfLines={4}>
          {item.summary}
        </Text>
        {!!item.reason && (
          <Text style={s.muted} numberOfLines={2}>
            {item.reason}
          </Text>
        )}
        <Text style={s.text}>Read & discuss →</Text>
      </View>
    </Pressable>
  );
});
