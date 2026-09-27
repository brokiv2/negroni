import type { MessageBlock, PersonalThread } from "@rakazo/contracts";
import { isActive, isRunTerminalEvent } from "@rakazo/core";
import { ArrowDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import {
  applyMobileThreadEvent,
  type MobileSnapshot,
  mergeMobileSnapshot,
  rpc,
  subscribeThread,
} from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  composerReducer,
  initialComposerState,
  shouldQueueSubmit,
} from "../../../lib/vesper/composer";
import { VesperFollowUpQueue, type VesperQueueSnapshot } from "../../../lib/vesper/follow-up-queue";
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
  botId,
  onBotResolved,
  onRunsChanged,
  onOpenComputer,
  computerReachable,
  desktop,
}: {
  /** The main assistant's bot id, once `personal.thread` has resolved it. */
  botId: string | null;
  onBotResolved: (thread: PersonalThread) => void;
  onRunsChanged?: (snapshot: MobileSnapshot | null) => void;
  onOpenComputer: () => void;
  /** From `computer.status`, so a browser card never asserts its own liveness. */
  computerReachable: boolean;
  desktop: boolean;
}) {
  const [snap, setSnap] = useState<MobileSnapshot | null>(null);
  const snapRef = useRef<MobileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, dispatch] = useReducer(composerReducer, initialComposerState);
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const queue = useMemo(() => new VesperFollowUpQueue(), []);
  const [queueState, setQueueState] = useState<VesperQueueSnapshot>(queue.getSnapshot());
  const list = useRef<ScrollView>(null);
  const followLatest = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const target: ThreadTarget | null = botId ? { botId, threadKind: "personal" } : null;

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
    const next = await rpc<MobileSnapshot>("threads/get", target);
    commit(mergeMobileSnapshot(snapRef.current, next, true));
    return next;
  }, [commit, target?.botId]);

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
            target,
            cursor,
            (event) => {
              cursor = Math.max(cursor, event.seq ?? -1);
              retryMs = 250;
              commit(applyMobileThreadEvent(snapRef.current, event));
              if (isRunTerminalEvent(event)) {
                dispatch({ kind: "run-ended" });
                void refresh().catch(() => undefined);
                // A finished turn is the moment held follow-ups can go out.
                void queue
                  .flush(async (entry) => {
                    await rpc("threads/followUp", { ...target, text: entry.text });
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
  }, [commit, queue, refresh, target?.botId]);

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
      // A live run owns the turn; this becomes a durable follow-up.
      queue.enqueue({ id: newId(), text });
      dispatch({ kind: "draft", text: "" });
      return;
    }
    const artifactIds = [...state.attachmentIds];
    dispatch({ kind: "submit-started" });
    void rpc("threads/send", {
      ...target,
      ...(text ? { text } : {}),
      ...(artifactIds.length ? { artifactIds } : {}),
      clientNonce: newId(),
    })
      .then(() => {
        dispatch({ kind: "submit-succeeded" });
        dispatch({ kind: "run-started" });
      })
      .catch((failure: Error) => {
        dispatch({ kind: "submit-failed" });
        setError(failure.message);
      });
  }, [queue, target?.botId]);

  const stop = useCallback(() => {
    if (!target) return;
    // Held, not dropped: the draft and the queue both survive a stop.
    queue.pause();
    dispatch({ kind: "stop-requested" });
    void rpc("threads/stop", target).catch((failure: Error) => setError(failure.message));
  }, [queue, target?.botId]);

  const answer = useCallback(
    (block: MessageBlock, value: string) => {
      if (!target) return;
      const message = (snapRef.current?.messages ?? []).find((candidate) =>
        candidate.blocks.includes(block),
      );
      const runId = message?.runId ?? snapRef.current?.run?.id;
      if (!message || !runId) return;
      void rpc("threads/answer", {
        ...target,
        runId,
        messageId: message.id,
        answer: value,
      }).catch((failure: Error) => setError(failure.message));
    },
    [target?.botId],
  );

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
                await rpc("threads/followUp", { ...target, text: entry.text });
              })
              .catch((failure: Error) => setError(failure.message));
          }}
          onRetry={(id) => queue.retry(id)}
        />
        <VesperComposer
          state={composer}
          loading={loading}
          error={!!error}
          attachments={[]}
          onDraftChange={(text) => dispatch({ kind: "draft", text })}
          onSubmit={submit}
          onStop={stop}
          onPickAttachment={() => undefined}
          onRemoveAttachment={() => undefined}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
