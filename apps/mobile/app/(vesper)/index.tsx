import type { ComputerStatus, PersonalThread, RunActivityRow } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { PanelsTopLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VesperAppsScreen } from "../../components/vesper/apps/apps-screen";
import { VesperChatScreen } from "../../components/vesper/chat/chat-screen";
import { useAssistantName } from "../../components/vesper/context/assistant-scope";
import { VesperGoalsScreen } from "../../components/vesper/goals/goals-screen";
import { VesperIdeasScreen } from "../../components/vesper/ideas/ideas-screen";
import { Empty } from "../../components/vesper/kit";
import { VesperBottomNav, VesperToast } from "../../components/vesper/shell/bottom-nav";
import { VesperHeader } from "../../components/vesper/shell/header";
import { colors, s, vt } from "../../components/vesper/theme";
import { rpc } from "../../lib/api";
import { t } from "../../lib/i18n";
import { setShellMode } from "../../lib/shell-mode";
import { type ComputerPillState, computerPillState } from "../../lib/vesper/computer-pill";
import {
  DEFAULT_VESPER_SECTION,
  type VesperSection,
  vesperSectionHeading,
} from "../../lib/vesper/nav";
import { hasStatusAttention, vesperStatusLine } from "../../lib/vesper/status-line";

/** The product name. Not translated — it is a brand, not chrome. */
const VESPER_NAME = "Vesper";

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
  const [section, setSection] = useState<VesperSection>(DEFAULT_VESPER_SECTION);
  const [personal, setPersonal] = useState<PersonalThread | null>(null);
  const [runs, setRuns] = useState<RunActivityRow[]>([]);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  // Foreground reconciliation only. Everything live arrives on the thread's SSE
  // stream; this is the one place a fetch is the right tool.
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
          onOpenNotifications={() => setSection("activity")}
          onOpenIdentity={() => setSection("activity")}
          onOpenComputer={() => {
            if (botId) router.push({ pathname: "/computer", params: { botId } });
          }}
        />
        <View style={{ flex: 1, minHeight: 0 }}>
          {section !== "chat" && (
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
                onOpenChat={() => setSection("chat")}
                onSwitchToNegroni={() => {
                  void setShellMode("negroni").then(() => router.replace("/"));
                }}
              />
            </ScrollView>
          )}
          <View style={{ display: section === "chat" ? "flex" : "none", flex: 1 }}>
            <VesperChatScreen
              botId={botId}
              desktop={desktop}
              onBotResolved={setPersonal}
              computerReachable={pillState !== "offline"}
              onRunsChanged={() => void refreshRuns()}
              onOpenComputer={() => {
                if (botId) router.push({ pathname: "/computer", params: { botId } });
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
 * Activity is still Phase 5 and says so rather than showing an empty list that
 * looks broken. Ideas, Goals and Apps are built.
 */
function VesperSectionBody({
  section,
  botId,
  onOpenChat,
  onSwitchToNegroni,
}: {
  section: VesperSection;
  botId: string | null;
  onOpenChat: () => void;
  onSwitchToNegroni: () => void;
}) {
  switch (section) {
    case "activity":
      return (
        <Empty
          icon={PanelsTopLeft}
          title={t("Nothing running")}
          detail={t("Plans, progress and results will land here.")}
        />
      );
    case "ideas":
      return <VesperIdeasScreen botId={botId} onOpenChat={onOpenChat} />;
    case "goals":
      return <VesperGoalsScreen botId={botId} onOpenChat={onOpenChat} />;
    case "apps":
      return <VesperAppsScreen onSwitchToNegroni={onSwitchToNegroni} />;
    case "chat":
      return null;
  }
}
