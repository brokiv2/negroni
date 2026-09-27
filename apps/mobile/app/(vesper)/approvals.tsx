import { VesperApprovalsScreen } from "../../components/vesper/apps/approvals-screen";
import { VesperScreenFrame } from "../../components/vesper/apps/screen-frame";
import { t } from "../../lib/i18n";

/** Approval rules, pushed from Apps. */
export default function VesperApprovalsRoute() {
  return (
    <VesperScreenFrame title={t("Approval rules")}>
      <VesperApprovalsScreen />
    </VesperScreenFrame>
  );
}
