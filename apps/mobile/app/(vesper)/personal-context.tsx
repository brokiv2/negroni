import type { PersonalThread } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { VesperScreenFrame } from "../../components/vesper/apps/screen-frame";
import { VesperContextScreen } from "../../components/vesper/context/context-screen";
import { rpc } from "../../lib/api";
import { t } from "../../lib/i18n";

/**
 * Personal context, pushed from Apps.
 *
 * It resolves the main assistant itself rather than taking a route param, so a
 * deep link or a reload lands on the same bot Vesper is already driving.
 */
export default function VesperPersonalContextRoute() {
  const [botId, setBotId] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void rpc<PersonalThread>("personal/thread", {}, { signal: abort.signal })
      .then((thread) => {
        if (!abort.signal.aborted) setBotId(thread.botId);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);

  return (
    <VesperScreenFrame title={t("Personality and memory")}>
      <VesperContextScreen botId={botId} />
    </VesperScreenFrame>
  );
}
