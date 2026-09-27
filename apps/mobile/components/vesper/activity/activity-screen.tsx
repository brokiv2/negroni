import type { EffectReceipt, RunActivityRow } from "@rakazo/contracts";
import { PanelsTopLeft, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { fetchSpaceActivity } from "../../../lib/activity";
import { type MobileSnapshot, rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  type ActivityAsk,
  type ActivityMessage,
  activityFilterLabel,
  filterActivityRuns,
  mergeActivityRuns,
  pendingApprovals,
  planForRun,
  VESPER_ACTIVITY_FILTERS,
  type VesperActivityFilter,
} from "../../../lib/vesper/activity";
import { type VesperAsk, VesperAskCard } from "../chat/ask-card";
import { Empty, ErrorNotice, SectionHeading } from "../kit";
import { colors, s, vt } from "../theme";
import { VesperReceiptCard } from "./receipt-card";
import { VesperRunCard } from "./run-card";
import { VesperRunDetail } from "./run-detail";

/**
 * Activity.
 *
 * Durable task plans and their progress from `runs.list`, the plan and timeline
 * from the thread's own messages, approvals answered through `threads.answer`,
 * and receipts from `effects.list` where `ExternalEffect` rows exist.
 *
 * `refreshToken` is bumped by the shell when a run event arrives on the chat's
 * SSE stream, so this stays live without a timer of its own.
 */
export function VesperActivityScreen({
  botId,
  refreshToken,
  onOpenChat,
}: {
  botId: string | null;
  refreshToken: number;
  onOpenChat: () => void;
}) {
  const [runs, setRuns] = useState<RunActivityRow[]>([]);
  const [messages, setMessages] = useState<ActivityMessage[]>([]);
  const [receipts, setReceipts] = useState<EffectReceipt[]>([]);
  const [filter, setFilter] = useState<VesperActivityFilter>("all");
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!botId) return;
      setError(null);
      const [activity, thread, effects] = await Promise.allSettled([
        fetchSpaceActivity(),
        rpc<MobileSnapshot>("threads/get", { botId }, { signal }),
        rpc<{ effects: EffectReceipt[] }>("effects/list", {}, { signal }),
      ]);
      if (signal.aborted) return;
      if (activity.status === "fulfilled") {
        setRuns(mergeActivityRuns(activity.value.active, activity.value.recent));
      }
      if (thread.status === "fulfilled") setMessages(thread.value.messages);
      // Receipts are additive: a deployment without the procedure still shows
      // plans and approvals rather than an error banner.
      if (effects.status === "fulfilled") setReceipts(effects.value.effects);
      if (activity.status === "rejected") {
        setError(
          activity.reason instanceof Error
            ? activity.reason.message
            : t("Could not load your activity"),
        );
      }
      setLoading(false);
    },
    [botId],
  );

  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal).catch(() => undefined);
    return () => abort.abort();
  }, [load, refreshToken]);

  /** Answers go back on the same thread the ask came from. */
  const answer = useCallback(
    async (ask: ActivityAsk, value: string, username?: string) => {
      if (!botId) return;
      await rpc("threads/answer", {
        botId,
        runId: ask.runId,
        messageId: ask.messageId,
        answer: value,
        ...(username ? { username } : {}),
      });
      const abort = new AbortController();
      await load(abort.signal).catch(() => undefined);
    },
    [botId, load],
  );

  const approvals = pendingApprovals(messages);
  const visible = filterActivityRuns(runs, filter);
  const openRun = runs.find((run) => run.runId === openRunId) ?? null;

  const stopRun = useCallback(async () => {
    if (!botId) return;
    setStopping(true);
    try {
      await rpc("threads/stop", { botId });
      setOpenRunId(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not stop this"));
    } finally {
      setStopping(false);
    }
  }, [botId]);

  return (
    <View style={{ gap: 18 }}>
      <ErrorNotice error={error} />

      {approvals.length > 0 && (
        <View style={{ gap: 12 }}>
          <View style={[s.row, { gap: 8 }]}>
            <ShieldCheck size={15} color={colors.blueDark} />
            <Text style={[s.heading, { flex: 1 }]}>{t("Waiting on you")}</Text>
          </View>
          {approvals.map((approval) => (
            <VesperAskCard
              key={approval.messageId}
              block={approval.block as VesperAsk}
              onAnswer={(_block, value, username) => answer(approval, value, username)}
            />
          ))}
        </View>
      )}

      <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
        {VESPER_ACTIVITY_FILTERS.map((entry) => (
          <Pressable
            key={entry}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === entry }}
            onPress={() => setFilter(entry)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: vt.radius.chip,
              backgroundColor: filter === entry ? vt.extras.navActive : colors.card,
            }}
          >
            <Text style={[s.small, filter === entry && { color: colors.text, fontWeight: "600" }]}>
              {activityFilterLabel(entry)}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ padding: 34, alignItems: "center" }}>
          <ActivityIndicator color={colors.blueDark} />
        </View>
      ) : visible.length === 0 ? (
        <Empty
          icon={PanelsTopLeft}
          title={filter === "all" ? t("Nothing running") : t("Nothing here")}
          detail={t("Plans, progress and results land here as your agent works.")}
        />
      ) : (
        <View>
          {visible.map((run) => (
            <VesperRunCard
              key={run.runId}
              run={run}
              plan={planForRun(messages, run.runId)}
              onPress={() => setOpenRunId(run.runId)}
            />
          ))}
        </View>
      )}

      {receipts.length > 0 && (
        <View>
          <SectionHeading title={t("Reviews & receipts")} />
          {receipts.slice(0, 10).map((receipt) => (
            <VesperReceiptCard key={receipt.id} receipt={receipt} />
          ))}
        </View>
      )}

      {!!openRun && (
        <VesperRunDetail
          run={openRun}
          messages={messages}
          receipts={receipts}
          stopping={stopping}
          onClose={() => setOpenRunId(null)}
          onAnswer={answer}
          onOpenChat={() => {
            setOpenRunId(null);
            onOpenChat();
          }}
          onStop={() => void stopRun()}
        />
      )}
    </View>
  );
}
