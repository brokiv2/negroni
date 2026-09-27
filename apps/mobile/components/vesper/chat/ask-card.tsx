import type { MessageBlock } from "@rakazo/contracts";
import { isSecretAskBlock } from "@rakazo/core";
import { ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { t } from "../../../lib/i18n";
import { approvalNotes, approvalRows } from "../../../lib/vesper/approvals";
import { Button } from "../kit";
import { colors, s, vt } from "../theme";

export type VesperAsk = Extract<MessageBlock, { kind: "ask" }>;

/**
 * The one place an `ask` is rendered — in the transcript and in Activity alike.
 *
 * Three shapes in one card, because the backend treats them as one block:
 * a choice between named actions, a free-text question, and a secret. The secret
 * is masked, cleared the moment it is submitted, and never echoed back: an
 * answered secret says "Saved", never the value.
 *
 * An approval keeps its exact recipient and action as labelled rows rather than
 * folding them into prose, so what is being approved cannot drift from what runs.
 */
export function VesperAskCard({
  block,
  canAnswer = true,
  onAnswer,
}: {
  block: VesperAsk;
  /** False while another participant owns the answer. */
  canAnswer?: boolean;
  onAnswer?: (block: VesperAsk, answer: string, username?: string) => Promise<void> | void;
}) {
  const [answer, setAnswer] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = block.status === "answered";
  const secret = isSecretAskBlock(block);
  const login = secret && block.credential?.auth.type === "login";
  const approval = !!block.approvalEffectId;
  const actions = block.actions ?? [];
  // No named actions means the answer is typed: a secret, an `input: "text"`
  // question, or a bare ask. Matching Negroni, all three get a field.
  const wantsField = actions.length === 0;

  const secretLabel =
    login || block.purpose === "password"
      ? t("Password")
      : block.purpose === "api_key"
        ? t("API key")
        : t("Code");
  const fieldLabel = secret ? secretLabel : t("Your answer");
  const incomplete = (secret ? answer.length === 0 : !answer.trim()) || (login && !username.trim());

  async function submit(value: string, withUsername?: string) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // Clear before the round trip: a masked field that lingers is still a field
    // holding a live secret.
    if (secret) setAnswer("");
    try {
      await onAnswer?.(block, value, withUsername);
    } catch (failure) {
      setError(
        !secret && failure instanceof Error ? failure.message : t("Could not send your answer"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const rows = approval ? approvalRows(block.detail) : [];
  const notes = approval ? approvalNotes(block.detail) : [];

  return (
    <View
      style={{
        backgroundColor: answered
          ? vt.extras.tintGreen
          : approval
            ? vt.extras.tintLavender
            : vt.extras.tintSky,
        borderRadius: vt.radius.card,
        padding: vt.space.cardPadding,
        gap: 11,
        maxWidth: vt.size.toolCardMaxWidth,
        width: "100%",
      }}
    >
      {approval && !answered && (
        <View style={[s.row, { gap: 7 }]}>
          <ShieldCheck size={14} color={colors.blueDark} />
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            {t("One last look")}
          </Text>
        </View>
      )}
      <Text style={[s.text, { fontWeight: "500" }]}>{block.text}</Text>

      {secret && !!block.credential && <Text style={s.small}>{block.credential.origin}</Text>}

      {rows.length > 0 && (
        <View style={{ gap: 7 }}>
          {rows.map((row) => (
            <View key={`${row.k}:${row.v}`} style={{ gap: 2 }}>
              <Text style={s.label}>{row.k}</Text>
              <Text style={s.text}>{row.v}</Text>
            </View>
          ))}
        </View>
      )}
      {notes.map((note) => (
        <Text key={note} style={s.muted}>
          {note}
        </Text>
      ))}
      {!approval && !secret && !!block.detail && <Text style={s.muted}>{block.detail}</Text>}

      {answered ? (
        <Text style={[s.small, { color: vt.extras.checkOk }]}>
          {secret ? t("Saved") : t("Answered: {answer}", { answer: block.answer ?? t("Done") })}
        </Text>
      ) : !canAnswer ? (
        <Text style={s.small}>{t("Waiting on someone else to answer this.")}</Text>
      ) : (
        <>
          {actions.length > 0 && (
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {actions.map((action) => (
                <Button
                  key={action.id}
                  small
                  busy={submitting}
                  primary={action.outcome !== "cancelled" && action.id !== "deny"}
                  danger={action.id === "deny" || action.outcome === "cancelled"}
                  onPress={() => void submit(action.id)}
                >
                  {action.label}
                </Button>
              ))}
            </View>
          )}
          {wantsField && (
            <>
              {login && (
                <TextInput
                  accessibilityLabel={t("Username")}
                  value={username}
                  onChangeText={setUsername}
                  placeholder={t("Username")}
                  placeholderTextColor={vt.extras.placeholder}
                  autoComplete="off"
                  autoCorrect={false}
                  autoCapitalize="none"
                  editable={!submitting}
                  style={s.input}
                />
              )}
              <TextInput
                accessibilityLabel={fieldLabel}
                value={answer}
                onChangeText={setAnswer}
                placeholder={fieldLabel}
                placeholderTextColor={vt.extras.placeholder}
                secureTextEntry={secret}
                autoComplete="off"
                autoCorrect={!secret}
                autoCapitalize={secret ? "none" : "sentences"}
                editable={!submitting}
                multiline={!secret}
                onSubmitEditing={() =>
                  void submit(secret ? answer : answer.trim(), login ? username.trim() : undefined)
                }
                style={[s.input, !secret && { minHeight: 76, textAlignVertical: "top" }]}
              />
              <Button
                small
                primary
                busy={submitting}
                disabled={incomplete}
                style={{ alignSelf: "flex-end" }}
                onPress={() =>
                  void submit(secret ? answer : answer.trim(), login ? username.trim() : undefined)
                }
              >
                {secret ? t("Save") : t("Send answer")}
              </Button>
            </>
          )}
        </>
      )}

      {!!error && <Text style={[s.small, { color: colors.danger }]}>{error}</Text>}
    </View>
  );
}
