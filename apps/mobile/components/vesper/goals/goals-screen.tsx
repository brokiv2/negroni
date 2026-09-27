import type { Routine, ScratchpadItem } from "@rakazo/contracts";
import {
  ChevronRight,
  CircleDollarSign,
  Heart,
  type LucideIcon,
  Plus,
  Square,
  SquareCheck,
  Target,
  Users,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { t } from "../../../lib/i18n";
import {
  completedGoalItems,
  goalCategoryLabel,
  goalCategoryPlaceholder,
  goalItems,
  trackingRoutines,
  trackingScheduleLabel,
  VESPER_GOAL_CATEGORIES,
  type VesperGoalCategory,
} from "../../../lib/vesper/goals";
import { useAssistantScope } from "../context/assistant-scope";
import { Button, ErrorNotice } from "../kit";
import { colors, s, vt } from "../theme";
import { GoalFormSheet, GoalSheet } from "./goal-sheet";
import { TrackingFormSheet, TrackingSheet } from "./tracking-sheet";

const CATEGORY_ICONS: Record<VesperGoalCategory, LucideIcon> = {
  health: Heart,
  relationships: Users,
  finances: CircleDollarSign,
  other: Target,
};

/**
 * Goals and Tracking.
 *
 * Two halves over two different tables: goals are `ScratchpadItem`s, tracking
 * is `Routine`s. Both fan out over the assistant hierarchy, because both are
 * bot-scoped.
 *
 * `ScratchpadItem` has no milestone column, so the milestone checklist the
 * reference design shows is not here. The goal sheet leaves the slot open with
 * a free-text "what done looks like" that writes to `notes` — the only field
 * available — rather than faking checkable milestones on top of a string.
 */
export function VesperGoalsScreen({
  botId,
  onOpenChat,
}: {
  botId: string | null;
  /** Called after a goal has been handed to the assistant, to show the reply. */
  onOpenChat: () => void;
}) {
  const scope = useAssistantScope(botId);
  const [creating, setCreating] = useState<VesperGoalCategory | null>(null);
  const [tracking, setTracking] = useState(false);
  const [openGoal, setOpenGoal] = useState<ScratchpadItem | null>(null);
  const [openRoutine, setOpenRoutine] = useState<Routine | null>(null);
  const [showAllTracking, setShowAllTracking] = useState(false);

  const goals = goalItems(scope.items);
  const done = completedGoalItems(scope.items);
  const checks = trackingRoutines(scope.routines);
  const visibleChecks = showAllTracking ? checks : checks.slice(0, 3);

  return (
    <View style={{ gap: 22 }}>
      {!!scope.error && (
        <View style={{ gap: 10 }}>
          <ErrorNotice error={scope.error} />
          <Button small onPress={() => void scope.reload()} style={{ alignSelf: "flex-start" }}>
            {t("Try again")}
          </Button>
        </View>
      )}

      <View style={{ gap: 8 }}>
        <View style={[s.between, { marginBottom: 5 }]}>
          <View style={[s.row, { gap: 10 }]}>
            <StatusDot fill={vt.extras.trackingDot} ring={vt.extras.trackingRing} />
            <Text style={[s.heading, { color: vt.extras.trackingInk }]}>{t("Tracking")}</Text>
          </View>
          <Button small icon={Plus} onPress={() => setTracking(true)} disabled={!botId}>
            {t("Track")}
          </Button>
        </View>
        {visibleChecks.map((routine) => (
          <ListRow
            key={routine.id}
            title={routine.name}
            detail={trackingScheduleLabel(routine)}
            label={t("Open tracking: {name}", { name: routine.name })}
            onPress={() => setOpenRoutine(routine)}
          />
        ))}
        {!checks.length && !scope.loading && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>
            {t("A price, a reservation, a page you want watched.")}
          </Text>
        )}
        {checks.length > 3 && (
          <Button small onPress={() => setShowAllTracking(!showAllTracking)}>
            {showAllTracking
              ? t("Show less")
              : t("Show {count} more", { count: checks.length - 3 })}
          </Button>
        )}
      </View>

      <View style={s.divider} />

      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 10, marginBottom: 5 }]}>
          <StatusDot fill={vt.extras.goalDot} ring={vt.extras.goalRing} />
          <Text style={[s.heading, { color: colors.blueDark }]}>{t("Goals")}</Text>
        </View>
        {goals.map((goal) => (
          <ListRow
            key={goal.id}
            title={goal.title}
            detail={goal.notes.trim() || t("In progress")}
            label={t("Open goal: {name}", { name: goal.title })}
            onPress={() => setOpenGoal(goal)}
          />
        ))}
        {done.map((goal) => (
          <ListRow
            key={goal.id}
            icon={SquareCheck}
            title={goal.title}
            detail={t("Complete")}
            label={t("Open goal: {name}", { name: goal.title })}
            onPress={() => setOpenGoal(goal)}
          />
        ))}
        {!goals.length && !done.length && !scope.loading && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>
            {t("Big plans start with one small step.")}
          </Text>
        )}
      </View>

      {scope.loading && <ActivityIndicator color={colors.blueDark} />}

      <View style={s.divider} />

      <Text style={s.heading}>{t("Create a goal")}</Text>
      {VESPER_GOAL_CATEGORIES.map((category) => {
        const Icon = CATEGORY_ICONS[category];
        return (
          <Pressable
            key={category}
            accessibilityRole="button"
            accessibilityLabel={t("Create a goal: {category}", {
              category: goalCategoryLabel(category),
            })}
            disabled={!botId}
            onPress={() => setCreating(category)}
            style={[s.row, { gap: 12, minHeight: 38, opacity: botId ? 1 : 0.5 }]}
          >
            <Icon size={23} color={vt.extras.categoryIcon} />
            <Text style={[s.text, { flex: 1, color: vt.extras.categoryInk }]}>
              {goalCategoryLabel(category)}
            </Text>
            <Plus size={18} color={vt.extras.categoryIcon} />
          </Pressable>
        );
      })}

      {!!creating && !!botId && (
        <GoalFormSheet
          botId={botId}
          placeholder={goalCategoryPlaceholder(creating)}
          onClose={() => setCreating(null)}
          onCreated={(goal) => {
            scope.applyItem(goal);
            setCreating(null);
          }}
        />
      )}
      {tracking && !!botId && (
        <TrackingFormSheet
          botId={botId}
          onClose={() => setTracking(false)}
          onCreated={(routine) => {
            scope.applyRoutine(routine);
            setTracking(false);
          }}
        />
      )}
      {!!openGoal && (
        <GoalSheet
          goal={openGoal}
          onClose={() => setOpenGoal(null)}
          onChanged={(goal) => {
            scope.applyItem(goal);
            setOpenGoal(goal);
          }}
          onRemoved={(itemId) => {
            scope.dropItem(itemId);
            setOpenGoal(null);
          }}
          onHandedToChat={() => {
            setOpenGoal(null);
            onOpenChat();
          }}
        />
      )}
      {!!openRoutine && (
        <TrackingSheet
          routine={openRoutine}
          onClose={() => setOpenRoutine(null)}
          onChanged={(routine) => {
            scope.applyRoutine(routine);
            setOpenRoutine(routine);
          }}
          onRemoved={(routineId) => {
            scope.dropRoutine(routineId);
            setOpenRoutine(null);
          }}
        />
      )}
    </View>
  );
}

function StatusDot({ fill, ring }: { fill: string; ring: string }) {
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 5,
        borderColor: ring,
        backgroundColor: fill,
      }}
    />
  );
}

function ListRow({
  title,
  detail,
  label,
  onPress,
  icon: Icon = Square,
}: {
  title: string;
  detail: string;
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { gap: 12, paddingVertical: 13, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <Icon size={21} color={vt.extras.listGlyph} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.text}>{title}</Text>
        <Text numberOfLines={2} style={s.muted}>
          {detail}
        </Text>
      </View>
      <ChevronRight size={18} color={vt.extras.listChevron} />
    </Pressable>
  );
}
