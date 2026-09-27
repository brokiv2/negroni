import type { Bot, MemoryDocument } from "@rakazo/contracts";
import { BrainCircuit } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  applyToneInstruction,
  avatarVariantColor,
  avatarVariantFromColor,
  avatarVariantLabel,
  memoryDocumentTitle,
  memoryLineCount,
  memoryPreviewLines,
  memoryScopeLabel,
  sortMemoryDocuments,
  toneDetail,
  toneFromInstructions,
  toneLabel,
  VESPER_AVATAR_VARIANTS,
  VESPER_TONES,
  type VesperAvatarVariantName,
  type VesperTone,
} from "../../../lib/vesper/memory";
import { VesperAvatar } from "../avatar";
import { Button, Card, CheckRow, Empty, ErrorNotice, Field, SectionHeading } from "../kit";
import { colors, s, vt } from "../theme";
import { useAssistantMemory } from "./assistant-scope";
import { MemorySheet } from "./memory-sheet";

/**
 * Personal context: the assistant's name, face and tone, and what it remembers.
 *
 * Name, tone and avatar all live on the same `Bot` row Negroni already uses, so
 * a rename here is a rename everywhere. Tone writes a fenced block into the
 * bot's instructions rather than overwriting them — see `lib/vesper/memory.ts`.
 *
 * Memory is whole markdown documents with a revision counter, not atomic facts,
 * so this screen edits documents. "Forget one thing" means editing the document
 * that holds it, which is what the sheet does.
 */
export function VesperContextScreen({ botId }: { botId: string | null }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [variant, setVariant] = useState<VesperAvatarVariantName>("sky");
  const [tone, setTone] = useState<VesperTone | null>(null);
  const [openDocument, setOpenDocument] = useState<MemoryDocument | null>(null);
  const memory = useAssistantMemory(botId);

  const adopt = useCallback((row: Bot) => {
    setBot(row);
    setName(row.name);
    setVariant(avatarVariantFromColor(row.color));
    setTone(toneFromInstructions(row.instructions));
  }, []);

  useEffect(() => {
    if (!botId) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    void rpc<Bot>("bots/get", { botId }, { signal: abort.signal })
      .then((row) => {
        if (abort.signal.aborted) return;
        adopt(row);
      })
      .catch((failure: Error) => {
        if (!abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [adopt, botId]);

  const update = (patch: Record<string, unknown>) => {
    if (!botId || saving) return;
    setSaving(true);
    setError(null);
    void rpc<Bot>("bots/update", { botId, ...patch })
      .then(adopt)
      .catch((failure: Error) => {
        setError(failure.message);
        // Roll the optimistic tint and tone back, so the controls never claim
        // a setting the server did not take.
        if (bot) adopt(bot);
      })
      .finally(() => setSaving(false));
  };

  const documents = sortMemoryDocuments(memory.documents);
  const dirtyName = !!bot && name.trim().length > 0 && name.trim() !== bot.name;

  if (loading) {
    return (
      <View style={{ paddingVertical: 40 }}>
        <ActivityIndicator color={colors.blueDark} />
      </View>
    );
  }

  return (
    <View style={{ gap: 22 }}>
      <ErrorNotice error={error} />

      <Card style={{ gap: 12 }}>
        <SectionHeading title={t("Your assistant")} />
        <View style={[s.row, { gap: 16, justifyContent: "center", marginBottom: 12 }]}>
          {VESPER_AVATAR_VARIANTS.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={t("{tint} avatar", { tint: avatarVariantLabel(option) })}
              accessibilityState={{ checked: variant === option }}
              disabled={saving}
              onPress={() => {
                setVariant(option);
                update({ color: avatarVariantColor(option) });
              }}
              style={{
                padding: 7,
                borderRadius: 24,
                backgroundColor: variant === option ? colors.sky : colors.canvas,
              }}
            >
              <VesperAvatar size={62} variant={option} />
            </Pressable>
          ))}
        </View>
        <Field label={t("Name")} value={name} onChangeText={setName} />
        {dirtyName && (
          <Button
            primary
            small
            busy={saving}
            onPress={() => update({ name: name.trim() })}
            style={{ alignSelf: "flex-start" }}
          >
            {t("Save name")}
          </Button>
        )}
        <Text style={[s.small, { marginTop: 6, color: colors.text, fontWeight: "600" }]}>
          {t("Tone")}
        </Text>
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {VESPER_TONES.map((option) => (
            <Button
              key={option}
              small
              primary={tone === option}
              busy={saving && tone === option}
              onPress={() =>
                update({
                  instructions: applyToneInstruction(
                    bot?.instructions ?? "",
                    tone === option ? null : option,
                  ),
                })
              }
            >
              {toneLabel(option)}
            </Button>
          ))}
        </View>
        {!!tone && <Text style={s.small}>{toneDetail(tone)}</Text>}
        <Text style={s.small}>
          {t("A tone is added to the instructions. Anything you wrote by hand stays.")}
        </Text>
      </Card>

      <Card style={{ gap: 10 }}>
        <SectionHeading title={t("Background updates")} />
        <CheckRow
          label={t("Tell me when work finishes on its own")}
          checked={!!bot?.notifyOnFinish}
          onPress={() => update({ notifyOnFinish: !bot?.notifyOnFinish })}
        />
        <Text style={s.small}>
          {t(
            "Each tracking check has its own switch. Approvals always reach you, whatever this says.",
          )}
        </Text>
      </Card>

      <Card style={{ gap: 12 }}>
        <SectionHeading title={t("Memory")} />
        <Text style={s.muted}>{t("What Vesper knows. Read it, correct it, cut it.")}</Text>
        <ErrorNotice error={memory.error} />
        {memory.loading && <ActivityIndicator color={colors.blueDark} />}
        {documents.map((document) => (
          <MemoryRow key={document.id} document={document} onOpen={setOpenDocument} />
        ))}
        {!documents.length && !memory.loading && (
          <Empty
            icon={BrainCircuit}
            title={t("Nothing remembered yet")}
            detail={t("As you talk, Vesper writes down what is worth keeping. It shows up here.")}
          />
        )}
      </Card>

      {!!openDocument && (
        <MemorySheet
          document={openDocument}
          onClose={() => setOpenDocument(null)}
          onSaved={(next) => {
            memory.applyDocument(next);
            setOpenDocument(null);
          }}
        />
      )}
    </View>
  );
}

function MemoryRow({
  document,
  onOpen,
}: {
  document: MemoryDocument;
  onOpen: (document: MemoryDocument) => void;
}) {
  const lines = memoryPreviewLines(document.content, 4);
  const total = memoryLineCount(document.content);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Edit memory: {title}", { title: memoryDocumentTitle(document) })}
      onPress={() => onOpen(document)}
      style={({ pressed }) => [
        {
          gap: 7,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          borderRadius: 10,
        },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <Text style={[s.text, { fontWeight: "500" }]}>{memoryDocumentTitle(document)}</Text>
      {lines.map((line, index) => (
        <Text
          // Memory lines have no ids: this is a preview of one document, not a list of rows.
          key={`${document.id}-${index}`}
          numberOfLines={2}
          style={s.muted}
        >
          {line}
        </Text>
      ))}
      {!lines.length && <Text style={s.muted}>{t("Empty so far.")}</Text>}
      <Text style={[s.small, { color: vt.extras.listChevron }]}>
        {t("{scope} · {count} lines · revision {revision}", {
          scope: memoryScopeLabel(document.scope),
          count: total,
          revision: document.revision,
        })}
      </Text>
    </Pressable>
  );
}
