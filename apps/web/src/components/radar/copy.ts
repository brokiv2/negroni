import { useLingui } from "@lingui/react/macro";
import type { RadarAction, RadarLevel, RadarRule } from "@rakazo/contracts";
import type { RadarLater, RadarPause } from "../../lib/radar-time";
import { radarSourceName } from "./RadarSource";

/** Labels shared by the Radar cards, For you and the Radar panel. */
export function useRadarCopy() {
  const { t } = useLingui();
  return {
    level(level: RadarLevel) {
      if (level === "urgent") return t`Only urgent`;
      if (level === "important") return t`Important`;
      return t({ message: "More", context: "Radar level" });
    },
    later(later: RadarLater) {
      if (later === "hour") return t`In 1 hour`;
      if (later === "evening") return t`This evening`;
      return t`Tomorrow morning`;
    },
    pause(pause: RadarPause) {
      if (pause === "hour") return t`1 hour`;
      if (pause === "morning") return t`Until tomorrow 08:00`;
      return t`Until resumed`;
    },
    /** The primary action when the update carries no offer of its own. */
    fallback(action: RadarAction | undefined, canOpen: boolean): { label: string; open: boolean } {
      if (action === "reply") return { label: t`Draft reply`, open: false };
      if (action !== "decide" && canOpen) return { label: t`Open`, open: true };
      return { label: t`Handle it`, open: false };
    },
    rule(rule: RadarRule) {
      const { sender, domain, topic, source } = rule.match;
      const target = [sender, domain, topic, source ? radarSourceName(source) : undefined]
        .filter(Boolean)
        .join(" · ");
      if (rule.kind === "always") return t`Always tell me: ${target}`;
      if (rule.kind === "digest") return t`Brief only: ${target}`;
      return t`Never: ${target}`;
    },
  };
}

export type RadarCopy = ReturnType<typeof useRadarCopy>;
