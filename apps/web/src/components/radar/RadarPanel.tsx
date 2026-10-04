import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  RadarSettingsPatch,
  RadarSourceStatus,
  RadarStatus,
  RadarUpdate,
} from "@rakazo/contracts";
import { RADAR_PAUSED_UNTIL_RESUMED } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Switch,
  Toggle,
} from "@rakazo/ui-web";
import { ChevronLeft, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { formatRadarTime, pauseUntil } from "../../lib/radar-time";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";
import { SuccessPop } from "../ai/primitives";
import { useRadarCopy } from "./copy";
import { RadarSourceMark, radarSourceName } from "./RadarSource";
import {
  enableRadarPatch,
  loadRadarStatus,
  publishRadarStatus,
  sendRadarFeedback,
  useRadarStatus,
} from "./radar-state";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const SKIPPED_PAGE = 30;

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** The one line that says what Radar is doing. */
export function radarStatusLine(
  status: RadarStatus,
  t: {
    off: string;
    paused: string;
    pausedUntil: (time: string) => string;
    reconnect: string;
    watching: string;
    nextCheck: (time: string) => string;
  },
  now = new Date(),
): string {
  const { settings } = status;
  const locale = i18n.locale || "en";
  if (!settings.enabled) return t.off;
  if (settings.pausedUntil) {
    return settings.pausedUntil === RADAR_PAUSED_UNTIL_RESUMED
      ? t.paused
      : t.pausedUntil(formatRadarTime(settings.pausedUntil, settings.timeZone, locale, now));
  }
  if (status.sources.some((source) => source.enabled && source.state === "revoked"))
    return t.reconnect;
  if (status.nextCycleAt && Date.parse(status.nextCycleAt) > now.getTime() + 60_000)
    return t.nextCheck(formatRadarTime(status.nextCycleAt, settings.timeZone, locale, now));
  return t.watching;
}

export function RadarPanelDialog({
  open,
  onOpenChange,
  onOpenIntegrations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenIntegrations?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>
          <Trans>Radar</Trans>
        </DialogTitle>
        <RadarPanel
          onOpenIntegrations={
            onOpenIntegrations
              ? () => {
                  onOpenChange(false);
                  onOpenIntegrations();
                }
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/** Everything Radar watches and how it decides, each control saved as it changes. */
export function RadarPanel({ onOpenIntegrations }: { onOpenIntegrations?: () => void }) {
  const { t } = useLingui();
  const copy = useRadarCopy();
  const status = useRadarStatus();
  const [view, setView] = useState<"main" | "skipped">("main");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefAsked, setBriefAsked] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  // Opening the panel reads the status again, so today's counts are current.
  useEffect(() => {
    loadRadarStatus(0).catch(() => setLoadFailed(true));
  }, []);

  if (!status) {
    return loadFailed ? (
      <p role="alert" className="text-sm text-destructive">
        <Trans>Could not load. Try again.</Trans>
      </p>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        <Trans>Loading…</Trans>
      </p>
    );
  }
  if (view === "skipped") return <RadarSkipped onBack={() => setView("main")} />;

  const { settings, today } = status;
  async function apply(work: () => Promise<RadarStatus>) {
    setPending(true);
    setError(null);
    try {
      publishRadarStatus(await work());
      return true;
    } catch (err) {
      setError(errorText(err, t`Could not save. Try again.`));
      return false;
    } finally {
      setPending(false);
    }
  }
  const configure = (patch: RadarSettingsPatch) => apply(() => rpc.radar.configure(patch));
  async function removeRule(id: string) {
    setPending(true);
    setError(null);
    try {
      const rules = await rpc.radar.rule({ removeId: id });
      if (status) publishRadarStatus({ ...status, rules });
    } catch (err) {
      setError(errorText(err, t`Could not save. Try again.`));
    } finally {
      setPending(false);
    }
  }
  async function askForBrief() {
    if (await apply(() => rpc.radar.brief({}))) setBriefAsked(true);
  }
  function addPath(event: FormEvent) {
    event.preventDefault();
    const path = newPath.trim();
    if (!path || settings.contextPaths.includes(path)) return;
    void configure({ contextPaths: [...settings.contextPaths, path] }).then((saved) => {
      if (saved) setNewPath("");
    });
  }

  const line = radarStatusLine(status, {
    off: t`Off`,
    paused: t`Paused`,
    pausedUntil: (time) => t`Paused until ${time}`,
    reconnect: t`Needs reconnect`,
    watching: t`Watching`,
    nextCheck: (time) => t`Watching · next check ${time}`,
  });
  const paused = Boolean(settings.pausedUntil);
  const supported = status.sources.filter((source) => source.supported);
  const unsupported = status.sources.filter((source) => !source.supported);
  const learned = Boolean(status.summary || status.people.length || status.rules.length);

  return (
    <div className="space-y-6 text-sm" data-testid="radar-panel">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className="me-auto font-medium"
            role="status"
            data-testid="radar-status-line"
            dir="auto"
          >
            {line}
          </p>
          {settings.enabled ? (
            paused ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void configure({ pausedUntil: null })}
              >
                <Trans>Resume</Trans>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={pending}
                  render={<Button size="sm" variant="outline" />}
                >
                  <Trans>Pause</Trans>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-48">
                  {(["hour", "morning", "resumed"] as const).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={() =>
                        void configure({ pausedUntil: pauseUntil(key, settings.timeZone) })
                      }
                    >
                      {copy.pause(key)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          ) : null}
          <Switch
            aria-label={t`Radar`}
            checked={settings.enabled}
            disabled={pending}
            onCheckedChange={(enabled) =>
              void configure(enabled ? enableRadarPatch(status) : { enabled: false })
            }
          />
        </div>
        {settings.enabled && status.error ? (
          <p className="text-[12.5px] text-destructive" dir="auto">
            {status.error}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Count label={t`Seen`} value={today.seen} />
        <Count label={t`Told you`} value={today.interrupted} />
        <Count label={t`In brief`} value={today.briefed} />
        <button
          type="button"
          className="rounded-lg text-start hover:bg-muted"
          onClick={() => setView("skipped")}
        >
          <Count label={t`Skipped`} value={today.skipped} />
        </button>
      </div>

      <Section title={t`Sources`}>
        {supported.length ? (
          <ul className="divide-y divide-border">
            {supported.map((source) => (
              <SourceRow
                key={source.connectionId}
                source={source}
                disabled={pending}
                onToggle={(enabled) =>
                  void apply(() => rpc.radar.source({ connectionId: source.connectionId, enabled }))
                }
                onReconnect={onOpenIntegrations}
              />
            ))}
          </ul>
        ) : onOpenIntegrations ? (
          <Button size="sm" variant="outline" onClick={onOpenIntegrations}>
            <Trans>Connect apps</Trans>
          </Button>
        ) : null}
        {unsupported.length ? (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">
              <Trans>Other apps</Trans>
            </summary>
            <ul className="mt-1 space-y-0.5 ps-1">
              {unsupported.map((source) => (
                <li key={source.connectionId} dir="auto">
                  {[source.label, source.account].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      <Section title={t`Tell me`}>
        <fieldset
          aria-label={t`Tell me`}
          className="grid min-w-0 grid-cols-3 gap-1 rounded-lg bg-muted p-1"
        >
          {(["urgent", "important", "more"] as const).map((level) => (
            <Toggle
              key={level}
              pressed={settings.level === level}
              disabled={pending}
              onPressedChange={() => {
                if (settings.level !== level) void configure({ level });
              }}
              className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
            >
              {copy.level(level)}
            </Toggle>
          ))}
        </fieldset>
      </Section>

      <Row label={t`Quiet hours`}>
        {settings.quietHours.enabled ? (
          <>
            <ClockInput
              label={t`Quiet hours start`}
              value={settings.quietHours.start}
              disabled={pending}
              onSave={(start) => void configure({ quietHours: { start } })}
            />
            <span aria-hidden>–</span>
            <ClockInput
              label={t`Quiet hours end`}
              value={settings.quietHours.end}
              disabled={pending}
              onSave={(end) => void configure({ quietHours: { end } })}
            />
          </>
        ) : null}
        <Switch
          aria-label={t`Quiet hours`}
          checked={settings.quietHours.enabled}
          disabled={pending}
          onCheckedChange={(enabled) => void configure({ quietHours: { enabled } })}
        />
      </Row>

      <Section title={t`Briefs`}>
        <Row label={t`Morning`}>
          <ClockInput
            label={t`Morning brief time`}
            value={settings.morningBrief.time}
            disabled={pending || !settings.morningBrief.enabled}
            onSave={(time) => void configure({ morningBrief: { time } })}
          />
          <Switch
            aria-label={t`Morning brief`}
            checked={settings.morningBrief.enabled}
            disabled={pending}
            onCheckedChange={(enabled) => void configure({ morningBrief: { enabled } })}
          />
        </Row>
        <Row label={t`Evening`}>
          <ClockInput
            label={t`Evening brief time`}
            value={settings.eveningBrief.time}
            disabled={pending || !settings.eveningBrief.enabled}
            onSave={(time) => void configure({ eveningBrief: { time } })}
          />
          <Switch
            aria-label={t`Evening brief`}
            checked={settings.eveningBrief.enabled}
            disabled={pending}
            onCheckedChange={(enabled) => void configure({ eveningBrief: { enabled } })}
          />
        </Row>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !settings.enabled}
            onClick={() => void askForBrief()}
          >
            <Trans>Send a brief now</Trans>
          </Button>
          {briefAsked ? <SuccessPop label={t`On its way`} /> : null}
        </div>
      </Section>

      <Row label={t`Meeting prep`}>
        <Switch
          aria-label={t`Meeting prep`}
          checked={settings.meetingPrep}
          disabled={pending}
          onCheckedChange={(meetingPrep) => void configure({ meetingPrep })}
        />
      </Row>

      {learned ? (
        <Section title={t`What I've learned`}>
          {status.summary ? (
            <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
              {status.summary}
            </p>
          ) : null}
          {status.people.length ? (
            <ul aria-label={t`People`} className="space-y-1">
              {status.people.map((person) => (
                <li key={`${person.name}-${person.addresses.join(",")}`} dir="auto">
                  {person.name}
                  {person.relation ? (
                    <span className="text-muted-foreground"> · {person.relation}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {status.rules.length ? (
            <ul aria-label={t`Rules`} className="space-y-1">
              {status.rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2" data-testid="radar-rule">
                  <span className="min-w-0 flex-1" dir="auto">
                    <span className="block truncate">{copy.rule(rule)}</span>
                    {rule.note ? (
                      <span className="block truncate text-muted-foreground">{rule.note}</span>
                    ) : null}
                  </span>
                  {rule.origin === "learned" ? (
                    <span className="text-[12px] text-muted-foreground">
                      <Trans>Learned</Trans>
                    </span>
                  ) : null}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t`Remove rule`}
                    disabled={pending}
                    onClick={() => void removeRule(rule.id)}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      <details className="group">
        <summary className="cursor-pointer text-muted-foreground">
          <Trans>Advanced</Trans>
        </summary>
        <div className="mt-3 space-y-4">
          <Row label={t`Interrupts per day`}>
            <Input
              key={settings.maxInterruptsPerDay}
              type="number"
              min={0}
              max={30}
              aria-label={t`Interrupts per day`}
              className="w-20"
              defaultValue={settings.maxInterruptsPerDay}
              disabled={pending}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (
                  Number.isInteger(value) &&
                  value >= 0 &&
                  value <= 30 &&
                  value !== settings.maxInterruptsPerDay
                )
                  void configure({ maxInterruptsPerDay: value });
              }}
            />
          </Row>
          <div className="space-y-2">
            <p>
              <Trans>Context files</Trans>
            </p>
            {settings.contextPaths.length ? (
              <ul className="space-y-1">
                {settings.contextPaths.map((path) => (
                  <li key={path} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{path}</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t`Remove ${path}`}
                      disabled={pending}
                      onClick={() =>
                        void configure({
                          contextPaths: settings.contextPaths.filter((item) => item !== path),
                        })
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {settings.contextPaths.length < 10 ? (
              <form className="flex gap-2" onSubmit={addPath}>
                <Input
                  aria-label={t`Add a file`}
                  placeholder={t`Add a file`}
                  value={newPath}
                  maxLength={300}
                  onChange={(event) => setNewPath(event.target.value)}
                />
                <Button
                  type="submit"
                  size="default"
                  variant="outline"
                  disabled={pending || !newPath.trim()}
                >
                  <Trans>Add</Trans>
                </Button>
              </form>
            ) : null}
          </div>
          <Row label={t`Language`}>
            <Input
              key={settings.language}
              aria-label={t`Language`}
              placeholder={t`Same as chat`}
              className="w-40"
              maxLength={40}
              defaultValue={settings.language}
              disabled={pending}
              onBlur={(event) => {
                const language = event.target.value.trim();
                if (language !== settings.language) void configure({ language });
              }}
            />
          </Row>
        </div>
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="me-auto">{label}</span>
      {children}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="block rounded-lg border border-border px-2.5 py-2">
      <span className="block text-lg font-medium tabular-nums">{value}</span>
      <span className="block truncate text-[12px] text-muted-foreground">{label}</span>
    </span>
  );
}

/** A 24-hour time saved when the field is left with a new, complete value. */
function ClockInput({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onSave: (value: string) => void;
}) {
  return (
    <Input
      key={value}
      type="time"
      aria-label={label}
      className="w-28"
      defaultValue={value}
      disabled={disabled}
      onBlur={(event) => {
        const next = event.target.value;
        if (CLOCK.test(next) && next !== value) onSave(next);
      }}
    />
  );
}

function SourceRow({
  source,
  disabled,
  onToggle,
  onReconnect,
}: {
  source: RadarSourceStatus;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onReconnect?: () => void;
}) {
  const name = radarSourceName(source.source, source.label);
  const broken = source.state === "revoked" || source.state === "error";
  return (
    <li className="flex items-center gap-3 py-2" data-testid="radar-source">
      <RadarSourceMark source={source.source} label={source.label} />
      <span className="min-w-0 flex-1">
        <span className="block truncate" dir="auto">
          {name}
        </span>
        {source.account ? (
          <span className="block truncate text-[12px] text-muted-foreground" dir="auto">
            {source.account}
          </span>
        ) : null}
        {source.state === "revoked" ? (
          <span className="block text-[12px] text-destructive">
            <Trans>Needs reconnect</Trans>
          </span>
        ) : source.state === "error" && source.lastError ? (
          <span className="block truncate text-[12px] text-muted-foreground" dir="auto">
            {source.lastError}
          </span>
        ) : null}
      </span>
      {broken && onReconnect ? (
        <Button size="xs" variant="outline" onClick={onReconnect}>
          <Trans>Reconnect</Trans>
        </Button>
      ) : null}
      <Switch
        aria-label={source.account ? `${name} · ${source.account}` : name}
        checked={source.enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </li>
  );
}

/** What Radar kept quiet, with the reason, and a way to say it should not have. */
function RadarSkipped({ onBack }: { onBack: () => void }) {
  const { t } = useLingui();
  const [items, setItems] = useState<RadarUpdate[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    rpc.radar
      .updates({ view: "skipped", limit: SKIPPED_PAGE }, { signal: abort.signal })
      .then((page) => {
        if (abort.signal.aborted) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(t`Could not load. Try again.`);
      });
    return () => abort.abort();
  }, []);

  async function more() {
    if (!nextCursor) return;
    try {
      const page = await rpc.radar.updates({
        view: "skipped",
        limit: SKIPPED_PAGE,
        cursor: nextCursor,
      });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError(t`Could not load. Try again.`);
    }
  }

  async function important(item: RadarUpdate) {
    setPending(item.id);
    setError(null);
    try {
      const next = await sendRadarFeedback(item.id, "important");
      setItems((current) => current?.map((entry) => (entry.id === item.id ? next : entry)) ?? null);
    } catch (err) {
      setError(errorText(err, t`Could not save. Try again.`));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3 text-sm" data-testid="radar-skipped">
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={t`Back`} onClick={onBack}>
          <ChevronLeft aria-hidden />
        </Button>
        <h3 className="font-medium">
          <Trans>Skipped</Trans>
        </h3>
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      {items === null ? (
        error ? null : (
          <p role="status" className="text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        )
      ) : items.length ? (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 py-2.5"
              data-testid="radar-skipped-row"
            >
              <RadarSourceMark source={item.source} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block font-medium" dir="auto">
                  {item.title}
                </span>
                {item.reason ? (
                  <span className="block text-[12.5px] text-muted-foreground" dir="auto">
                    {item.reason}
                  </span>
                ) : null}
                <span className="block text-[12px] text-muted-foreground">
                  {formatRelativeTime(item.occurredAt)}
                </span>
              </span>
              {item.feedback === "important" ? (
                <span className="shrink-0 text-[12.5px] text-muted-foreground">
                  <Trans>Marked important</Trans>
                </span>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  className="shrink-0"
                  disabled={pending !== null}
                  onClick={() => void important(item)}
                >
                  <Trans>This was important</Trans>
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          <Trans>Nothing skipped.</Trans>
        </p>
      )}
      {nextCursor ? (
        <Button size="sm" variant="ghost" onClick={() => void more()}>
          <Trans>Show more</Trans>
        </Button>
      ) : null}
    </div>
  );
}
