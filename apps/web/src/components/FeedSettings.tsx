import type { FeedProfile } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";
export function FeedSettings() {
  const [profile, setProfile] = useState<FeedProfile | null>(null);
  const [topic, setTopic] = useState("");
  const [domains, setDomains] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void rpc.feed
      .profile({}, { signal: abort.signal })
      .then((p) => {
        if (!abort.signal.aborted) {
          setProfile(p);
          setDomains(p.sourceDomains.join(", "));
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Could not load feed settings.");
      });
    return () => abort.abort();
  }, []);
  async function apply(action: () => Promise<FeedProfile>) {
    setBusy(true);
    setError("");
    try {
      setProfile(await action());
    } catch {
      setError("Could not save. Check the values and retry.");
    } finally {
      setBusy(false);
    }
  }
  const button = "rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50";
  return (
    <div className="space-y-4 rounded-2xl border border-border p-4">
      {error && <p role="alert">{error}</p>}
      {profile && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.learningEnabled}
              disabled={busy}
              onChange={(e) =>
                void apply(() => rpc.feed.configure({ learningEnabled: e.target.checked }))
              }
            />
            Learn interests from conversations
          </label>
          <p className="text-sm text-muted-foreground">
            Repeated interests become topics. Excluded topics stay excluded.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (topic.trim())
                void apply(() => rpc.feed.interest({ topic: topic.trim(), action: "follow" })).then(
                  () => setTopic(""),
                );
            }}
          >
            <input
              aria-label="Add a feed topic"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background p-2"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={100}
              placeholder="Add a topic"
            />
            <button type="submit" className={button} disabled={busy || !topic.trim()}>
              Follow
            </button>
          </form>
          {profile.interests.map((i) => (
            <div key={i.topic} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{i.topic}</span>
                <span className="text-xs text-muted-foreground">
                  {i.origin === "explicit"
                    ? "Following"
                    : i.evidenceIds.length >= 2
                      ? "Learned"
                      : "Candidate"}
                </span>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void apply(() => rpc.feed.interest({ topic: i.topic, action: "exclude" }))
                  }
                >
                  Exclude
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void apply(() => rpc.feed.interest({ topic: i.topic, action: "forget" }))
                  }
                >
                  Forget
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{i.reason}</p>
            </div>
          ))}
          {profile.excludedTopics.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="flex-1">{t} · Excluded</span>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void apply(() => rpc.feed.interest({ topic: t, action: "follow" }))}
              >
                Follow again
              </button>
            </div>
          ))}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(() =>
                rpc.feed.configure({
                  sourceDomains: domains
                    .split(",")
                    .map((v) => v.trim().toLowerCase())
                    .filter(Boolean),
                }),
              );
            }}
          >
            <label className="block">
              Sources (domains, optional)
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background p-2"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="example.com, another.org"
              />
            </label>
            <button type="submit" className={button} disabled={busy}>
              Save sources
            </button>
          </form>
          <label className="flex items-center gap-2">
            Articles per collection
            <select
              aria-label="Articles per collection"
              className={button}
              disabled={busy}
              value={profile.maxItems}
              onChange={(e) =>
                void apply(() => rpc.feed.configure({ maxItems: Number(e.target.value) }))
              }
            >
              {[1, 3, 5, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
