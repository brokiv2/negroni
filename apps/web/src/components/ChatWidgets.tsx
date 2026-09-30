import type { EmailDraftWidget, WeatherWidget } from "@rakazo/contracts";
import { EmailDraftReview } from "@rakazo/contracts";
import { Button, Input } from "@rakazo/ui-web";
import { useState } from "react";

export function WeatherCard({ weather }: { weather: WeatherWidget }) {
  return (
    <section
      aria-label={`Weather in ${weather.location}`}
      className="w-full max-w-md rounded-3xl border border-border bg-card p-5 text-foreground"
    >
      <h3 className="font-semibold">{weather.location}</h3>
      <p className="my-3 text-4xl">
        {Math.round(weather.temperature)}°{weather.unit}
      </p>
      <p className="text-muted-foreground">{weather.description}</p>
      <div className="my-5 flex gap-6 overflow-x-auto">
        {weather.forecast.map((item, index) => (
          <div key={`${item.label}-${index}`} className="shrink-0 text-center">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="my-2 text-xl">{Math.round(item.temperature)}°</p>
            {item.precipitation !== undefined && (
              <p className="text-xs text-muted-foreground">{item.precipitation}%</p>
            )}
          </div>
        ))}
      </div>
      <time dateTime={weather.observedAt} className="mb-2 block text-xs text-muted-foreground">
        {new Date(weather.observedAt).toLocaleString()}
      </time>
      <a
        href={weather.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground underline"
      >
        {new URL(weather.sourceUrl).hostname}
      </a>
    </section>
  );
}

export function EmailDraftCard({
  draft,
  status,
  answer,
  canAnswer,
  onAnswer,
}: {
  draft: EmailDraftWidget;
  status?: string;
  answer?: string;
  canAnswer: boolean;
  onAnswer: (answer: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    if (busy) return;
    const addresses = (value: string) =>
      value
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const review = EmailDraftReview.safeParse({
      type: "email_review",
      action: "send",
      draft: { ...draft, to: addresses(to), cc: addresses(cc), subject, body },
    });
    if (!review.success) {
      setError("Check the recipients, subject and message.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAnswer(JSON.stringify(review.data));
      setEditing(false);
    } catch {
      setError("Could not submit the email. Your edits are saved here; try again.");
    } finally {
      setBusy(false);
    }
  }
  const pending = status !== "answered" && canAnswer;
  return (
    <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 text-foreground">
      <p className="mb-3 text-xs text-muted-foreground">{draft.account}</p>
      {editing && pending ? (
        <div className="flex flex-col gap-3">
          <Input
            aria-label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
          />
          <Input
            aria-label="Cc"
            placeholder="Cc"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            disabled={busy}
          />
          <Input
            aria-label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
          />
          <textarea
            aria-label="Email body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
            rows={10}
            className="w-full rounded-lg border border-border bg-background p-3"
          />
          <div className="flex gap-2">
            <Button onClick={send} disabled={busy}>
              {busy ? "Submitting…" : "Send"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="font-semibold">{draft.subject}</h3>
          <p className="my-2 text-xs text-muted-foreground">{draft.to.join(", ")}</p>
          <p className="whitespace-pre-wrap">{draft.body}</p>
          {pending ? (
            <Button variant="outline" className="mt-3" onClick={() => setEditing(true)}>
              Edit &amp; send
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {answer === "send"
                ? "Send requested"
                : answer === "cancel"
                  ? "Cancelled"
                  : "Reviewed"}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
