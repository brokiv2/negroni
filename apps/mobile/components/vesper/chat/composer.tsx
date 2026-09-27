import { ArrowUp, Square, X } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { t } from "../../../lib/i18n";
import {
  composerAction,
  composerActionEnabled,
  composerPlaceholder,
  composerQueueEnabled,
  composerSecondaryAction,
  type VesperComposerState,
} from "../../../lib/vesper/composer";
import type { VesperQueueSnapshot } from "../../../lib/vesper/follow-up-queue";
import { Button } from "../kit";
import { colors, s, shadow, vt } from "../theme";

/**
 * The composer pill: `+` on the left, growing input in the middle, and one
 * button on the right that is a send arrow while idle and a stop square during a
 * run — same slot, same size, so the thumb never has to move.
 */
export function VesperComposer({
  state,
  loading,
  error,
  attachments,
  onDraftChange,
  onSubmit,
  onStop,
  onPickAttachment,
  onRemoveAttachment,
}: {
  state: VesperComposerState;
  loading: boolean;
  error: boolean;
  attachments: { id: string; name: string }[];
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onPickAttachment: () => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(vt.size.composerInputMinHeight);
  const action = composerAction(state);
  const enabled = composerActionEnabled(state);
  const stopping = action === "stop";
  // Option (c): during a run a typed draft gets its own arrow next to the stop
  // square, and goes into the durable follow-up queue instead of being stranded.
  const queueing = composerSecondaryAction(state) === "queue";
  const queueEnabled = composerQueueEnabled(state);
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: vt.radius.composer,
          borderWidth: 1,
          borderColor: focused ? vt.extras.inputBorderFocus : vt.extras.inputBorder,
          padding: vt.space.composerPadding,
        },
        shadow(focused ? "composerFocused" : "composer"),
      ]}
    >
      {attachments.length > 0 && (
        <View style={[s.row, { gap: 6, flexWrap: "wrap", padding: 9 }]}>
          {attachments.map((file) => (
            <Pressable
              key={file.id}
              accessibilityRole="button"
              accessibilityLabel={t("Remove attachment: {name}", { name: file.name })}
              onPress={() => onRemoveAttachment(file.id)}
              style={[
                s.row,
                {
                  gap: 7,
                  maxWidth: "100%",
                  backgroundColor: colors.sky,
                  borderRadius: 16,
                  paddingHorizontal: 11,
                  paddingVertical: 8,
                },
              ]}
            >
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: colors.text }}>
                {file.name}
              </Text>
              <X size={13} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={[s.row, { gap: vt.space.composerGap, alignItems: "flex-end" }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Attach a document")}
          onPress={onPickAttachment}
          style={({ pressed }) => ({
            width: vt.size.touchTarget,
            height: vt.size.touchTarget,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: vt.radius.composerButton,
            backgroundColor: pressed ? colors.sky : "transparent",
          })}
        >
          <Text style={{ color: colors.text, fontSize: 29, fontWeight: "300", lineHeight: 32 }}>
            +
          </Text>
        </Pressable>
        <TextInput
          accessibilityLabel={t("Message…")}
          value={state.draft}
          onChangeText={onDraftChange}
          onContentSizeChange={(event) =>
            setInputHeight(
              Math.max(
                vt.size.composerInputMinHeight,
                Math.min(vt.size.composerInputMaxHeight, event.nativeEvent.contentSize.height),
              ),
            )
          }
          placeholder={composerPlaceholder({ ready: state.ready, loading, error })}
          placeholderTextColor={vt.extras.placeholder}
          selectionColor={colors.blueDark}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: colors.text,
            height: inputHeight,
            minHeight: vt.size.composerInputMinHeight,
            maxHeight: vt.size.composerInputMaxHeight,
            ...vt.type.composerInput,
            paddingHorizontal: 2,
            paddingTop: 10,
            paddingBottom: 10,
          }}
          multiline
          onKeyPress={
            Platform.OS === "web"
              ? (event) => {
                  const native = event.nativeEvent as { key: string; shiftKey?: boolean };
                  if (native.key === "Enter" && !native.shiftKey) {
                    event.preventDefault();
                    onSubmit();
                  }
                }
              : undefined
          }
        />
        {stopping && queueing && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Send when this finishes")}
            disabled={!queueEnabled}
            onPress={onSubmit}
            style={({ pressed }) => ({
              width: vt.size.touchTarget,
              height: vt.size.touchTarget,
              borderRadius: vt.radius.composerButton,
              backgroundColor: queueEnabled ? colors.sky : vt.extras.sendIdleBg,
              alignItems: "center",
              justifyContent: "center",
              opacity: queueEnabled ? 1 : 0.6,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <ArrowUp
              size={25}
              strokeWidth={1.8}
              color={queueEnabled ? colors.blueDark : vt.extras.sendIdleInk}
            />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stopping ? t("Stop reply") : t("Send message")}
          disabled={!enabled}
          onPress={stopping ? onStop : onSubmit}
          style={({ pressed }) => ({
            width: vt.size.touchTarget,
            height: vt.size.touchTarget,
            borderRadius: vt.radius.composerButton,
            backgroundColor: enabled || stopping ? colors.blue : vt.extras.sendIdleBg,
            alignItems: "center",
            justifyContent: "center",
            opacity: enabled ? 1 : 0.6,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          {stopping ? (
            <Square size={18} fill={colors.text} strokeWidth={0} />
          ) : (
            <ArrowUp
              size={25}
              strokeWidth={1.8}
              color={enabled ? colors.text : vt.extras.sendIdleInk}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** "Up next" — the durable follow-ups waiting to go out. */
export function FollowUpQueue({
  queue,
  onRemove,
  onResume,
  onRetry,
}: {
  queue: VesperQueueSnapshot;
  onRemove: (id: string) => void;
  onResume: () => void;
  onRetry: (id: string) => void;
}) {
  if (!queue.entries.length) return null;
  return (
    <View style={{ padding: 12, gap: 6 }}>
      <Text style={s.small}>{queue.paused ? t("Messages on hold") : t("Up next")}</Text>
      {queue.entries.map((entry) => (
        <View key={entry.id} style={{ gap: 4 }}>
          <View style={[s.row, { gap: 8 }]}>
            <Text numberOfLines={2} style={[s.muted, { flex: 1 }]}>
              {entry.text}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Remove queued message: {text}", { text: entry.text })}
              hitSlop={10}
              onPress={() => onRemove(entry.id)}
              style={{ padding: 8 }}
            >
              <X size={16} color={colors.muted} />
            </Pressable>
          </View>
          {entry.status === "failed" && (
            <View style={[s.row, { gap: 8 }]}>
              <Text style={[s.small, { color: colors.danger, flex: 1 }]}>
                {entry.error ?? t("Could not send")}
              </Text>
              <Button small onPress={() => onRetry(entry.id)}>
                {t("Try again")}
              </Button>
            </View>
          )}
        </View>
      ))}
      {queue.paused && !queue.entries.some((entry) => entry.status === "failed") && (
        <Button small onPress={onResume}>
          {t("Send queued messages")}
        </Button>
      )}
    </View>
  );
}
