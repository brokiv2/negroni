import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RadarRule, RadarScores, RadarUpdate } from "@rakazo/contracts";
import { RadarGate } from "@rakazo/contracts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { useRadarCopy } from "./copy";
import { useRadarStatus } from "./radar-state";

/**
 * "Why now" and "why not" in plain sentences, built only from the stored decision trace
 * and evidence, never from a fresh model answer.
 */
export function RadarDecision({ update, rules }: { update: RadarUpdate; rules: RadarRule[] }) {
  const { t } = useLingui();
  const copy = useRadarCopy();
  const locale = i18n.locale || "en";
  const trace = update.trace ?? {};
  const sentences: string[] = [];
  if (update.reason) sentences.push(update.reason);
  const result = trace.result ?? update.disposition;
  if (result === "interrupt") sentences.push(t`Told you right away.`);
  else if (result === "brief") sentences.push(t`Kept for your brief.`);
  else if (result === "silent") sentences.push(t`Stayed quiet.`);
  const score = trace.importance ?? update.importance;
  if (score !== undefined) {
    const importance = Math.round(score);
    sentences.push(t`Importance ${importance} of 100.`);
  }
  if (trace.thresholds) {
    const interrupt = Math.round(trace.thresholds.interrupt);
    const brief = Math.round(trace.thresholds.brief);
    sentences.push(t`I interrupt from ${interrupt} and brief from ${brief}.`);
  }
  if (trace.thresholdOffset) {
    const offset = new Intl.NumberFormat(locale, { signDisplay: "always" }).format(
      Math.round(trace.thresholdOffset),
    );
    sentences.push(t`Your feedback moved the bar by ${offset}.`);
  }
  if (trace.costOfDelay === "critical")
    sentences.push(t`Waiting would cause harm before your next brief.`);
  else if (trace.costOfDelay === "high")
    sentences.push(t`Waiting until your next brief would cost you.`);
  else if (trace.costOfDelay) sentences.push(t`Waiting until your next brief costs little.`);
  if (trace.verdict === "unclear") sentences.push(t`I couldn't tell what this needs.`);
  else if (trace.whoMustAct === "owner") sentences.push(t`You need to act.`);
  else if (trace.whoMustAct === "someone_else") sentences.push(t`Someone else needs to act.`);
  else if (trace.whoMustAct === "nobody") sentences.push(t`Nobody needs to act.`);
  else if (trace.whoMustAct === "unclear") sentences.push(t`It's unclear who needs to act.`);
  if (trace.scores) {
    const signals: Record<keyof RadarScores, string> = {
      addressed: t`who it's addressed to`,
      actionRequired: t`action needed`,
      timePressure: t`deadline`,
      stakes: t`stakes`,
      relationship: t`who it's from`,
      novelty: t`how new it is`,
      linkage: t`your current work`,
      seen: t`whether you've seen it`,
    };
    const list = new Intl.ListFormat(locale, { type: "conjunction" });
    const entries = Object.entries(trace.scores) as Array<[keyof RadarScores, number]>;
    const strong = entries.filter(([, value]) => value >= 2).map(([key]) => signals[key]);
    const weak = entries.filter(([, value]) => value <= 1).map(([key]) => signals[key]);
    if (strong.length) {
      const signalsFor = list.format(strong);
      sentences.push(t`Counted for it: ${signalsFor}.`);
    }
    if (weak.length) {
      const signalsAgainst = list.format(weak);
      sentences.push(t`Counted against it: ${signalsAgainst}.`);
    }
  }
  if (trace.confidence !== undefined) {
    const percent = Math.round(trace.confidence * 100);
    sentences.push(t`Confidence ${percent}%.`);
  }
  for (const id of trace.rules ?? []) {
    const rule = rules.find((item) => item.id === id);
    if (rule) sentences.push(copy.rule(rule));
  }
  if (trace.gates?.length) {
    // Every gate in the contract has a sentence; a name from a newer server says nothing.
    const gateSentences: Record<RadarGate, string> = {
      rule_never: t`Your rule says never to tell you about this.`,
      rule_digest: t`Your rule keeps this for the brief.`,
      rule_always: t`Your rule says to always tell you about this.`,
      unclear: t`It wasn't clear enough to interrupt you.`,
      not_owner: t`It wasn't clearly yours to act on.`,
      below_threshold: t`It didn't score high enough to bring up.`,
      low_confidence: t`I wasn't sure enough to interrupt you.`,
      already_seen: t`You had already seen it.`,
      second_opinion: t`A second look disagreed, so it went to the brief.`,
      critical: t`Urgent enough to skip quiet hours and meetings.`,
      paused: t`Radar was paused.`,
      quiet_hours: t`It came in during quiet hours.`,
      in_meeting: t`You were in a meeting.`,
      daily_cap: t`Today's interrupt limit was reached.`,
      story_limit: t`You already heard about this today.`,
      spacing: t`You had heard from me less than 30 minutes before.`,
      folded_into_brief: t`It waited for quiet hours to end, then joined your brief.`,
      handled_in_source: t`It was already handled or gone when I checked the source.`,
      seen_in_source: t`You had already opened it when I checked the source.`,
      own: t`It was your own message.`,
      security_code: t`It looked like a sign-in or security code.`,
      bulk: t`It looked like bulk or automated mail.`,
      declined: t`You declined this event.`,
      calendar_window: t`The event isn't in the next two days.`,
      backoff: t`You said something like this wasn't important.`,
      duplicate: t`It matched an earlier update.`,
      stale: t`It was too old to judge.`,
      unevaluated: t`It couldn't be evaluated.`,
      meeting_prep: t`It came from preparing you for a meeting.`,
    };
    const told = new Set<RadarGate>();
    for (const name of trace.gates) {
      const gate = RadarGate.safeParse(name);
      if (!gate.success || told.has(gate.data)) continue;
      told.add(gate.data);
      sentences.push(gateSentences[gate.data]);
    }
  }
  if (!sentences.length) return null;
  return (
    <ul className="space-y-1 text-[13.5px] leading-[1.5] text-foreground/80" dir="auto">
      {sentences.map((sentence, index) => (
        <li key={index}>{sentence}</li>
      ))}
    </ul>
  );
}

export function RadarEvidence({ text }: { text: string }) {
  return (
    <blockquote
      className="border-s-2 border-border ps-3 text-[13.5px] leading-[1.5] text-muted-foreground"
      dir="auto"
    >
      “{text}”
    </blockquote>
  );
}

/** "Why this" for a chat card: a read-only look at the stored decision, not feedback. */
export function RadarWhyDialog({
  updateId,
  title,
  open,
  onOpenChange,
}: {
  updateId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const status = useRadarStatus();
  const [update, setUpdate] = useState<RadarUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || update) return;
    let live = true;
    setError(null);
    rpc.radar
      .update({ id: updateId })
      .then((next) => {
        if (live) setUpdate(next);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : t`Could not load. Try again.`);
      });
    return () => {
      live = false;
    };
  }, [open, update, updateId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>
          <Trans>Why this</Trans>
        </DialogTitle>
        <DialogDescription dir="auto">{title}</DialogDescription>
        {update ? (
          <div className="space-y-3">
            <RadarDecision update={update} rules={status?.rules ?? []} />
            {update.evidence ? <RadarEvidence text={update.evidence} /> : null}
          </div>
        ) : error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : (
          <p role="status" className="text-[13px] text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
