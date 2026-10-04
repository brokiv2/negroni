import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { FeedItem, Routine, ThreadSnapshot } from "@rakazo/contracts";
import { xPostId } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Antenna } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { AskCard } from "./AskCard";
import { FeedSettings } from "./FeedSettings";
import { NeedsYou } from "./radar/NeedsYou";
import { RadarPanelDialog } from "./radar/RadarPanel";

type ChatTarget = { botId: string; groupId?: string; draft?: string; team?: boolean };
type Tab = "feed" | "saved" | "automations" | "hidden";
const button =
  "rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
export function PersonalWorkspace({
  botId,
  botIds,
  onOpenChat,
  onOpenIntegrations,
  assistantName,
  active = true,
}: {
  botId: string;
  botIds: readonly string[];
  onClose: () => void;
  onOpenChat: (target?: ChatTarget) => void;
  /** The connected-apps screen, where a source Radar lost access is reconnected. */
  onOpenIntegrations?: () => void;
  assistantName?: string;
  embedded?: boolean;
  /** Whether For you is on screen; showing it again refreshes Radar. */
  active?: boolean;
}) {
  const { t } = useLingui();
  const [tab, setTab] = useState<Tab>("feed");
  const [radarOpen, setRadarOpen] = useState(false);
  const [radarRevision, setRadarRevision] = useState(0);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setRadarRevision((v) => v + 1);
    wasActive.current = active;
  }, [active]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const hierarchy = [...new Set([botId, ...botIds])].sort().join("|");
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const load =
      tab === "automations"
        ? Promise.all(
            hierarchy
              .split("|")
              .map((id) => rpc.routines.list({ botId: id }, { signal: abort.signal })),
          ).then((rows) => {
            if (!abort.signal.aborted) setRoutines(rows.flat());
          })
        : rpc.feed
            .list({ saved: tab === "saved", hidden: tab === "hidden" }, { signal: abort.signal })
            .then((rows) => {
              if (!abort.signal.aborted) setItems(rows);
            });
    void load
      .catch(() => {
        if (!abort.signal.aborted) setError("Could not load. Please retry.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [tab, hierarchy, revision]);
  const ask = (draft: string) => onOpenChat({ botId, draft });
  async function change(item: FeedItem, patch: { saved?: boolean; hidden?: boolean }) {
    setBusy(true);
    setError("");
    try {
      await rpc.feed.update({ id: item.id, ...patch });
      setSelected(null);
      setRevision((v) => v + 1);
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-5" aria-label="For you">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-medium">For you</h1>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon-lg"
              className="rounded-lg"
              aria-label={t`Radar`}
              aria-haspopup="dialog"
              onClick={() => setRadarOpen(true)}
            >
              <Antenna aria-hidden />
            </Button>
            <button
              type="button"
              className={button}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
            >
              Customize feed
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setRevision((v) => v + 1);
                setRadarRevision((v) => v + 1);
              }}
            >
              Refresh
            </button>
          </div>
        </header>
        <RadarPanelDialog
          open={radarOpen}
          onOpenChange={setRadarOpen}
          onOpenIntegrations={onOpenIntegrations}
        />
        <NeedsYou
          botId={botId}
          assistantName={assistantName}
          revision={radarRevision}
          onOpenChat={onOpenChat}
        />
        {settingsOpen && <FeedSettings />}
        <nav className="flex flex-wrap gap-2" aria-label="For you sections">
          {(["feed", "saved", "automations", "hidden"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={button + (tab === value ? " bg-muted" : "")}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => {
                setTab(value);
                setTopic("");
                setSelected(null);
              }}
            >
              {
                { feed: "Feed", saved: "Saved", automations: "Automations", hidden: "Hidden" }[
                  value
                ]
              }
            </button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading…</p>
        ) : selected ? (
          <>
            <button type="button" className={button} onClick={() => setSelected(null)}>
              Back to feed
            </button>
            <FeedArticle item={selected} />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => void change(selected, { saved: !selected.saved })}
              >
                {selected.saved ? "Unsave" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => void change(selected, { hidden: !selected.hidden })}
              >
                {selected.hidden ? "Restore" : "Hide"}
              </button>
            </div>
            <FeedDiscussion key={selected.id} item={selected} />
          </>
        ) : tab === "automations" ? (
          <>
            <button
              type="button"
              className={button}
              onClick={() => ask("I'd like to set up an automation: ")}
            >
              New automation
            </button>
            {!routines.length && (
              <p className="text-muted-foreground">
                Scheduled work will appear here when you ask for it.
              </p>
            )}
            {routines.map((routine) => (
              <details key={routine.id} className="space-y-3 rounded-2xl border border-border p-5">
                <summary className="cursor-pointer font-medium">{routine.name}</summary>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {routine.prompt}
                </p>
                <p className="text-sm">
                  {routine.active ? "Active" : "Paused"}
                  {routine.nextRunAt && routine.active
                    ? ` · Next: ${new Date(routine.nextRunAt).toLocaleString()}`
                    : ""}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={button}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await rpc.routines.update({
                          routineId: routine.id,
                          active: !routine.active,
                        });
                        setRevision((v) => v + 1);
                      } catch {
                        setError("Could not update automation.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {routine.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      ask(
                        `Let's edit the automation ${JSON.stringify(routine.name)} (id ${routine.id}).`,
                      )
                    }
                  >
                    Edit in chat
                  </button>
                  <button
                    type="button"
                    className={button + " text-destructive"}
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Delete “${routine.name}”? This removes its schedule.`))
                        return;
                      setBusy(true);
                      try {
                        await rpc.routines.remove({ routineId: routine.id });
                        setRevision((v) => v + 1);
                      } catch {
                        setError("Could not delete automation.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </details>
            ))}
          </>
        ) : (
          <>
            {items.some((item) => item.topic) && (
              <select
                aria-label="Topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className={button}
              >
                <option value="">All topics</option>
                {[...new Set(items.map((item) => item.topic).filter(Boolean))].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            )}
            {!items.length && (
              <div className="space-y-3 py-12">
                <h2 className="text-xl">
                  {tab === "saved"
                    ? "No saved posts"
                    : tab === "hidden"
                      ? "No hidden posts"
                      : "Your feed starts with your interests"}
                </h2>
                {tab === "feed" && (
                  <>
                    <p className="text-muted-foreground">
                      Ask Negroni to collect articles, posts or news on a topic.
                    </p>
                    <button
                      type="button"
                      className={button}
                      onClick={() => ask("Find a few useful articles for my feed about ")}
                    >
                      Choose a topic
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {items
                .filter((item) => !topic || item.topic === topic)
                .map((item) => (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setSelected(item)}
                    >
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="aspect-video w-full object-cover"
                          onError={(e) => {
                            e.currentTarget.hidden = true;
                          }}
                        />
                      )}
                      <div className="space-y-3 p-5">
                        <p className="text-xs text-muted-foreground">
                          {item.topic || item.kind} ·{" "}
                          {new Date(item.publishedAt ?? item.createdAt).toLocaleDateString()}
                        </p>
                        <h2 className="text-lg font-medium">{item.title}</h2>
                        <p className="text-sm text-muted-foreground">{item.summary}</p>
                        {item.reason && <p className="text-sm">{item.reason}</p>}
                        <span className="text-sm">Read & discuss →</span>
                      </div>
                    </button>
                  </article>
                ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
function FeedArticle({ item }: { item: FeedItem }) {
  const [embed, setEmbed] = useState(false);
  const postId = xPostId(item.url);
  return (
    <article className="space-y-4">
      <h2 className="text-2xl font-medium">{item.title}</h2>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="max-h-96 w-full rounded-xl object-cover"
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
      {item.url && (
        <a className="underline" href={item.url} target="_blank" rel="noopener noreferrer">
          {new URL(item.url).hostname} ↗
        </a>
      )}
      {postId &&
        (embed ? (
          <iframe
            title="Post from X"
            src={`https://platform.twitter.com/embed/Tweet.html?id=${postId}&dnt=true`}
            sandbox="allow-scripts allow-same-origin allow-popups"
            referrerPolicy="no-referrer"
            className="h-[560px] w-full rounded-xl border border-border"
          />
        ) : (
          <button type="button" className={button} onClick={() => setEmbed(true)}>
            Show post from X
          </button>
        ))}
      <ChatMarkdown>{item.summary}</ChatMarkdown>
      {item.content && <ChatMarkdown>{item.content}</ChatMarkdown>}
    </article>
  );
}
function FeedDiscussion({ item }: { item: FeedItem }) {
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const pending = useRef<{ text: string; nonce: string } | null>(null);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const next = await rpc.threads.get({ feedItemId: item.id });
    if (alive.current) {
      setSnapshot(next);
      setError("");
    }
  }, [item.id]);
  const active = snapshot?.run && ["queued", "leased", "running"].includes(snapshot.run.status);
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => setError("Could not load discussion."));
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void refresh().catch(() => setError("Connection interrupted. Retrying…"));
    }, 1500);
    return () => clearInterval(timer);
  }, [active, refresh]);
  async function send(text = draft) {
    if (!text.trim() || sending || active) return;
    if (pending.current?.text !== text) pending.current = { text, nonce: crypto.randomUUID() };
    setSending(true);
    setError("");
    try {
      await rpc.threads.send({ feedItemId: item.id, text, clientNonce: pending.current.nonce });
      pending.current = null;
      setDraft("");
      await refresh();
    } catch {
      setError("Could not send. Retry keeps the same message.");
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="space-y-4 border-t border-border pt-5" aria-label="Discuss this post">
      <h3 className="font-medium">Discuss this post</h3>
      {!snapshot?.messages.length && (
        <div className="flex flex-wrap gap-2">
          {["Explain this", "Translate into Russian", "Why does this matter?"].map((text) => (
            <button
              type="button"
              className={button}
              key={text}
              disabled={sending || !!active}
              onClick={() => void send(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {snapshot?.messages.map((message) => (
        <div
          key={message.id}
          className={message.role === "user" ? "ml-8 rounded-xl bg-muted p-4" : "p-2"}
        >
          {message.blocks.map((block, index) =>
            block.kind === "text" ? (
              <ChatMarkdown key={index}>{block.text}</ChatMarkdown>
            ) : block.kind === "ask" ? (
              <AskCard
                key={index}
                block={block}
                canAnswer={
                  snapshot.run?.status === "waiting_input" &&
                  message.runId === snapshot.run.id &&
                  block.status !== "answered"
                }
                onAnswer={async (answer, username) => {
                  if (!message.runId) return;
                  await rpc.threads.answer({
                    feedItemId: item.id,
                    runId: message.runId,
                    messageId: message.id,
                    answer,
                    username,
                  });
                  await refresh();
                }}
              />
            ) : null,
          )}
        </div>
      ))}
      {snapshot?.run?.status === "failed" && (
        <p role="alert">The reply could not finish. Try again.</p>
      )}
      {active && (
        <div role="status">
          Thinking…{" "}
          <button
            type="button"
            className={button}
            onClick={() =>
              void rpc.threads
                .stop({ feedItemId: item.id })
                .then(refresh)
                .catch(() => setError("Could not stop."))
            }
          >
            Stop
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Ask about this post"
          placeholder="Ask about this post…"
          className="min-h-20 flex-1 rounded-xl border border-border bg-background p-3"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className={button} disabled={sending || !!active || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
