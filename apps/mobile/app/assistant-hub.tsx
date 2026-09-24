import type { MemoryDocument, Routine, RunActivityRow, ScratchpadItem } from "@rakazo/contracts";
import { assistantHierarchyIds } from "@rakazo/core";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionSheet } from "../components/action-sheet";
import { BotAvatar } from "../components/bot-avatar";
import { GlassSurface } from "../components/glass-surface";
import { NativeSymbol } from "../components/native-symbol";
import { WorkspacePicker } from "../components/workspace-picker";
import { activityStatusLabel, formatActivityRelativeTime } from "../lib/activity";
import { rpc, type MobileBot } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { saveChatView } from "../lib/chat-view";
import { useResolvedAppearance } from "../lib/native";

type Section = "today" | "goals" | "ideas" | "activity" | "memory";
const tabs: { id: Section; label: string }[] = [
  { id: "today", label: "For you" }, { id: "goals", label: "Goals" }, { id: "ideas", label: "Ideas" },
  { id: "activity", label: "Activity" }, { id: "memory", label: "Memory" },
];
const sectionFrom = (value?: string): Section => tabs.some((tab) => tab.id === value) ? value as Section : "today";
const memoryTitle = (document: MemoryDocument): string => {
  const filename = document.path.split("/").filter(Boolean).pop() ?? "";
  if (!filename || /^\.?memory\.md$/i.test(filename)) return document.scope === "user" ? "About you" : "Assistant memory";
  return filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
};

