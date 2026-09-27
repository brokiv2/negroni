import type { ScratchpadItem } from "@rakazo/contracts";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import { ideaGlyph, ideaStartMessage, ideaSummary } from "../../../lib/vesper/ideas";
import { Button, ErrorNotice, Field } from "../kit";
import { colors, s } from "../theme";

function newClientNonce(): string {
  return `vesper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One parked idea.
 *
 * Collapsed it is a glyph, a title and the first line of its notes. Expanded it
 * offers the three things the reference design offers: edit, accept, dismiss.
 * Accepting splits in two here, because Negroni has two honest destinations —
 * a goal you keep, or a message that starts the work now.
 */
export function IdeaCard({
  idea,
  onChanged,
  onRemoved,
  onHandedToChat,
}: {
  idea: ScratchpadItem;
  onChanged: (idea: ScratchpadItem) => void;
  onRemoved: (itemId: string) => void;
  onHandedToChat: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [notes, setNotes] = useState(idea.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const save = () =>
    void run(async () => {
      onChanged(
        await rpc<ScratchpadItem>("scratchpad/update", {
          itemId: idea.id,
          title: title.trim(),
          notes,
        }),
      );
      setEditing(false);
    });

  const makeGoal = () =>
    void run(async () => {
      onChanged(
        await rpc<ScratchpadItem>("scratchpad/update", { itemId: idea.id, status: "open" }),
      );
    });

  const start = () =>
    void run(async () => {
      await rpc("threads/send", {
        botId: idea.botId,
        threadKind: "personal",
        text: ideaStartMessage({ title, notes }),
        clientNonce: newClientNonce(),
      });
      onHandedToChat();
    });

  const dismiss = () =>
    void run(async () => {
      await rpc("scratchpad/remove", { itemId: idea.id });
      onRemoved(idea.id);
    });

  const summary = ideaSummary(idea.notes);

  return (
    <View style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("View idea: {title}", { title: idea.title })}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: "row", gap: 14 }}
      >
        <Text style={{ fontSize: 27, width: 34, paddingTop: 3 }}>{ideaGlyph(idea.title)}</Text>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={s.heading}>{idea.title}</Text>
          {!!summary && <Text style={s.muted}>{summary}</Text>}
        </View>
      </Pressable>
      {expanded && (
        <View style={{ gap: 15, marginTop: 18, paddingLeft: 48 }}>
          {editing ? (
            <>
              <Field label={t("The idea")} value={title} onChangeText={setTitle} />
              <Field label={t("Why it matters")} value={notes} onChangeText={setNotes} multiline />
            </>
          ) : (
            !!idea.notes.trim() && <Text style={s.text}>{idea.notes.trim()}</Text>
          )}
          {/* Where the reference design lists sources, Negroni has no evidence
              model to list. Saying so beats an empty "Sources" heading. */}
          <Text style={s.small}>{t("Vesper cannot show sources for an idea yet.")}</Text>
          <ErrorNotice error={error} />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {editing ? (
              <Button small primary busy={busy} disabled={!title.trim()} onPress={save}>
                {t("Save")}
              </Button>
            ) : (
              <Button small primary busy={busy} onPress={start}>
                {t("Start this")}
              </Button>
            )}
            <Button small busy={busy} onPress={makeGoal}>
              {t("Make it a goal")}
            </Button>
            <Button small disabled={busy} onPress={() => setEditing(!editing)}>
              {editing ? t("Cancel") : t("Edit")}
            </Button>
            <Button small danger busy={busy} onPress={dismiss}>
              {t("Dismiss")}
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
