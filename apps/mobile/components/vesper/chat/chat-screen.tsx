import type { MessageBlock, PersonalThread } from "@rakazo/contracts";
import { isActive, isRunTerminalEvent } from "@rakazo/core";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import {
  applyMobileThreadEvent,
  type MobileSnapshot,
  mergeMobileSnapshot,
  rpc,
  subscribeThread,
} from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  type PickedAttachment,
  pickDocuments,
  pickFromLibrary,
  takePhoto,
} from "../../../lib/pick-attachments";
import {
  composerReducer,
  initialComposerState,
  shouldQueueSubmit,
} from "../../../lib/vesper/composer";
import { VesperFollowUpQueue, type VesperQueueSnapshot } from "../../../lib/vesper/follow-up-queue";
import { MobileChatModelPicker } from "../../model-routing";
import { Button, ErrorNotice } from "../kit";
import { colors, s, vt } from "../theme";
import { MessageBubble, TypingDots } from "./bubble";
import { FollowUpQueue, VesperComposer } from "./composer";

type ThreadTarget = { botId: string; threadKind: "personal" };

/** Distance from the bottom at which the transcript stops following the latest reply. */
const DETACH_THRESHOLD = 100;

function newId(): string {
  return `vesper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotIsRunning(snap: MobileSnapshot | null): boolean {
  if (!snap) return false;
  const runs = snap.activeRuns ?? (snap.run ? [snap.run] : []);
  return runs.some((run) => isActive(run.status as Parameters<typeof isActive>[0]));
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function VesperChatScreen({
  draftRequest,
  botId,
  onBotResolved,
  onRunsChanged,
  onThreadEvent,
  onOpenComputer,
  feedItemId,
  computerReachable,
  desktop,
}: {
  draftRequest?: { text: string; nonce: number };
  /** The main assistant's bot id, once `personal.thread` has resolved it. */
  botId: string | null;
  onBotResolved: (thread: PersonalThread) => void;
  onRunsChanged?: (snapshot: MobileSnapshot | null) => void;
  /** Every stream event, so the shell's pill and bell stay live without polling. */
  onThreadEvent?: (event: { type: string }) => void;
  onOpenComputer: () => void;
  feedItemId?: string;
  /** From `computer.status`, so a browser card never asserts its own liveness. */
  computerReachable: boolean;
  desktop: boolean;
}) {
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const snapRef = useRef<MobileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, dispatch] = useReducer(composerReducer, initialComposerState);
  useEffect(() => {
    if (draftRequest) dispatch({ kind: "draft", text: draftRequest.text });
  }, [draftRequest]);
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const queue = useMemo(() => new VesperFollowUpQueue(), []);
  const [queueState, setQueueState] = useState<VesperQueueSnapshot>(queue.getSnapshot());
  // Names for the composer chips. The ids themselves live in the reducer, which
  // is what `threads.send` takes.
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const list = useRef<ScrollView>(null);
  const followLatest = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const target: ThreadTarget | null = botId ? { botId, threadKind: "personal" } : null;
  const threadTarget = feedItemId ? { feedItemId } : target;

  useEffect(() => queue.subscribe(() => setQueueState(queue.getSnapshot())), [queue]);

  const commit = useCallback(
    (next: MobileSnapshot | null) => {
      snapRef.current = next;
      setSnap(next);
      onRunsChanged?.(next);
    },
    [onRunsChanged],
  );

  // Resolve the main assistant's Personal thread. Vesper drives the bot Negroni
  // already uses, so memory, routines and the computer carry over.
  useEffect(() => {
    if (botId) return;
    const abort = new AbortController();
    void rpc<PersonalThread>("personal/thread", {}, { signal: abort.signal })
      .then((thread) => {
        if (!abort.signal.aborted) onBotResolved(thread);
      })
      .catch((failure: Error) => {
        if (!abort.signal.aborted) setError(failure.message);
      });
    return () => abort.abort();
  }, [botId, onBotResolved]);

  const refresh = useCallback(async () => {
    if (!target) return null;
    const next = await rpc<MobileSnapshot>("threads/get", threadTarget);
    commit(mergeMobileSnapshot(snapRef.current, next, true));
    return next;
  }, [commit, target?.botId, feedItemId]);

  // Subscribe, never poll: the SSE stream is the source of truth and a dropped
  // connection resumes from the cursor rather than re-fetching on a timer.
  useEffect(() => {
    if (!target) return;
    const abort = new AbortController();
    void (async () => {
      const first = await refresh().catch((failure: Error) => {
        setError(failure.message);
        return null;
      });
      setLoading(false);
      dispatch({ kind: "ready", ready: true });
      let cursor = first?.cursor ?? -1;
      let retryMs = 250;
      while (!abort.signal.aborted) {
        try {
          await subscribeThread(
            threadTarget!,
            cursor,
            (event) => {
              cursor = Math.max(cursor, event.seq ?? -1);
              retryMs = 250;
              commit(applyMobileThreadEvent(snapRef.current, event));
              onThreadEvent?.(event);
              if (isRunTerminalEvent(event)) {
                dispatch({ kind: "run-ended" });
                void refresh().catch(() => undefined);
                // A finished turn is the moment held follow-ups can go out.
                void queue
                  .flush(async (entry) => {
                    await rpc("threads/followUp", { ...threadTarget, text: entry.text });
                  })
                  .catch((failure: Error) => setError(failure.message));
              }
            },
            abort.signal,
          );
        } catch {
          // The cursor resumes without gaps; a refresh reconciles what is visible.
        }
        if (abort.signal.aborted) break;
        await refresh().catch(() => undefined);
        await delay(retryMs, abort.signal);
        retryMs = Math.min(retryMs * 2, 5_000);
      }
    })();
    return () => abort.abort();
  }, [commit, onThreadEvent, queue, refresh, target?.botId, feedItemId]);

  const running = snapshotIsRunning(snap);
  useEffect(() => {
    dispatch({ kind: running ? "run-started" : "run-ended" });
  }, [running]);

  const submit = useCallback(() => {
    const state = composerRef.current;
    const text = state.draft.trim();
    if (!text && state.attachmentIds.length === 0) return;
    if (!target) return;
    followLatest.current = true;
    setAwayFromLatest(false);
    if (shouldQueueSubmit(state)) {
      // A live run owns the turn; this becomes a durable follow-up. `followUp`
      // carries text only, so an attachment stays on the composer for the next
      // real turn instead of being dropped here.
      if (!text) return;
      queue.enqueue({ id: newId(), text });
      dispatch({ kind: "draft", text: "" });
      return;
    }
    const artifactIds = [...state.attachmentIds];
    dispatch({ kind: "submit-started" });
    void rpc("threads/send", {
      ...threadTarget,
      ...(text ? { text } : {}),
      ...(artifactIds.length ? { artifactIds } : {}),
      clientNonce: newId(),
    })
      .then(() => {
        dispatch({ kind: "submit-succeeded" });
        dispatch({ kind: "run-started" });
        setAttachments((current) => current.filter((file) => !artifactIds.includes(file.id)));
      })
      .catch((failure: Error) => {
        dispatch({ kind: "submit-failed" });
        setError(failure.message);
      });
  }, [queue, target?.botId, feedItemId]);

  const stop = useCallback(() => {
    if (!target) return;
    // Held, not dropped: the draft and the queue both survive a stop.
    queue.pause();
    dispatch({ kind: "stop-requested" });
    void rpc("threads/stop", threadTarget).catch((failure: Error) => setError(failure.message));
  }, [queue, target?.botId, feedItemId]);

  const answer = useCallback(
    async (block: MessageBlock, value: string, username?: string) => {
      if (!target) return;
      const message = (snapRef.current?.messages ?? []).find((candidate) =>
        candidate.blocks.includes(block),
      );
      const runId = message?.runId ?? snapRef.current?.run?.id;
      if (!message || !runId) return;
      // A secret answer is posted and forgotten: it is never written back into
      // the snapshot, and the answered card says "Saved" rather than the value.
      await rpc("threads/answer", {
        ...threadTarget,
        runId,
        messageId: message.id,
        answer: value,
        ...(username ? { username } : {}),
      });
    },
    [target?.botId, feedItemId],
  );

  /**
   * `+` → pick → `artifacts.create` → `attachmentIds`.
   *
   * Uploading on pick rather than on send means the composer holds ids, not
   * megabytes of base64, and a failed upload is reported while the person is
   * still looking at the picker.
   */
  const addAttachments = useCallback(
    async (
      pick: (existingCount: number) => Promise<{
        attachments: PickedAttachment[];
        skipped: Array<{ name: string; reason: string }>;
      }>,
    ) => {
      if (!target) return;
      const held = composerRef.current.attachmentIds.length;
      let picked: Awaited<ReturnType<typeof pick>>;
      try {
        picked = await pick(held);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("Could not open the picker"));
        return;
      }
      for (const file of picked.attachments) {
        try {
          const artifact = await rpc<{ id: string }>("artifacts/create", {
            botId: target.botId,
            name: file.name,
            mimeType: file.mimeType,
            contentBase64: file.contentBase64,
          });
          dispatch({ kind: "attach", artifactIds: [artifact.id] });
          setAttachments((current) => [...current, { id: artifact.id, name: file.name }]);
        } catch (failure) {
          setError(
            failure instanceof Error
              ? failure.message
              : t("Could not attach {name}", { name: file.name }),
          );
        }
      }
      if (picked.skipped.length) {
        setError(
          t("Skipped {items}", {
            items: picked.skipped.map((skip) => `${skip.name} (${skip.reason})`).join(", "),
          }),
        );
      }
    },
    [target?.botId, feedItemId],
  );

  const showAttachMenu = useCallback(() => {
    Alert.alert(t("Attach"), undefined, [
      { text: t("Photo library"), onPress: () => void addAttachments(pickFromLibrary) },
      { text: t("Camera"), onPress: () => void addAttachments(takePhoto) },
      { text: t("File"), onPress: () => void addAttachments(pickDocuments) },
      { text: t("Cancel"), style: "cancel" },
    ]);
  }, [addAttachments]);

  const removeAttachment = useCallback((artifactId: string) => {
    dispatch({ kind: "detach", artifactId });
    setAttachments((current) => current.filter((file) => file.id !== artifactId));
  }, []);

  const messages = snap?.messages ?? [];
  const padding = desktop ? vt.space.chatPaddingHorizontalDesktop : vt.space.chatPaddingHorizontal;

  return (
    <View style={{ flex: 1, paddingHorizontal: padding }}>
      <ScrollView
        ref={list}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          gap: vt.space.messageGap,
          paddingTop: vt.space.messageListPaddingTop,
          paddingBottom: vt.space.messageListPaddingBottom,
          flexGrow: 1,
        }}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          const nearEnd =
            contentSize.height - contentOffset.y - layoutMeasurement.height < DETACH_THRESHOLD;
          followLatest.current = nearEnd;
          setAwayFromLatest(messages.length > 0 && !nearEnd);
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (messages.length > 0 && followLatest.current) {
            list.current?.scrollToEnd({ animated: false });
          }
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ErrorNotice error={error} />
        {messages.length === 0 && !loading ? (
          <View
            style={{
              flexGrow: 1,
              flexShrink: 0,
              justifyContent: "center",
              alignItems: "center",
              paddingVertical: 34,
              gap: 15,
            }}
          >
            <Text
              style={{
                ...vt.type.chatEmptyHeadline,
                color: colors.text,
                textAlign: "center",
                maxWidth: vt.size.chatEmptyHeadlineMaxWidth,
              }}
            >
              {t("A little help. A lot more room for life.")}
            </Text>
            <Text style={[s.muted, { maxWidth: 320, textAlign: "center", lineHeight: 23 }]}>
              {t(
                "Tell me what is on your mind. I can make a plan, work with your apps, and use my computer to help.",
              )}
            </Text>
          </View>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              target={botId ? { botId } : null}
              computerReachable={computerReachable}
              onAnswer={answer}
              onOpenComputer={onOpenComputer}
            />
          ))
        )}
        {running && <TypingDots />}
      </ScrollView>
      {awayFromLatest && (
        <Button
          small
          icon={ArrowDown}
          style={{ alignSelf: "center", marginBottom: 10 }}
          onPress={() => {
            followLatest.current = true;
            setAwayFromLatest(false);
            list.current?.scrollToEnd({ animated: true });
          }}
        >
          {t("Latest messages")}
        </Button>
      )}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FollowUpQueue
          queue={queueState}
          onRemove={(id) => queue.remove(id)}
          onResume={() => {
            queue.resume();
            if (!target) return;
            void queue
              .flush(async (entry) => {
                await rpc("threads/followUp", { ...threadTarget, text: entry.text });
              })
              .catch((failure: Error) => setError(failure.message));
          }}
          onRetry={(id) => queue.retry(id)}
        />
        <VesperComposer
          modelPicker={
            botId ? <MobileChatModelPicker key={botId} botId={botId} disabled={running} /> : null
          }
          state={composer}
          loading={loading}
          error={!!error}
          attachments={attachments}
          onDraftChange={(text) => dispatch({ kind: "draft", text })}
          onSubmit={submit}
          onStop={stop}
          onPickAttachment={showAttachMenu}
          onRemoveAttachment={removeAttachment}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
