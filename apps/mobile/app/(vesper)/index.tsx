import type { ComputerStatus, PersonalThread, RunActivityRow } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VesperAppsScreen } from "../../components/vesper/apps/apps-screen";
import { VesperChatScreen } from "../../components/vesper/chat/chat-screen";
import { useAssistantName } from "../../components/vesper/context/assistant-scope";
import { PersonalFeedScreen } from "../../components/vesper/feed-screen";
import { VesperBottomNav, VesperToast } from "../../components/vesper/shell/bottom-nav";
import { VesperHeader } from "../../components/vesper/shell/header";
import { AssistantTeamScreen } from "../../components/vesper/team-screen";
import { colors, s, vt } from "../../components/vesper/theme";
import { rpc } from "../../lib/api";
import { t } from "../../lib/i18n";
import { setShellMode } from "../../lib/shell-mode";
import { type ComputerPillState, computerPillState } from "../../lib/vesper/computer-pill";
import { isComputerEvent, isRunActivityEvent } from "../../lib/vesper/computer-session";
import {
  DEFAULT_VESPER_SECTION,
  type VesperSection,
  vesperSectionHeading,
} from "../../lib/vesper/nav";
import { hasStatusAttention, vesperStatusLine } from "../../lib/vesper/status-line";

/** The product name. Not translated — it is a brand, not chrome. */
const VESPER_NAME = "Negroni";

/**
 * The Vesper shell.
 *
 * Chat stays mounted behind `display: none` when another section is showing, so
 * a draft and a queued follow-up survive a trip to Activity and back — the one
 * behaviour a fresh mount would quietly break.
 */
export default function VesperShell() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= vt.size.desktopBreakpoint;
  const [chatDraft, setChatDraft] = useState<{ text: string; nonce: number } | undefined>();
  const askInChat = (text: string) => {
    setChatDraft({ text, nonce: Date.now() });
    setSection("chat");
  };
  const [section, setSection] = useState<VesperSection>(DEFAULT_VESPER_SECTION);
  const [personal, setPersonal] = useState<PersonalThread | null>(null);
  const [runs, setRuns] = useState<RunActivityRow[]>([]);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Bumped on every run event so Activity reloads off the stream, not a timer.
  const [activityToken, setActivityToken] = useState(0);

  const botId = personal?.botId ?? null;
  const assistantName = useAssistantName(botId, VESPER_NAME);

  const refreshRuns = useCallback(async () => {
    const result = await rpc<{ runs: RunActivityRow[] }>("runs/list", { filter: "active" }).catch(
      () => null,
    );
    if (result) setRuns(result.runs);
  }, []);

  const refreshComputer = useCallback(async () => {
    if (!botId) return;
    const status = await rpc<ComputerStatus>("computer/status", { botId }).catch(() => null);
    if (status) setComputer(status);
  }, [botId]);

  useEffect(() => {
    void refreshRuns();
    void refreshComputer();
  }, [refreshComputer, refreshRuns]);

  // Live updates arrive on the chat's SSE stream: a computer event re-reads the
  // status behind the pill, a run event re-reads the runs behind the status line
  // and the bell. Nothing here is on a timer.
  const onThreadEvent = useCallback(
    (event: { type: string }) => {
      if (isComputerEvent(event.type)) void refreshComputer();
      if (isRunActivityEvent(event.type)) {
        void refreshRuns();
        setActivityToken((token) => token + 1);
      }
    },
    [refreshComputer, refreshRuns],
  );

  // Foreground reconciliation only: catches whatever the stream missed while the
  // app was backgrounded.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void refreshRuns();
      void refreshComputer();
    });
    return () => subscription.remove();
  }, [refreshComputer, refreshRuns]);

  const status = vesperStatusLine(runs);
  const unread = hasStatusAttention(runs) ? runs.length : 0;
  const pillState: ComputerPillState = computerPillState(computer);
  const heading = vesperSectionHeading(section);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
      <View
        style={{ flex: 1, width: "100%", maxWidth: vt.size.contentMaxWidth, alignSelf: "center" }}
      >
        <VesperHeader
          name={assistantName}
          status={status}
          desktop={desktop}
          unread={unread}
          showComputerPill={section === "chat"}
          computerState={pillState}
          onOpenMenu={() => setToast(t("Conversations arrive in a later pass."))}
          onOpenNotifications={() => setSection("feed")}
          onOpenIdentity={() => setSection("feed")}
          onOpenComputer={() => {
            if (botId) router.push({ pathname: "/(vesper)/computer", params: { botId } });
          }}
        />
        <View style={{ flex: 1, minHeight: 0 }}>
          {section === "feed" && <PersonalFeedScreen botId={botId} onAsk={askInChat} />}
          {section !== "chat" && section !== "feed" && (
            <ScrollView
              key={section}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: desktop
                  ? vt.space.screenPaddingHorizontalDesktop
                  : vt.space.screenPaddingHorizontal,
                paddingBottom: 28,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {!!heading && (
                <>
                  <Text style={[s.sectionTitle, { marginBottom: 6 }]}>{heading.title}</Text>
                  <Text style={[s.muted, { marginBottom: 22 }]}>{heading.subtitle}</Text>
                </>
              )}
              <VesperSectionBody
                section={section}
                botId={botId}
                activityToken={activityToken}
                onSwitchToNegroni={() => {
                  void setShellMode("negroni").then(() => router.replace("/"));
                }}
              />
            </ScrollView>
          )}
          <View style={{ display: section === "chat" ? "flex" : "none", flex: 1 }}>
            <VesperChatScreen
              draftRequest={chatDraft}
              botId={botId}
              desktop={desktop}
              onBotResolved={setPersonal}
              computerReachable={pillState !== "offline"}
              onRunsChanged={() => void refreshRuns()}
              onThreadEvent={onThreadEvent}
              onOpenComputer={() => {
                if (botId) router.push({ pathname: "/(vesper)/computer", params: { botId } });
              }}
            />
          </View>
        </View>
        <VesperBottomNav section={section} desktop={desktop} onNavigate={setSection} />
      </View>
      {!!toast && <VesperToast message={toast} onDismiss={() => setToast(null)} />}
    </SafeAreaView>
  );
}

/**
 * Every section is built. Activity re-reads when `activityToken` changes;
 * Ideas, Goals and Apps read on entry and after their own mutations.
 */
function VesperSectionBody({
  section,
  botId,
  activityToken,
  onSwitchToNegroni,
}: {
  section: VesperSection;
  botId: string | null;
  activityToken: number;
  onSwitchToNegroni: () => void;
}) {
  switch (section) {
    case "feed":
      return null;
    case "team":
      return <AssistantTeamScreen botId={botId} refreshToken={activityToken} />;
    case "apps":
      return <VesperAppsScreen onSwitchToNegroni={onSwitchToNegroni} />;
    case "chat":
      return null;
  }
}
