import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RadarLevel, RadarUpdate } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Textarea,
} from "@rakazo/ui-web";
import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { newClientId } from "../../lib/client-id";
import { formatRadarTime } from "../../lib/radar-time";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { BuiCard, Shimmer } from "../ai/primitives";
import { useRadarCopy } from "./copy";
import type { RadarActionTarget, RadarResolution } from "./RadarActions";
import { RadarActions } from "./RadarActions";
import { radarSourceAccount } from "./RadarCards";
import { RadarDecision, RadarEvidence } from "./RadarDecision";
import { RadarSourceMark, radarSourceName } from "./RadarSource";
import {
  enableRadarPatch,
  loadRadarStatus,
  publishRadarStatus,
  sendRadarFeedback,
  sendToPersonalChat,
  useRadarStatus,
} from "./radar-state";

const PAGE = 20;
/** After Radar is turned on, look for its first findings this often, this many times. */
const FIRST_LOOK_INTERVAL_MS = 20_000;
const FIRST_LOOK_TRIES = 15;

type ChatTarget = { botId: string };

const target = (update: RadarUpdate): RadarActionTarget => ({
  id: update.id,
  title: update.title,
  action: update.action,
  offer: update.offer,
  url: update.url,
  hasSender: Boolean(update.actor?.address),
});

/** Feedback that takes an update out of "Needs you". */
const leavesList = (resolution: RadarResolution) =>
  resolution === "done" ||
  resolution === "snooze" ||
  resolution === "not_important" ||
  resolution === "mute_sender";

/**
 * Top of For you: what Radar thinks needs the owner now, or the one question that turns
 * Radar on.
 */
export function NeedsYou({
  botId,
  assistantName,
  revision,
  onOpenChat,
}: {
  botId: string;
  assistantName?: string;
  /** Changes when For you is refreshed or shown again. */
  revision: number;
  onOpenChat: (target?: ChatTarget) => void;
}) {
  const { t } = useLingui();
  const status = useRadarStatus();
  const headingId = useId();
  const [items, setItems] = useState<RadarUpdate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RadarUpdate | null>(null);
  const [firstLook, setFirstLook] = useState(false);
  const [looks, setLooks] = useState(0);
  const enabled = Boolean(status?.settings.enabled);

  useEffect(() => {
    if (revision > 0) void loadRadarStatus(0).catch(() => undefined);
  }, [revision]);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    rpc.radar
      .updates({ view: "open", limit: PAGE }, { signal: abort.signal })
      .then((page) => {
        if (abort.signal.aborted) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(null);
        if (page.items.length) setFirstLook(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(t`Could not load. Try again.`);
      });
    return () => abort.abort();
  }, [enabled, revision, looks]);

  useEffect(() => {
    if (!firstLook) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      setLooks((value) => value + 1);
      if (tries >= FIRST_LOOK_TRIES) {
        window.clearInterval(timer);
        setFirstLook(false);
      }
    }, FIRST_LOOK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [firstLook]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await rpc.radar.updates({ view: "open", limit: PAGE, cursor: nextCursor });
      setItems((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((known) => known.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch {
      setError(t`Could not load. Try again.`);
    }
  }

  function remove(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelected((current) => (current?.id === id ? null : current));
  }

  if (!status) return null;
  if (!enabled) return <RadarSetupCard onEnabled={() => setFirstLook(true)} />;
  const locale = i18n.locale || "en";
  const briefTime = status.lastBriefAt
    ? formatRadarTime(status.lastBriefAt, status.settings.timeZone, locale)
    : "";
  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="radar-needs-you">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-lg font-medium">
          <Trans>Needs you</Trans>
        </h2>
        {briefTime ? (
          <Button variant="link" size="sm" className="px-0" onClick={() => onOpenChat({ botId })}>
            {t`Latest brief · ${briefTime}`}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {items.length ? (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="radar-needs-you-row"
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-3 text-start"
                onClick={() => setSelected(item)}
              >
                <RadarSourceMark source={item.source} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium" dir="auto">
                    {item.title}
                  </span>
                  {item.why ? (
                    <span className="block truncate text-[13px] text-muted-foreground" dir="auto">
                      {item.why}
                    </span>
                  ) : null}
                </span>
              </button>
              <RadarActions
                compact
                item={target(item)}
                botId={botId}
                primary="done"
                sender={false}
                onResolved={(resolution) => {
                  if (leavesList(resolution)) remove(item.id);
                }}
              />
            </li>
          ))}
        </ul>
      ) : firstLook ? (
        <p role="status" className="text-sm">
          <Shimmer>
            <Trans>Taking a look around. I'll follow up shortly.</Trans>
          </Shimmer>
        </p>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Nothing needs you.</Trans>
        </p>
      ) : null}
      {nextCursor ? (
        <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
          <Trans>Show more</Trans>
        </Button>
      ) : null}
      {selected ? (
        <NeedsYouDetail
          key={selected.id}
          update={selected}
          botId={botId}
          assistantName={assistantName}
          onClose={() => setSelected(null)}
          onResolved={(resolution) => {
            if (leavesList(resolution)) remove(selected.id);
          }}
          onOpenChat={() => {
            setSelected(null);
            onOpenChat({ botId });
          }}
        />
      ) : null}
    </section>
  );
}

