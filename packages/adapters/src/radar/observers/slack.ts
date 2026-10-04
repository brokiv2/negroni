import {
  asArray,
  asRecord,
  asString,
  clip,
  httpsUrl,
  plainText,
  providerData,
} from "./envelope.js";
import type { ObservedSignal, RadarObserver } from "./types.js";

const CAP = 50;

const slackTime = (ts: string): Date | undefined => {
  const seconds = Number.parseFloat(ts);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
};

export const slackObserver: RadarObserver = {
  cadenceMinutes: 10,

  async observe({ call, cursor, now, since }) {
    const after =
      typeof cursor.after === "number" ? cursor.after : Math.floor(since.getTime() / 1000);
    // Slack's `after:` takes a calendar day and excludes it; the timestamp filter below is exact.
    const day = new Date((after - 86_400) * 1000).toISOString().slice(0, 10);
    const result = providerData(
      await call("SLACK_SEARCH_MESSAGES", {
        query: `to:me after:${day}`,
        sort: "timestamp",
        sort_dir: "desc",
        count: CAP,
      }),
      "messages",
    );
    const messages = asRecord(result.messages);
    const matches = asArray(messages.matches ?? result.matches).slice(0, CAP);
    const total = Number(asRecord(messages.pagination).total_count ?? messages.total) || 0;
    const signals: ObservedSignal[] = [];
    for (const match of matches) {
      const ts = asString(match.ts);
      const at = slackTime(ts);
      const channel = asRecord(match.channel);
      const channelId = asString(channel.id);
      if (!at || at.getTime() <= after * 1000 || !/^[\w-]{1,64}$/.test(channelId)) continue;
      const text = plainText(asString(match.text));
      const name = asString(match.username) || asString(match.user_name) || asString(match.user);
      const threadTs = asString(match.thread_ts) || ts;
      const url = httpsUrl(match.permalink, ["slack.com"]);
      signals.push({
        externalId: `${channelId}:${ts}`,
        threadKey: `${channelId}:${threadTs}`,
        storyKey: `slack:${channelId}:${threadTs}`,
        kind: "message",
        occurredAt: at,
        ...(name ? { actor: { name: name.slice(0, 200) } } : {}),
        direct: channel.is_im === true || channel.is_mpim === true,
        title: clip(text.split("\n")[0] || "Slack message", 120),
        excerpt: clip(text, 2000),
        ...(url ? { url } : {}),
        meta: { channel: clip(asString(channel.name), 80) },
      });
    }
    return {
      signals,
      cursor: { after: Math.floor(now.getTime() / 1000) - 120 },
      overflow: Math.max(0, total - matches.length),
    };
  },
};
