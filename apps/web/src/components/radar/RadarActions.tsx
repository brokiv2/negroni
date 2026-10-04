import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RadarAction, RadarFeedbackKind } from "@rakazo/contracts";
import {
  Button,
  buttonVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { Check, Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
import { newClientId } from "../../lib/client-id";
import { localTimezone } from "../../lib/local-timezone";
import { formatRadarClock, formatRadarTime, laterOptions } from "../../lib/radar-time";
import { useRadarCopy } from "./copy";
import { RadarWhyDialog } from "./RadarDecision";
import { sendRadarFeedback, sendToPersonalChat, useRadarStatus } from "./radar-state";

export type RadarActionTarget = {
  id: string;
  title: string;
  action?: RadarAction;
  offer?: string;
  url?: string;
  /** False when the update names no sender to remember; undefined when unknown. */
  hasSender?: boolean;
};

export type RadarResolution = RadarFeedbackKind | "sent";

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * What the owner can do with one update: take the offer (or mark it done), bring it back
 * later, say it was not important, and teach Radar about the sender.
 */
export function RadarActions({
  item,
  botId,
  primary,
  extraDone = false,
  why = false,
  sender = true,
  compact = false,
  onSent,
  onResolved,
}: {
  item: RadarActionTarget;
  /** The main assistant, whose personal conversation takes the offer. */
  botId?: string;
  primary: "offer" | "done";
  /** A Done button next to the offer. */
  extraDone?: boolean;
  /** "Why this" in the overflow menu. */
  why?: boolean;
  /** "Never about this" and "Always tell me" in the overflow menu. */
  sender?: boolean;
  compact?: boolean;
  onSent?: () => unknown;
  onResolved?: (resolution: RadarResolution) => void;
}) {
  const { t } = useLingui();
  const copy = useRadarCopy();
  const status = useRadarStatus();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [noted, setNoted] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [later, setLater] = useState<ReturnType<typeof laterOptions>>([]);
  const nonce = useRef<string | null>(null);
  const timeZone = status?.settings.timeZone ?? localTimezone();
  const locale = i18n.locale || "en";
  const size = compact ? "xs" : "sm";
  const fallback = copy.fallback(item.action, Boolean(item.url));
  const offerLabel = item.offer ?? fallback.label;
  const opensSource = primary === "offer" && !item.offer && fallback.open && Boolean(item.url);
  const senderActions = sender && item.hasSender !== false;

  async function accept() {
    if (!botId || pending) return;
    nonce.current ??= newClientId();
    setPending(true);
    setError(null);
    try {
      await sendToPersonalChat({
        botId,
        updateId: item.id,
        text: offerLabel,
        clientNonce: nonce.current,
      });
      nonce.current = null;
      setResolved(t`On it`);
      onResolved?.("sent");
      void Promise.resolve()
        .then(onSent)
        .catch(() => undefined);
    } catch (err) {
      setError(errorText(err, t`Could not send. Try again.`));
    } finally {
      setPending(false);
    }
  }

  async function feedback(kind: RadarFeedbackKind, until?: Date) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await sendRadarFeedback(item.id, kind, until?.toISOString());
      if (kind === "always_sender") setNoted(true);
      else if (kind === "snooze" && until) {
        const time = formatRadarTime(until, timeZone, locale);
        setResolved(t`Later · ${time}`);
      } else if (kind === "done") setResolved(t`Done`);
      else if (kind === "not_important") setResolved(t`Not important`);
      else if (kind === "mute_sender") setResolved(t`Never about this`);
      onResolved?.(kind);
    } catch (err) {
      setError(errorText(err, t`Could not save. Try again.`));
    } finally {
      setPending(false);
    }
  }

  if (resolved) {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
        data-testid="radar-resolved"
      >
        <Check size={14} aria-hidden />
        {resolved}
      </p>
    );
  }

  const overflow = why || senderActions;
  return (
    <div className="space-y-1.5">
      {noted ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Check size={14} aria-hidden />
          <Trans>Always tell me</Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {primary === "done" ? (
          <Button
            size={size}
            variant="outline"
            disabled={pending}
            onClick={() => void feedback("done")}
          >
            <Trans>Done</Trans>
          </Button>
        ) : opensSource ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size })}
            onClick={() => void sendRadarFeedback(item.id, "opened").catch(() => undefined)}
          >
            {offerLabel}
          </a>
        ) : (
          <Button
            size={size}
            disabled={pending || !botId}
            className="h-auto min-h-7 whitespace-normal py-1 text-start"
            onClick={() => void accept()}
            dir="auto"
          >
            {offerLabel}
          </Button>
        )}
        {primary === "offer" && extraDone ? (
          <Button
            size={size}
            variant="outline"
            disabled={pending}
            onClick={() => void feedback("done")}
          >
            <Trans>Done</Trans>
          </Button>
        ) : null}
        <DropdownMenu
          onOpenChange={(open) => {
            // Worked out on opening, so a card read hours later still offers future times.
            if (open) setLater(laterOptions(timeZone));
          }}
        >
          <DropdownMenuTrigger disabled={pending} render={<Button size={size} variant="outline" />}>
            <Trans>Later</Trans>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-auto min-w-48">
            {later.map(({ key, until }) => (
              <DropdownMenuItem key={key} onClick={() => void feedback("snooze", until)}>
                {copy.later(key)}
                <DropdownMenuShortcut className="tracking-normal">
                  {formatRadarClock(until, timeZone, locale)}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size={size}
          variant="ghost"
          disabled={pending}
          onClick={() => void feedback("not_important")}
        >
          <Trans>Not important</Trans>
        </Button>
        {overflow ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={pending}
              aria-label={t`More actions`}
              render={
                <Button
                  size={compact ? "icon-xs" : "icon-sm"}
                  variant="ghost"
                  className="text-muted-foreground"
                />
              }
            >
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              {senderActions ? (
                <>
                  <DropdownMenuItem onClick={() => void feedback("mute_sender")}>
                    <Trans>Never about this</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void feedback("always_sender")}>
                    <Trans>Always tell me</Trans>
                  </DropdownMenuItem>
                </>
              ) : null}
              {why ? (
                <DropdownMenuItem onClick={() => setWhyOpen(true)}>
                  <Trans>Why this</Trans>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      {why ? (
        <RadarWhyDialog
          updateId={item.id}
          title={item.title}
          open={whyOpen}
          onOpenChange={setWhyOpen}
        />
      ) : null}
    </div>
  );
}