function RadarSetupCard({ onEnabled }: { onEnabled: () => void }) {
  const { t } = useLingui();
  const copy = useRadarCopy();
  const status = useRadarStatus();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable(level: RadarLevel) {
    setPending(true);
    setError(null);
    try {
      publishRadarStatus(await rpc.radar.configure(enableRadarPatch(status, level)));
      onEnabled();
      await rpc.radar
        .check({})
        .then(publishRadarStatus)
        .catch(() => undefined);
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : t`Could not turn on Radar. Try again.`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <BuiCard className="space-y-3 p-5" data-testid="radar-setup">
      <h2 className="text-lg font-medium">
        <Trans>When should I interrupt you?</Trans>
      </h2>
      <div className="flex flex-wrap gap-2">
        {(["urgent", "important", "more"] as const).map((level) => (
          <Button
            key={level}
            variant={level === "important" ? "default" : "outline"}
            disabled={pending}
            onClick={() => void enable(level)}
          >
            {copy.level(level)}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </BuiCard>
  );
}

function NeedsYouDetail({
  update: initial,
  botId,
  assistantName,
  onClose,
  onResolved,
  onOpenChat,
}: {
  update: RadarUpdate;
  botId: string;
  assistantName?: string;
  onClose: () => void;
  onResolved: (resolution: RadarResolution) => void;
  onOpenChat: () => void;
}) {
  const { t } = useLingui();
  const status = useRadarStatus();
  const [update, setUpdate] = useState(initial);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nonce = useRef<{ text: string; value: string } | null>(null);

  useEffect(() => {
    let live = true;
    sendRadarFeedback(initial.id, "opened")
      .then((next) => {
        if (live) setUpdate(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [initial.id]);

  async function reply(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    if (nonce.current?.text !== text) nonce.current = { text, value: newClientId() };
    setSending(true);
    setError(null);
    try {
      await sendToPersonalChat({
        botId,
        updateId: update.id,
        text,
        clientNonce: nonce.current.value,
      });
      nonce.current = null;
      onOpenChat();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t`Could not send. Try again.`);
    } finally {
      setSending(false);
    }
  }

  const meta = [
    radarSourceAccount(status, update.source),
    update.actor?.name || update.actor?.address,
    formatRelativeTime(update.occurredAt),
  ].filter(Boolean);
  const sourceName = radarSourceName(update.source);
  const name = assistantName?.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        data-testid="radar-needs-you-detail"
      >
        <div className="flex min-w-0 items-center gap-2 pe-8 text-[12.5px] text-muted-foreground">
          <RadarSourceMark source={update.source} />
          <span className="min-w-0 truncate" dir="auto">
            {meta.join(" · ")}
          </span>
        </div>
        <DialogTitle className="text-[17px] leading-snug" dir="auto">
          {update.title}
        </DialogTitle>
        {update.why ? (
          <DialogDescription className="text-[14px] text-foreground/80" dir="auto">
            {update.why}
          </DialogDescription>
        ) : null}
        {update.evidence ? <RadarEvidence text={update.evidence} /> : null}
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">
            <Trans>How it was decided</Trans>
          </summary>
          <div className="mt-2">
            <RadarDecision update={update} rules={status?.rules ?? []} />
          </div>
        </details>
        {update.url ? (
          <a
            href={update.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-[13.5px] underline underline-offset-4"
          >
            {t`Open in ${sourceName}`} ↗
          </a>
        ) : null}
        <RadarActions
          item={target(update)}
          botId={botId}
          primary="offer"
          extraDone
          onSent={onOpenChat}
          onResolved={(resolution) => {
            onResolved(resolution);
            if (leavesList(resolution)) onClose();
          }}
        />
        <form className="flex items-end gap-2" onSubmit={(event) => void reply(event)}>
          <Textarea
            aria-label={t`Reply in chat`}
            placeholder={name ? t`Tell ${name}…` : t`Reply in chat`}
            className="min-h-10"
            value={draft}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            <Trans>Send</Trans>
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