export default function AssistantHub() {
  const { botId, name = "Negroni", section: initialSection } = useLocalSearchParams<{ botId?: string; name?: string; section?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appearance = useResolvedAppearance();
  const theme = mobileTokens();
  const card = appearance === "light" ? "#FFFFFF" : "#222225";
  const accent = appearance === "light" ? "#EEEAF9" : "#302A42";
  const [section, setSection] = useState<Section>(sectionFrom(initialSection));
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [items, setItems] = useState<ScratchpadItem[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<RunActivityRow[]>([]);
  const [memory, setMemory] = useState<MemoryDocument[]>([]);
  const [assistant, setAssistant] = useState<MobileBot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editItem, setEditItem] = useState<ScratchpadItem | "new" | null>(null);
  const [itemKind, setItemKind] = useState<"goals" | "ideas">("goals");
  const [drafts, setDrafts] = useState({ goals: "", ideas: "" });
  const [editTitle, setEditTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [editingMemory, setEditingMemory] = useState<MemoryDocument | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const request = useRef<AbortController | null>(null);
  const knownHierarchy = useRef<{ botId: string; ids: Set<string> } | null>(null);
  const mutationBusy = useRef(false);
  useEffect(() => setSection(sectionFrom(initialSection)), [initialSection]);

  const load = useCallback(async () => {
    request.current?.abort();
    if (!botId) { setLoading(false); setRefreshing(false); return; }
    const controller = new AbortController();
    request.current = controller;
    const options = { signal: controller.signal };
    let incomplete = false;
    try {
      const [bots, active, recent, userDocuments, botDocuments] = await Promise.allSettled([
        rpc<MobileBot[]>("bots/list", {}, options),
        rpc<{ runs: RunActivityRow[] }>("runs/list", { filter: "active" }, options),
        rpc<{ runs: RunActivityRow[] }>("runs/list", { filter: "recent" }, options),
        rpc<MemoryDocument[]>("memory/list", { scope: "user" }, options),
        rpc<MemoryDocument[]>("memory/list", { botId }, options),
      ]);
      if (controller.signal.aborted) return;
      const hierarchy = bots.status === "fulfilled"
        ? assistantHierarchyIds(botId, bots.value)
        : knownHierarchy.current?.botId === botId ? knownHierarchy.current.ids : new Set([botId]);
      if (bots.status === "fulfilled") {
        knownHierarchy.current = { botId, ids: hierarchy };
        setAssistant(bots.value.find((bot) => bot.id === botId) ?? null);
      }
      if (userDocuments.status === "fulfilled" || botDocuments.status === "fulfilled") {
        setMemory((current) => {
          const kept = current.filter((document) =>
            (document.scope === "user" && userDocuments.status !== "fulfilled") ||
            (document.scope === "bot" && botDocuments.status !== "fulfilled"),
          );
          const incoming = [
            ...(userDocuments.status === "fulfilled" ? userDocuments.value : []),
            ...(botDocuments.status === "fulfilled" ? botDocuments.value : []),
          ];
          return [...new Map([...kept, ...incoming].map((document) => [document.id, document])).values()]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
      }
      if (active.status === "fulfilled" || recent.status === "fulfilled") {
        setRuns((current) => {
          const isActive = (run: RunActivityRow) => ["queued", "leased", "running", "waiting_input", "waiting_takeover"].includes(run.status);
          const kept = current.filter((run) => active.status !== "fulfilled" && isActive(run) || recent.status !== "fulfilled" && !isActive(run));
          const incoming = [
            ...(active.status === "fulfilled" ? active.value.runs : []),
            ...(recent.status === "fulfilled" ? recent.value.runs : []),
          ];
          return [...new Map([...kept, ...incoming].filter((run) => hierarchy.has(run.botId)).map((run) => [run.runId, run])).values()]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
      }
      incomplete = [bots, active, recent, userDocuments, botDocuments].some((result) => result.status === "rejected");
      const hierarchyIds = [...hierarchy];
      const [goals, tracking] = await Promise.all([
        Promise.allSettled(hierarchyIds.map((id) => rpc<ScratchpadItem[]>("scratchpad/list", { botId: id, includeDone: true }, options))),
        Promise.allSettled(hierarchyIds.map((id) => rpc<Routine[]>("routines/list", { botId: id }, options))),
      ]);
      if (controller.signal.aborted) return;
      if (goals.some((result) => result.status === "fulfilled")) {
        const refreshedIds = new Set(hierarchyIds.filter((_, index) => goals[index]?.status === "fulfilled"));
        setItems((current) => [
          ...current.filter((item) => !refreshedIds.has(item.botId)),
          ...goals.flatMap((result) => result.status === "fulfilled" ? result.value : []),
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      if (tracking.some((result) => result.status === "fulfilled")) {
        const refreshedIds = new Set(hierarchyIds.filter((_, index) => tracking[index]?.status === "fulfilled"));
        setRoutines((current) => [
          ...current.filter((routine) => !refreshedIds.has(routine.botId)),
          ...tracking.flatMap((result) => result.status === "fulfilled" ? result.value : []),
        ]);
      }
      incomplete ||= [...goals, ...tracking].some((result) => result.status === "rejected");
      setLoadError(incomplete);
    } catch { if (!controller.signal.aborted) setLoadError(true); }
    finally { if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); } }
  }, [botId]);
  useFocusEffect(useCallback(() => { void load(); return () => request.current?.abort(); }, [load]));

  const openChat = (draft?: string) => {
    if (botId) router.push({ pathname: "/thread", params: { botId, name, view: "assistant", ...(draft ? { draft } : {}) } });
  };
  const openRun = (run: RunActivityRow) => router.push({ pathname: run.groupId ? "/group-thread" : "/thread", params: run.groupId ? { groupId: run.groupId, name: run.groupName ?? "Group" } : { botId: run.botId, name: run.botName, ...(run.botId === botId ? { view: "assistant" } : {}) } });
  const mutate = async (operation: () => Promise<void>) => {
    if (mutationBusy.current) return;
    mutationBusy.current = true; setSaving(true); setSaveError(false);
    try { await operation(); } catch { setSaveError(true); }
    finally { mutationBusy.current = false; setSaving(false); }
  };
  const changeStatus = (item: ScratchpadItem, status: ScratchpadItem["status"]) => void mutate(async () => {
    const next = await rpc<ScratchpadItem>("scratchpad/update", { itemId: item.id, status });
    setItems((current) => current.map((entry) => entry.id === item.id ? next : entry));
  });
  const saveItem = () => void mutate(async () => {
    const title = editItem === "new" ? drafts[itemKind].trim() : editTitle.trim();
    if (!botId || !title) return;
    const values = { title, notes };
    const next = editItem && editItem !== "new"
      ? await rpc<ScratchpadItem>("scratchpad/update", { itemId: editItem.id, ...values })
      : await rpc<ScratchpadItem>("scratchpad/create", { botId, ...values, status: itemKind === "ideas" ? "parked" : "open" });
    setItems((current) => [next, ...current.filter((entry) => entry.id !== next.id)]);
    setEditItem(null);
    if (editItem === "new") setDrafts((current) => ({ ...current, [itemKind]: "" }));
  });
  const createItem = (kind: "goals" | "ideas") => { setItemKind(kind); setNotes(""); setSaveError(false); setEditItem("new"); };
  const activeGoals = items.filter((item) => item.status === "open");
  const ideas = items.filter((item) => item.status === "parked");
  const waiting = runs.filter((run) => ["waiting_input", "waiting_takeover"].includes(run.status));
  const working = runs.filter((run) => ["queued", "leased", "running"].includes(run.status));
  const finished = runs.filter((run) => ["completed", "failed", "cancelled"].includes(run.status));
  const title = tabs.find((tab) => tab.id === section)!.label;
  const descriptions: Record<Section, string> = { today: "Your plans, progress and possibilities.", goals: "What we're working toward.", ideas: "A place for the things that could be next.", activity: "What your assistant and its team have been doing.", memory: "What your assistant remembers. You're in control." };
  const text = { color: theme.ink };
  const muted = { color: theme.muted };
  const button = (label: string, action: () => void, filled = false) => <Pressable accessibilityRole="button" disabled={saving} onPress={action} style={[styles.pill, { backgroundColor: filled ? theme.ink : theme.surface2 }]}><Text style={{ color: filled ? theme.page : theme.ink, fontSize: 14, fontWeight: "600" }}>{label}</Text></Pressable>;
  const heading = (label: string, action?: () => void) => <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, text]}>{label}</Text>{action ? <Pressable accessibilityRole="button" onPress={action} hitSlop={12}><Text style={[styles.link, muted]}>View all</Text></Pressable> : null}</View>;
  const empty = (message: string) => <Text style={[styles.empty, muted]}>{message}</Text>;
  const goalCard = (item: ScratchpadItem) => <View key={item.id} style={[styles.card, { backgroundColor: card }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} onPress={() => { setEditItem(item); setItemKind(item.status === "parked" ? "ideas" : "goals"); setEditTitle(item.title); setNotes(item.notes); setSaveError(false); }}><Text style={[styles.cardTitle, text]}>{item.title}</Text>{item.notes ? <Text numberOfLines={3} style={[styles.copy, muted]}>{item.notes}</Text> : null}</Pressable>
    <View style={styles.actions}>{button("Discuss", () => openChat(`Let's work on this ${item.status === "parked" ? "idea" : "goal"}: ${item.title}${item.notes ? `\n${item.notes}` : ""}`))}{button(item.status === "parked" ? "Make a goal" : "Mark done", () => changeStatus(item, item.status === "parked" ? "open" : "done"))}</View>
  </View>;
  const runCard = (run: RunActivityRow) => <Pressable accessibilityRole="button" key={run.runId} onPress={() => openRun(run)} style={[styles.card, { backgroundColor: waiting.includes(run) ? accent : card }]}>
    <View style={styles.row}><Text style={[styles.meta, muted]}>{run.botName}</Text><Text style={[styles.meta, muted]}>{formatActivityRelativeTime(run.updatedAt)}</Text></View>
    <Text numberOfLines={3} style={[styles.cardTitle, text]}>{run.promptSnippet || "Conversation"}</Text>
    <View style={[styles.row, { marginTop: 14 }]}><Text style={[styles.status, text]}>{waiting.includes(run) ? "Needs your answer" : activityStatusLabel(run.status)}</Text><NativeSymbol ios="arrow.up.right" android="arrow-forward-outline" size={17} /></View>
  </Pressable>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.page }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityLabel="Open navigation" onPress={() => setNavigationOpen(true)} style={[styles.circle, { backgroundColor: card }]}><NativeSymbol ios="line.3.horizontal" android="menu" size={21} /></Pressable>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><BotAvatar identity={botId ?? "negroni"} color={assistant?.color ?? "#2DB69B"} size={30} /><Text style={[styles.brand, text]}>Personal</Text></View>
        <Pressable accessibilityLabel="Settings" onPress={() => router.push("/account")} style={[styles.circle, { backgroundColor: card }]}><NativeSymbol ios="gearshape" android="settings-outline" size={20} /></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
        {tabs.map((tab) => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: section === tab.id }} onPress={() => setSection(tab.id)} style={{ paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: section === tab.id ? theme.ink : "transparent" }}><Text style={{ color: section === tab.id ? theme.ink : theme.muted, fontSize: 15, fontWeight: section === tab.id ? "600" : "400" }}>{tab.label}</Text></Pressable>)}
      </ScrollView>
      <ScrollView keyboardDismissMode="on-drag" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />} contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 24, paddingBottom: 24, gap: 12 }}>
        <View style={{ marginBottom: 12 }}>
          {section === "today" ? <Text style={[styles.date, muted]}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</Text> : null}
          <Text style={[styles.heroTitle, text]}>{title}</Text><Text style={[styles.intro, muted]}>{descriptions[section]}</Text>
        </View>
        {loadError ? <Pressable onPress={() => void load()} accessibilityRole="button"><Text style={[styles.copy, muted]}>Some updates couldn't load. Tap to retry.</Text></Pressable> : null}
        {saveError && !editItem && !editingMemory ? <Text style={[styles.copy, { color: theme.danger }]}>Couldn't save that change. Please try again.</Text> : null}
        {loading ? <View style={{ gap: 12 }}>{[110, 150, 110].map((height, index) => <View key={index} style={{ height, borderRadius: 24, backgroundColor: theme.surface2 }} />)}</View> : null}
        {!loading && section === "today" ? <>
          {waiting.length ? <>{heading("Needs your answer")}{waiting.map(runCard)}</> : null}
          {working.length ? <>{heading("Working on it")}{working.map(runCard)}</> : null}
          <Pressable accessibilityRole="button" onPress={() => openChat()} style={[styles.card, { backgroundColor: accent, padding: 24 }]}>
            <NativeSymbol ios="sparkles" android="sparkles-outline" size={25} />
            <Text style={[styles.welcomeTitle, text]}>A little room to think.</Text>
            <Text style={[styles.copy, muted]}>Bring a question, a plan or something on your mind. We can pick up where we left off.</Text>
            <View style={[styles.row, { marginTop: 20 }]}><Text style={[styles.status, text]}>Continue our conversation</Text><NativeSymbol ios="arrow.up.right" android="arrow-forward-outline" size={19} /></View>
          </Pressable>
          {heading("Your goals", () => setSection("goals"))}{activeGoals.length ? activeGoals.slice(0, 3).map(goalCard) : <View style={[styles.card, { backgroundColor: card }]}>{empty("Give us something to work toward.")}{button("Add a goal", () => createItem("goals"))}</View>}
          {routines.some((routine) => routine.active) ? <>{heading("Keeping an eye on")}{routines.filter((routine) => routine.active).slice(0, 3).map((routine) => <Pressable key={routine.id} onPress={() => router.push({ pathname: "/routine", params: { botId: routine.botId, routineId: routine.id, botName: name } })} style={[styles.card, { backgroundColor: card }]}><Text style={[styles.cardTitle, text]}>{routine.name}</Text><Text style={[styles.copy, muted]}>{routine.nextRunAt ? `Next check ${new Date(routine.nextRunAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Tracking is on"}</Text></Pressable>)}</> : null}
          {ideas.length ? <>{heading("Ideas for later", () => setSection("ideas"))}{ideas.slice(0, 2).map(goalCard)}</> : null}
          {finished.length ? <>{heading("Latest activity", () => setSection("activity"))}{finished.slice(0, 3).map(runCard)}</> : null}
        </> : null}
        {!loading && (section === "goals" || section === "ideas") ? <>
          {button(section === "goals" ? "+ Add a goal" : "+ Save an idea", () => createItem(section), true)}
          {(section === "goals" ? activeGoals : ideas).map(goalCard)}
          {!(section === "goals" ? activeGoals : ideas).length ? empty(section === "goals" ? "No active goals yet. Add one here or talk it through with your assistant." : "Save possibilities here. Turn an idea into a goal whenever you're ready.") : null}
          {section === "goals" && items.some((item) => item.status === "done") ? <>{heading("Completed")}{items.filter((item) => item.status === "done").map((item) => <View key={item.id} style={[styles.card, { backgroundColor: card }]}><Text style={[styles.cardTitle, muted]}>{item.title}</Text><View style={styles.actions}>{button("Reopen", () => changeStatus(item, "open"))}</View></View>)}</> : null}
        </> : null}
        {!loading && section === "activity" ? <>{runs.map(runCard)}{!runs.length ? empty("Work and requests for your input will appear here as your assistant gets started.") : null}</> : null}
        {!loading && section === "memory" ? <>
          {memory.map((document) => <Pressable key={document.id} onPress={() => { setEditingMemory(document); setMemoryDraft(document.content); setSaveError(false); }} style={[styles.card, { backgroundColor: card }]}><Text style={[styles.cardTitle, text]}>{memoryTitle(document)}</Text><Text numberOfLines={4} style={[styles.copy, muted]}>{document.content}</Text><Text style={[styles.link, text, { marginTop: 14 }]}>Edit memory</Text></Pressable>)}
          {!memory.length ? empty("As we get to know each other, saved memories will appear here.") : null}
          {button("Connected apps", () => router.push("/integrations"))}
        </> : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12) }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Message ${name}`} onPress={() => { if (botId) router.push({ pathname: "/thread", params: { botId, name, view: "assistant", focus: "1" } }); }}>
          <GlassSurface appearance={appearance} style={styles.composer} fallbackStyle={{ backgroundColor: card, borderWidth: 1, borderColor: theme.hairline }}><Text style={{ color: theme.muted, fontSize: 18, flex: 1 }}>Message {name}</Text><View style={[styles.send, { backgroundColor: theme.ink }]}><NativeSymbol ios="arrow.up" android="arrow-up" size={20} color={theme.page} /></View></GlassSurface>
        </Pressable>
      </View>
      <WorkspacePicker visible={navigationOpen} selected="assistant" assistantAvailable assistantId={botId} assistantName={name} onClose={() => setNavigationOpen(false)} onSelect={(next) => { if (next === "team") void saveChatView("team").then(() => router.replace("/")); else setSection("today"); }} onOpenPersonalSection={setSection} onOpenConversation={() => openChat()} />
      <ActionSheet visible={Boolean(editItem)} title={editItem === "new" ? itemKind === "goals" ? "A new goal" : "Save an idea" : "Edit"} onClose={() => setEditItem(null)}>
        <View style={{ padding: 12, gap: 12 }}><TextInput autoFocus value={editItem === "new" ? drafts[itemKind] : editTitle} onChangeText={(value) => editItem === "new" ? setDrafts((current) => ({ ...current, [itemKind]: value })) : setEditTitle(value)} placeholder={itemKind === "goals" ? "What would you like to work toward?" : "What's on your mind?"} placeholderTextColor={theme.muted} multiline style={[styles.input, text, { backgroundColor: theme.surface2 }]} /><TextInput value={notes} onChangeText={setNotes} placeholder="A little context (optional)" placeholderTextColor={theme.muted} multiline style={[styles.input, text, { backgroundColor: theme.surface2, minHeight: 90 }]} />{saveError ? <Text style={{ color: theme.danger }}>Couldn't save. Please try again.</Text> : null}<Pressable disabled={saving || !(editItem === "new" ? drafts[itemKind] : editTitle).trim()} onPress={saveItem} style={[styles.save, { backgroundColor: theme.ink, opacity: saving || !(editItem === "new" ? drafts[itemKind] : editTitle).trim() ? 0.4 : 1 }]}>{saving ? <ActivityIndicator color={theme.page} /> : <Text style={{ color: theme.page, fontSize: 16, fontWeight: "600" }}>Save</Text>}</Pressable></View>
      </ActionSheet>
      <ActionSheet visible={Boolean(editingMemory)} title="Edit memory" onClose={() => setEditingMemory(null)}><View style={{ padding: 12, gap: 12 }}><TextInput multiline value={memoryDraft} onChangeText={setMemoryDraft} textAlignVertical="top" style={[styles.input, text, { minHeight: 180, maxHeight: 320, backgroundColor: theme.surface2 }]} />{saveError ? <Text style={{ color: theme.danger }}>Couldn't save. Please try again.</Text> : null}{button(saving ? "Saving…" : "Save memory", () => void mutate(async () => { if (!editingMemory) return; const next = await rpc<MemoryDocument>("memory/update", { documentId: editingMemory.id, content: memoryDraft }); setMemory((current) => current.map((document) => document.id === next.id ? next : document)); setEditingMemory(null); }), true)}</View></ActionSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  brand: { fontSize: 18, fontWeight: "600", letterSpacing: -0.4 },
  tabs: { paddingHorizontal: 24, gap: 26 },
  date: { fontSize: 13, marginBottom: 8 },
  heroTitle: { fontSize: 36, fontWeight: "600", letterSpacing: -1.3 },
  intro: { fontSize: 15, lineHeight: 23, marginTop: 7 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 1 },
  sectionTitle: { fontSize: 21, fontWeight: "600", letterSpacing: -0.5 },
  card: { borderRadius: 24, padding: 20, gap: 4 },
  cardTitle: { fontSize: 17, lineHeight: 24, fontWeight: "500", letterSpacing: -0.2 },
  welcomeTitle: { fontSize: 27, fontWeight: "600", letterSpacing: -0.7, marginTop: 13 },
  copy: { fontSize: 14, lineHeight: 21, marginTop: 5 },
  meta: { fontSize: 12, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  status: { fontSize: 14, fontWeight: "500" },
  link: { fontSize: 13, fontWeight: "500" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 13 },
  pill: { alignSelf: "flex-start", minHeight: 38, borderRadius: 19, paddingHorizontal: 16, justifyContent: "center" },
  empty: { fontSize: 15, lineHeight: 23, paddingVertical: 14 },
  composer: { minHeight: 56, borderRadius: 28, paddingLeft: 20, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 12 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  input: { borderRadius: 18, padding: 16, minHeight: 56, fontSize: 17, lineHeight: 24 },
  save: { height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
