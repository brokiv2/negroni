import type { ComputerReleaseReason, ComputerStatus } from "@rakazo/contracts";
import { ChevronLeft, Maximize2, Monitor, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { currentApiBase, rpc } from "../../../lib/api";
import {
  COMPUTER_HEARTBEAT_MS,
  COMPUTER_LIFECYCLE_TIMEOUT_MS,
  embeddableScreenUrl,
  readScreenUrl,
  SCREEN_URL_OPEN_ATTEMPTS,
} from "../../../lib/computer";
import { createComputerRefresh } from "../../../lib/computer-refresh";
import { t } from "../../../lib/i18n";
import {
  canDriveScreen,
  computerControl,
  computerControlLabel,
  computerTabLabel,
  primaryControlAction,
  releaseChoices,
  screenPlaceholder,
  VESPER_COMPUTER_TABS,
  type VesperComputerTab,
} from "../../../lib/vesper/computer-session";
import { Button, ErrorNotice, IconButton } from "../kit";
import { colors, s, vt } from "../theme";
import { VesperScreenPlaceholder, VesperScreenView } from "./screen-view";
import { VesperWorkspaceFiles } from "./workspace-files";

/**
 * Computer · take control.
 *
 * The transport is Negroni's, unchanged: `computer.status` for state,
 * `computer.screenUrl` for a sealed noVNC capability, `computer.takeover` /
 * `release` for the lease, and a heartbeat that keeps the box from suspending
 * under someone who is still looking at it. Only the chrome is Vesper's.
 *
 * Terminal exec is Phase 9. `VESPER_COMPUTER_TABS` is where it lands.
 */
export function VesperComputerScreen({
  botId,
  onBack,
}: {
  botId: string | null;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<VesperComputerTab>("screen");

  const controller = useMemo(
    () =>
      createComputerRefresh({
        readStatus: () => rpc<ComputerStatus>("computer/status", { botId }),
        readScreen: (attempts) =>
          readScreenUrl(() => rpc<{ url: string | null }>("computer/screenUrl", { botId }), {
            attempts,
          }),
        onStatus: setStatus,
        onScreen: setScreenUrl,
        onReady: () => undefined,
        onInitialError: (failure) =>
          setError(failure instanceof Error ? failure.message : String(failure)),
      }),
    [botId],
  );

  useEffect(() => {
    setStatus(null);
    setScreenUrl(null);
    setScreenError(null);
    setError(null);
    if (botId) controller.start();
    return () => controller.dispose();
  }, [botId, controller]);

  // Looking at the screen counts as using it; without this the idle watchdog
  // suspends the box out from under someone who is mid-takeover.
  useEffect(() => {
    if (!botId || status?.state !== "running") return;
    const ping = () => void rpc("computer/heartbeat", { botId }).catch(() => undefined);
    ping();
    const timer = setInterval(ping, COMPUTER_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [botId, status?.state]);

  const control = computerControl(status, botId);
  const interactive = canDriveScreen(control);
  const embedded = embeddableScreenUrl(screenUrl, currentApiBase());
  useEffect(() => setScreenError(null), [embedded]);

  const takeControl = useCallback(async () => {
    if (!botId) return;
    const action = controller.beginAction();
    setBusy(true);
    setError(null);
    try {
      if (status?.state !== "running") {
        await rpc("computer/boot", { botId }, { timeoutMs: COMPUTER_LIFECYCLE_TIMEOUT_MS });
      }
      if (!action.isActive()) return;
      await rpc("computer/takeover", { botId });
      if (!action.isActive()) return;
      await action.refresh({ screenAttempts: SCREEN_URL_OPEN_ATTEMPTS });
      if (!action.isActive()) return;
      setTab("screen");
      setScreenError(null);
    } catch (failure) {
      if (action.isActive()) {
        setError(failure instanceof Error ? failure.message : t("Could not take control"));
      }
    } finally {
      if (action.isActive()) setBusy(false);
      action.finish();
    }
  }, [botId, controller, status?.state]);

  const release = useCallback(
    async (reason?: ComputerReleaseReason) => {
      if (!botId) return;
      const action = controller.beginAction();
      setBusy(true);
      try {
        await rpc("computer/release", { botId, reason });
        if (!action.isActive()) return;
        setExpanded(false);
        await action.refresh().catch(() => undefined);
      } catch (failure) {
        if (action.isActive()) {
          setError(failure instanceof Error ? failure.message : t("Could not hand it back"));
        }
      } finally {
        if (action.isActive()) setBusy(false);
        action.finish();
      }
    },
    [botId, controller],
  );

  const primary = primaryControlAction(control);
  const placeholder = screenError ?? screenPlaceholder(control);
  const showStream = status?.state === "running" && !!embedded && !screenError;

  const frame = (fullscreen: boolean) =>
    showStream && embedded ? (
      <VesperScreenView
        url={embedded}
        interactive={interactive && fullscreen}
        onError={() => {
          controller.invalidateScreen();
          setScreenError(t("This device cannot reach the screen. Try again in a moment."));
        }}
      />
    ) : (
      <VesperScreenPlaceholder message={placeholder} />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View
        style={[
          s.between,
          {
            paddingHorizontal: 14,
            paddingVertical: 8,
            gap: 10,
            minHeight: vt.size.touchTarget + 8,
          },
        ]}
      >
        <IconButton icon={ChevronLeft} label={t("Back to the conversation")} onPress={onBack} />
        <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>{t("Computer")}</Text>
          <Text numberOfLines={1} style={s.small}>
            {computerControlLabel(control, status?.busyBotName)}
          </Text>
        </View>
        <View style={{ width: vt.size.touchTarget }} />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignSelf: "center",
          gap: 4,
          padding: 4,
          marginBottom: 12,
          borderRadius: vt.radius.navPill,
          backgroundColor: vt.extras.pillNeutral,
        }}
      >
        {VESPER_COMPUTER_TABS.map((entry) => (
          <Pressable
            key={entry}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === entry }}
            onPress={() => setTab(entry)}
            style={{
              paddingHorizontal: 18,
              paddingVertical: 8,
              borderRadius: vt.radius.navItem,
              backgroundColor: tab === entry ? colors.card : "transparent",
            }}
          >
            <Text style={[s.small, tab === entry && { color: colors.text, fontWeight: "600" }]}>
              {computerTabLabel(entry)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1, paddingHorizontal: vt.space.screenPaddingHorizontal, gap: 14 }}>
        <ErrorNotice error={error} />
        {tab === "screen" ? (
          <>
            <View
              style={{
                flex: 1,
                minHeight: 200,
                borderRadius: vt.radius.card,
                overflow: "hidden",
                backgroundColor: colors.card,
              }}
            >
              {frame(false)}
              {showStream && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Open the screen full size")}
                  onPress={() => setExpanded(true)}
                  style={{
                    position: "absolute",
                    right: 10,
                    bottom: 10,
                    width: 36,
                    height: 36,
                    borderRadius: vt.radius.toolCardInner,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.card,
                  }}
                >
                  <Maximize2 size={15} color={colors.text} />
                </Pressable>
              )}
            </View>
            <View style={[s.row, { gap: 8, flexWrap: "wrap", paddingBottom: 18 }]}>
              {control === "youDriving" ? (
                releaseChoices(status?.takeoverRequested ?? false).map((choice) => (
                  <Button
                    key={choice.id}
                    small
                    busy={busy}
                    primary={choice.primary}
                    onPress={() => void release(choice.reason)}
                  >
                    {choice.label}
                  </Button>
                ))
              ) : primary ? (
                <Button small primary busy={busy} icon={Monitor} onPress={() => void takeControl()}>
                  {primary.label}
                </Button>
              ) : null}
            </View>
          </>
        ) : (
          <View style={{ flex: 1, paddingBottom: 18 }}>
            <VesperWorkspaceFiles botId={botId} />
          </View>
        )}
      </View>

      <Modal
        visible={expanded}
        animationType="fade"
        presentationStyle="fullScreen"
        supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
        onRequestClose={() => setExpanded(false)}
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <View style={{ flex: 1, backgroundColor: colors.canvas }}>
            <SafeAreaView
              edges={["top", "left", "right"]}
              style={[
                s.between,
                {
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                },
              ]}
            >
              <Text numberOfLines={1} style={[s.text, { flex: 1, fontWeight: "500" }]}>
                {computerControlLabel(control, status?.busyBotName)}
              </Text>
              {control === "youDriving" ? (
                releaseChoices(status?.takeoverRequested ?? false).map((choice) => (
                  <Button
                    key={choice.id}
                    small
                    busy={busy}
                    primary={choice.primary}
                    onPress={() => void release(choice.reason)}
                  >
                    {choice.label}
                  </Button>
                ))
              ) : primary ? (
                <Button small primary busy={busy} onPress={() => void takeControl()}>
                  {primary.label}
                </Button>
              ) : null}
              <IconButton
                icon={X}
                label={t("Close the full-size screen")}
                onPress={() => setExpanded(false)}
              />
            </SafeAreaView>
            <View style={{ flex: 1, backgroundColor: colors.card }}>{frame(true)}</View>
          </View>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
