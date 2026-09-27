import type { ScratchpadItem } from "@rakazo/contracts";
import { Lightbulb, Plus } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import { ideaItems } from "../../../lib/vesper/ideas";
import { useAssistantScope } from "../context/assistant-scope";
import { Button, Card, Chip, Empty, ErrorNotice, Field, Sheet } from "../kit";
import { colors, s } from "../theme";
import { IdeaCard } from "./idea-card";

/**
 * Ideas.
 *
 * Parked `ScratchpadItem`s: things worth doing that nobody has committed to
 * yet. Accepting one either promotes it to a goal or hands it to the assistant;
 * dismissing one deletes the row.
 *
 * The reference design opens each suggestion onto its source evidence. Negroni
 * has no evidence model and no idea generator, so an idea shows its own notes
 * and the "Find ideas" refresh button is absent rather than wired to nothing.
 */
export function VesperIdeasScreen({
  botId,
  onOpenChat,
}: {
  botId: string | null;
  onOpenChat: () => void;
}) {
  const scope = useAssistantScope(botId);
  const [adding, setAdding] = useState(false);
  const ideas = ideaItems(scope.items);

  return (
    <View style={{ gap: 20 }}>
      <View style={s.between}>
        <Text style={s.small}>{t("Parked for later, by you or by Vesper.")}</Text>
        <Button small icon={Plus} onPress={() => setAdding(true)} disabled={!botId}>
          {t("Add")}
        </Button>
      </View>
      {!!scope.error && (
        <View style={{ gap: 10 }}>
          <ErrorNotice error={scope.error} />
          <Button small onPress={() => void scope.reload()} style={{ alignSelf: "flex-start" }}>
            {t("Try again")}
          </Button>
        </View>
      )}
      {ideas.map((idea) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          onChanged={scope.applyItem}
          onRemoved={scope.dropItem}
          onHandedToChat={onOpenChat}
        />
      ))}
      {scope.loading && <ActivityIndicator color={colors.blueDark} />}
      {!ideas.length && !scope.loading && (
        <Empty
          icon={Lightbulb}
          title={t("Room for a good idea")}
          detail={t("Park anything here you might want later. Nothing starts until you say so.")}
        />
      )}
      {adding && !!botId && (
        <IdeaFormSheet
          botId={botId}
          onClose={() => setAdding(false)}
          onCreated={(idea) => {
            scope.applyItem(idea);
            setAdding(false);
          }}
        />
      )}
    </View>
  );
}

function IdeaFormSheet({
  botId,
  onClose,
  onCreated,
}: {
  botId: string;
  onClose: () => void;
  onCreated: (idea: ScratchpadItem) => void;
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
          status: "parked",
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t("Park an idea")} onClose={onClose}>
      <Card style={{ gap: 4, marginBottom: 16 }}>
        <Chip tint={colors.sky}>{t("Nothing starts until you say so")}</Chip>
      </Card>
      <Field
        label={t("The idea")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("Look into a cheaper phone plan")}
      />
      <Field label={t("Why it matters")} value={notes} onChangeText={setNotes} multiline />
      <ErrorNotice error={error} />
      <Button primary busy={busy} disabled={!title.trim()} onPress={() => void save()}>
        {t("Park it")}
      </Button>
    </Sheet>
  );
}
