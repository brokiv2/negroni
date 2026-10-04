import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { MessageBlock, RadarStatus } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { Quote } from "lucide-react";
import { useState } from "react";
import { formatRadarTime } from "../../lib/radar-time";
import { formatRelativeTime } from "../../lib/relative-time";
import { BuiCard } from "../ai/primitives";
import { RadarActions } from "./RadarActions";
import { RadarEvidence } from "./RadarDecision";
import { RadarSourceMark } from "./RadarSource";
import { useRadarStatus } from "./radar-state";

type UpdateBlock = Extract<MessageBlock, { kind: "update" }>;
type BriefBlock = Extract<MessageBlock, { kind: "brief" }>;

/** A brief shows this many items before the rest fold behind "N more". */
export const BRIEF_VISIBLE_ITEMS = 7;

/** The account an update came from, when only one watched account has that source. */
export function radarSourceAccount(status: RadarStatus | null, source: string) {
  const slug = source.trim().toLowerCase();
  const matches = status?.sources.filter((item) => item.source === slug) ?? [];
  const watched = matches.filter((item) => item.enabled);
  const only = watched.length === 1 ? watched[0] : matches.length === 1 ? matches[0] : undefined;
  return only?.account;
}

export function RadarUpdateCard({
  block,
  botId,
  onSent,
}: {
  block: UpdateBlock;
  botId?: string;
  onSent?: () => unknown;
}) {
  const { t } = useLingui();
  const status = useRadarStatus();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const meta = [
    radarSourceAccount(status, block.source),
    block.actor?.name || block.actor?.address,
    formatRelativeTime(block.occurredAt),
  ].filter(Boolean);
  return (
    <BuiCard
      role="article"
      aria-label={block.title}
      data-testid="radar-update"
      className="w-[440px] max-w-full space-y-2.5 px-4 py-3.5"
    >
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
        <RadarSourceMark source={block.source} />
        <span className="min-w-0 truncate" dir="auto">
          {meta.join(" · ")}
        </span>
      </div>
      <div className="space-y-0.5">
        <p className="text-[15px] font-medium leading-snug text-foreground" dir="auto">
          {block.title}
        </p>
        <p className="text-[14px] leading-[1.45] text-foreground/75" dir="auto">
          {block.why}
          {block.evidence ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={quoteOpen ? t`Hide quote` : t`Show quote`}
              aria-expanded={quoteOpen}
              className="ms-1 align-middle text-muted-foreground"
              onClick={() => setQuoteOpen((open) => !open)}
            >
              <Quote aria-hidden />
            </Button>
          ) : null}
        </p>
      </div>
      {quoteOpen && block.evidence ? <RadarEvidence text={block.evidence} /> : null}
      <RadarActions
        item={{
          id: block.updateId,
          title: block.title,
          action: block.action,
          offer: block.offer,
          url: block.url,
          hasSender: Boolean(block.actor?.address),
        }}
        botId={botId}
        primary="offer"
        why
        onSent={onSent}
      />
    </BuiCard>
  );
}

/** A brief: the assistant's short narrative, today's agenda and the items it kept. */
export function RadarBriefCard({
  block,
  narrative,
  botId,
  onSent,
}: {
  block: BriefBlock;
  narrative: string;
  botId?: string;
  onSent?: () => unknown;
}) {
  const { t } = useLingui();
  const status = useRadarStatus();
  const [expanded, setExpanded] = useState(false);
  const timeZone = status?.settings.timeZone;
  const locale = i18n.locale || "en";
  const items = expanded ? block.items : block.items.slice(0, BRIEF_VISIBLE_ITEMS);
  const hidden = block.items.length - items.length;
  return (
    <BuiCard
      role="article"
      aria-label={block.title}
      data-testid="radar-brief"
      className="w-[480px] max-w-full space-y-3 px-4 py-3.5"
    >
      <p className="text-[15px] font-medium text-foreground" dir="auto">
        {block.title}
      </p>
      {narrative ? (
        <div className="text-[14.5px] leading-[1.5] text-foreground/90" dir="auto">
          <ChatMarkdown>{narrative}</ChatMarkdown>
        </div>
      ) : null}
      {block.agenda?.length ? (
        <ul aria-label={t`Your day`} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {block.agenda.map((event, index) => (
            <li
              key={`${event.start}-${index}`}
              title={event.location}
              className="flex max-w-56 shrink-0 items-baseline gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"
            >
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {event.allDay ? (
                  <Trans>All day</Trans>
                ) : (
                  formatRadarTime(event.start, timeZone, locale)
                )}
              </span>
              <span className="truncate text-foreground" dir="auto">
                {event.title}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length ? (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.updateId}
              data-testid="radar-brief-item"
              className="space-y-1.5 py-2.5 first:pt-0"
            >
              <div className="flex min-w-0 gap-2">
                <RadarSourceMark source={item.source} className="size-5" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium leading-snug text-foreground" dir="auto">
                    {item.title}
                  </p>
                  {item.why ? (
                    <p className="text-[13px] leading-[1.45] text-muted-foreground" dir="auto">
                      {item.why}
                    </p>
                  ) : null}
                </div>
              </div>
              <RadarActions
                compact
                item={{ id: item.updateId, title: item.title, action: item.action, url: item.url }}
                botId={botId}
                primary="offer"
                why
                onSent={onSent}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          {t`${hidden} more`}
        </Button>
      ) : null}
    </BuiCard>
  );
}
