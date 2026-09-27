import type { EffectReceipt, RunActivityRow } from "@rakazo/contracts";
import { Check, X } from "lucide-react-native";
import { Text, View } from "react-native";
import { activityStatusLabel, formatActivityRelativeTime } from "../../../lib/activity";
import { t } from "../../../lib/i18n";
import {
  type ActivityAsk,
  type ActivityMessage,
  pendingAsks,
  planForRun,
  receiptsForRun,
  runResult,
  runTimeline,
} from "../../../lib/vesper/activity";
import { type VesperAsk, VesperAskCard } from "../chat/ask-card";
import { Button, SectionHeading, Sheet } from "../kit";
import { colors, s, vt } from "../theme";
import { VesperReceiptCard } from "./receipt-card";

/**
 * One run, in full: what it is waiting on, its plan, what it did, what it
 * produced, and the receipts for anything it changed in the outside world.
 *
 * Pause / resume / retry are Phase 9 — Negroni has `threads.stop` and steering,
 * and no pause RPC at all. Offering a button that cannot work would be worse
 * than not offering one, so the sheet stops at Stop.
 */
export function VesperRunDetail({
  run,
  messages,
  receipts,
  onClose,
  onAnswer,
  onOpenChat,
  onStop,
  stopping,
}: {
  run: RunActivityRow;
  messages: readonly ActivityMessage[];
  receipts: readonly EffectReceipt[];
  onClose: () => void;
  onAnswer: (ask: ActivityAsk, answer: string, username?: string) => Promise<void>;
  onOpenChat: () => void;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const plan = planForRun(messages, run.runId);
  const timeline = runTimeline(messages, run.runId);
  const result = runResult(messages, run.runId);
  const asks = pendingAsks(messages).filter((ask: ActivityAsk) => ask.runId === run.runId);
  const runReceipts = receiptsForRun(receipts, run.runId);
  const live = run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled";

  return (
    <Sheet
      title={run.promptSnippet || t("Task")}
      subtitle={t("{status} · {when}", {
        status: activityStatusLabel(run.status),
        when: formatActivityRelativeTime(run.updatedAt),
      })}
      onClose={onClose}
    >
      <View style={{ gap: 20 }}>
        {asks.length > 0 && (
          <View style={{ gap: 12 }}>
            {asks.map((ask) => (
              <VesperAskCard
                key={ask.messageId}
                block={ask.block as VesperAsk}
                onAnswer={(_block, value, username) => onAnswer(ask, value, username)}
              />
            ))}
          </View>
        )}

        {!!plan && (
          <View style={{ gap: 12 }}>
            <SectionHeading title={plan.title} />
            <View style={{ gap: 10 }}>
              {plan.steps.map((step, index) => (
                <View key={`${index}:${step.label}`} style={[s.row, { gap: 11 }]}>
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: vt.radius.checkbox,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: step.done
                        ? colors.green
                        : step.failed
                          ? colors.orange
                          : step.active
                            ? colors.sky
                            : colors.canvas,
                    }}
                  >
                    {step.done ? (
                      <Check size={12} color={vt.extras.checkOk} />
                    ) : step.failed ? (
                      <X size={12} color={colors.danger} />
                    ) : (
                      <Text style={[s.small, { color: colors.muted }]}>{index + 1}</Text>
                    )}
                  </View>
                  <Text
                    style={[
                      s.text,
                      { flex: 1 },
                      step.active && { fontWeight: "600" },
                      step.done && { color: colors.muted },
                    ]}
                  >
                    {step.label}
                  </Text>
                </View>
              ))}
            </View>
            {!!plan.note && <Text style={s.muted}>{plan.note}</Text>}
          </View>
        )}

        {!!result && (
          <View
            style={{
              backgroundColor: colors.green,
              borderRadius: vt.radius.card,
              padding: vt.space.cardPadding,
              gap: 7,
            }}
          >
            <Text style={s.label}>{t("Result")}</Text>
            <Text style={s.text}>{result}</Text>
          </View>
        )}

        {runReceipts.length > 0 && (
          <View>
            <SectionHeading title={t("Receipts")} />
            {runReceipts.map((receipt) => (
              <VesperReceiptCard key={receipt.id} receipt={receipt} />
            ))}
          </View>
        )}

        {timeline.length > 0 && (
          <View style={{ gap: 10 }}>
            <SectionHeading title={t("What happened")} />
            {timeline.map((entry) => (
              <View key={entry.id} style={[s.row, { gap: 11, alignItems: "flex-start" }]}>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    marginTop: 8,
                    backgroundColor: vt.extras.listGlyph,
                  }}
                />
                <Text style={[s.muted, { flex: 1 }]}>{entry.text}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button primary onPress={onOpenChat}>
            {t("Open in chat")}
          </Button>
          {live && !!onStop && (
            <Button danger busy={stopping} onPress={onStop}>
              {t("Stop this")}
            </Button>
          )}
        </View>
      </View>
    </Sheet>
  );
}
