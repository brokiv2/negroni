import type { Routine } from "@rakazo/contracts";
import { useState } from "react";
import { Text, View } from "react-native";
import { formatActivityRelativeTime } from "../../../lib/activity";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import {
  cronForTrackingFrequency,
  DEFAULT_TRACKING_FREQUENCY,
  isTrackingUrl,
  trackingFrequencyLabel,
  trackingPrompt,
  trackingScheduleLabel,
  VESPER_TRACKING_FREQUENCIES,
  type VesperTrackingFrequency,
} from "../../../lib/vesper/goals";
import { Button, Chip, ErrorNotice, Field, Sheet } from "../kit";
import { colors, s } from "../theme";

function newClientNonce(): string {
  return `vesper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Start tracking something.
 *
 * A tracking check is a `Routine`: a name, a prompt and a cron. There is no
 * url, condition or last-value column, so the page and the "only tell me when
 * it changed" rule are written into the prompt. That is honest about where the
 * behaviour lives — in the model's instructions, not in a watcher.
 */
export function TrackingFormSheet({
  botId,
  onClose,
  onCreated,
}: {
  botId: string;
  onClose: () => void;
  onCreated: (routine: Routine) => void;
}) {
  const [watching, setWatching] = useState("");
  const [url, setUrl] = useState("");
  const [frequency, setFrequency] = useState<VesperTrackingFrequency>(DEFAULT_TRACKING_FREQUENCY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlValid = !url.trim() || isTrackingUrl(url);

  const save = async () => {
    if (!watching.trim() || busy) return;
    if (!urlValid) {
      setError(t("Enter an http or https address, or leave the page empty."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await rpc<Routine>("routines/create", {
          botId,
          name: watching.trim().slice(0, 80),
          prompt: trackingPrompt({ watching, url }),
          crons: [cronForTrackingFrequency(frequency)],
          timezone: deviceTimezone(),
          active: true,
          notify: true,
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t("Track something")} onClose={onClose}>
      <Field
        label={t("What are you watching?")}
        value={watching}
        onChangeText={setWatching}
        placeholder={t("A table at my favourite restaurant")}
      />
      <Field
        label={t("Page to check (optional)")}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://example.com/page"
      />
      <Text style={[s.small, { marginBottom: 10, color: colors.text, fontWeight: "600" }]}>
        {t("How often")}
      </Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {VESPER_TRACKING_FREQUENCIES.map((option) => (
          <Button
            key={option}
            small
            primary={frequency === option}
            onPress={() => setFrequency(option)}
          >
            {trackingFrequencyLabel(option)}
          </Button>
        ))}
      </View>
      <Text style={[s.small, { marginBottom: 14 }]}>
        {t("Vesper checks on its own schedule and tells you only when something changed.")}
      </Text>
      <ErrorNotice error={error} />
      <Button primary busy={busy} disabled={!watching.trim()} onPress={() => void save()}>
        {t("Start tracking")}
      </Button>
    </Sheet>
  );
}

/** One tracking check: pause, resume, check now, stop. */
export function TrackingSheet({
  routine,
  onClose,
  onChanged,
  onRemoved,
}: {
  routine: Routine;
  onClose: () => void;
  onChanged: (routine: Routine) => void;
  onRemoved: (routineId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={routine.name} onClose={onClose}>
      <View style={{ marginBottom: 16 }}>
        <Chip tint={routine.active ? colors.green : colors.sky}>
          {routine.active ? t("Active") : t("Paused")}
        </Chip>
      </View>
      <Text style={[s.text, { marginBottom: 10 }]}>{trackingScheduleLabel(routine)}</Text>
      <Text selectable style={[s.muted, { marginBottom: 16 }]}>
        {routine.prompt}
      </Text>
      <Text style={[s.small, { marginBottom: 16 }]}>
        {routine.lastRunAt
          ? t("Last check {when}", { when: formatActivityRelativeTime(routine.lastRunAt) })
          : t("No check has run yet")}
      </Text>
      {checked && (
        <Text style={[s.small, { marginBottom: 16, color: colors.blueDark }]}>
          {t("Checking now. The result lands in your conversation.")}
        </Text>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          busy={busy}
          onPress={() =>
            void run(async () => {
              onChanged(
                await rpc<Routine>("routines/update", {
                  routineId: routine.id,
                  active: !routine.active,
                }),
              );
            })
          }
        >
          {routine.active ? t("Pause") : t("Resume")}
        </Button>
        <Button
          small
          busy={busy}
          onPress={() =>
            void run(async () => {
              await rpc("routines/testRun", {
                routineId: routine.id,
                clientNonce: newClientNonce(),
              });
              setChecked(true);
            })
          }
        >
          {t("Check now")}
        </Button>
        <Button
          small
          busy={busy}
          onPress={() =>
            void run(async () => {
              onChanged(
                await rpc<Routine>("routines/update", {
                  routineId: routine.id,
                  notify: !routine.notify,
                }),
              );
            })
          }
        >
          {routine.notify ? t("Stop notifying me") : t("Notify me")}
        </Button>
        <Button
          small
          danger
          busy={busy}
          onPress={() =>
            void run(async () => {
              await rpc("routines/remove", { routineId: routine.id });
              onRemoved(routine.id);
            })
          }
        >
          {t("Stop tracking")}
        </Button>
      </View>
    </Sheet>
  );
}
