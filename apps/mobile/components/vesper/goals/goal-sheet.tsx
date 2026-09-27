import type { ScratchpadItem } from "@rakazo/contracts";
import { useState } from "react";
import { Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import { goalPlanPrompt, goalStatusLabel } from "../../../lib/vesper/goals";
import { Button, Chip, ErrorNotice, Field, Sheet } from "../kit";
import { colors, s } from "../theme";

function newClientNonce(): string {
  return `vesper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a goal. `ScratchpadItem` has a title and free-text notes, and that is all. */
export function GoalFormSheet({
  botId,
  placeholder,
  onClose,
  onCreated,
}: {
  botId: string;
  placeholder: string;
  onClose: () => void;
  onCreated: (goal: ScratchpadItem) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await rpc<ScratchpadItem>("scratchpad/create", {
          botId,
          title: title.trim(),
          notes: notes.trim(),
          status: "open",
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t("Create a goal")} onClose={onClose}>
      <Field
        label={t("Your goal")}
        value={title}
        onChangeText={setTitle}
        placeholder={placeholder}
      />
      <Field
        label={t("What does done look like?")}
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      {/* Milestones are a column Negroni does not have yet, so this stays one
          free-text field rather than a checklist that cannot be checked off. */}
      <Text style={[s.small, { marginBottom: 14 }]}>
        {t("Vesper reads this when you ask it to plan the next steps.")}
      </Text>
      <ErrorNotice error={error} />
      <Button primary busy={busy} disabled={!title.trim()} onPress={() => void save()}>
        {t("Create goal")}
      </Button>
    </Sheet>
  );
}

/** One goal: edit it, finish it, park it back into Ideas, or hand it to the assistant. */
export function GoalSheet({
  goal,
  onClose,
  onChanged,
  onRemoved,
  onHandedToChat,
}: {
  goal: ScratchpadItem;
  onClose: () => void;
  onChanged: (goal: ScratchpadItem) => void;
  onRemoved: (itemId: string) => void;
  onHandedToChat: () => void;
}) {
  const [title, setTitle] = useState(goal.title);
  const [notes, setNotes] = useState(goal.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edited = title.trim() !== goal.title || notes !== goal.notes;

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Record<string, unknown>) =>
    void run(async () => {
      onChanged(await rpc<ScratchpadItem>("scratchpad/update", { itemId: goal.id, ...patch }));
    });

  const plan = () =>
    void run(async () => {
      await rpc("threads/send", {
        botId: goal.botId,
        threadKind: "personal",
        text: goalPlanPrompt({ title, notes }),
        clientNonce: newClientNonce(),
      });
      onHandedToChat();
    });

  const remove = () =>
    void run(async () => {
      await rpc("scratchpad/remove", { itemId: goal.id });
      onRemoved(goal.id);
    });

  return (
    <Sheet title={goal.title} onClose={onClose}>
      <View style={{ marginBottom: 16 }}>
        <Chip tint={goal.status === "done" ? colors.green : colors.sky}>
          {goalStatusLabel(goal.status)}
        </Chip>
      </View>
      <Field label={t("Your goal")} value={title} onChangeText={setTitle} />
      <Field
        label={t("What does done look like?")}
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {edited && (
          <Button
            small
            primary
            busy={busy}
            disabled={!title.trim()}
            onPress={() => update({ title: title.trim(), notes })}
          >
            {t("Save")}
          </Button>
        )}
        <Button small busy={busy} onPress={plan}>
          {t("Plan next steps")}
        </Button>
        {goal.status === "done" ? (
          <Button small busy={busy} onPress={() => update({ status: "open" })}>
            {t("Reopen")}
          </Button>
        ) : (
          <Button small busy={busy} onPress={() => update({ status: "done" })}>
            {t("Complete goal")}
          </Button>
        )}
        {goal.status !== "parked" && (
          <Button small busy={busy} onPress={() => update({ status: "parked" })}>
            {t("Park in Ideas")}
          </Button>
        )}
        <Button small danger busy={busy} onPress={remove}>
          {t("Delete")}
        </Button>
      </View>
      <Text style={[s.small, { marginTop: 16 }]}>
        {t("Planning sends this goal to your conversation, where the reply lands.")}
      </Text>
    </Sheet>
  );
}
