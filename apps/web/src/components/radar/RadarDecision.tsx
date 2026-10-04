import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RadarRule, RadarScores, RadarUpdate } from "@rakazo/contracts";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { useRadarCopy } from "./copy";
import { sendRadarFeedback, useRadarStatus } from "./radar-state";

/** Gates the policy names in a trace, spelled loosely so a renamed gate still reads. */
const gateKey = (gate: string) => gate.toLowerCase().replace(/[^a-z]/g, "");

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
  const gates: Record<string, string> = {
    paused: t`Radar was paused.`,
    quiethours: t`It came in during quiet hours.`,
    meeting: t`You were in a meeting.`,
    cap: t`Today's interrupt limit was reached.`,
    spacing: t`You had heard from me less than 30 minutes before.`,
    story: t`You already heard about this today.`,
    critical: t`Urgent enough to skip quiet hours and meetings.`,
  };
  const aliases: Record<string, string> = {
    quiet: "quiethours",
    inmeeting: "meeting",
    dailycap: "cap",
    budget: "cap",
    held: "cap",
    storylimit: "story",
  };
  const seenGates = new Set<string>();
  for (const gate of trace.gates ?? []) {
    const key = aliases[gateKey(gate)] ?? gateKey(gate);
    const sentence = gates[key];
    if (sentence && !seenGates.has(key)) {
      seenGates.add(key);
      sentences.push(sentence);
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

/**
 * "Why this" for a chat card. Opening it is the implicit `opened` feedback, which also
 * returns the stored trace; it never overrides what the owner said explicitly.
 */
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
    sendRadarFeedback(updateId, "opened")
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
