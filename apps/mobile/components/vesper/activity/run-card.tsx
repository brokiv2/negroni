import type { RunActivityRow } from "@rakazo/contracts";
import { CircleCheck, CircleX, Loader, MessageCircleQuestion, Monitor } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { activityStatusLabel, formatActivityRelativeTime } from "../../../lib/activity";
import { t } from "../../../lib/i18n";
import { planFraction, runNeedsYou, type VesperRunPlan } from "../../../lib/vesper/activity";
import { colors, s, vt } from "../theme";

/**
 * One durable task.
 *
 * Icon tint carries the state at a glance: orange while it is waiting on the
 * person, sky otherwise. Under the title, the status and the step count; under
 * that, a progress bar only when there is a plan to measure — a bar sitting at
 * zero reads as stuck.
 */
export function VesperRunCard({
  run,
  plan,
  onPress,
}: {
  run: RunActivityRow;
  plan: VesperRunPlan | null;
  onPress: () => void;
}) {
  const waiting = runNeedsYou(run.status);
  const fraction = planFraction(plan);
  const Icon =
    run.status === "waiting_takeover"
      ? Monitor
      : run.status === "waiting_input"
        ? MessageCircleQuestion
        : run.status === "completed"
          ? CircleCheck
          : run.status === "failed" || run.status === "cancelled"
            ? CircleX
            : Loader;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Open task: {task}", { task: run.promptSnippet })}
      onPress={onPress}
      style={({ pressed }) => [
        s.card,
        { gap: 11, marginBottom: 11 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.row, { gap: 13 }]}>
        <View
          style={[
            s.iconBox,
            { width: 34, height: 34, backgroundColor: waiting ? colors.orange : colors.sky },
          ]}
        >
          <Icon size={16} color={waiting ? colors.text : colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={2} style={[s.text, { fontWeight: "500" }]}>
            {run.promptSnippet || t("Untitled task")}
          </Text>
          <Text style={s.small}>
            {plan
              ? t("{status} · {done}/{total} steps", {
                  status: activityStatusLabel(run.status),
                  done: plan.done,
                  total: plan.total,
                })
              : activityStatusLabel(run.status)}
          </Text>
        </View>
        <Text style={s.small}>{formatActivityRelativeTime(run.updatedAt)}</Text>
      </View>

      {fraction !== null && (
        <View
          style={{
            height: 4,
            borderRadius: vt.radius.progressBar,
            backgroundColor: colors.line,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 4,
              width: `${Math.round(fraction * 100)}%`,
              backgroundColor: vt.extras.progressFill,
            }}
          />
        </View>
      )}

      {!!plan?.note && (
        <Text numberOfLines={2} style={s.muted}>
          {plan.note}
        </Text>
      )}

      {waiting && (
        <Text style={[s.small, { color: colors.blueDark, fontWeight: "700" }]}>
          {run.status === "waiting_takeover"
            ? t("Ready for you at the computer")
            : t("Your input is needed")}
        </Text>
      )}
    </Pressable>
  );
}
