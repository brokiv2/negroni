import type { EffectReceipt } from "@rakazo/contracts";
import { Receipt } from "lucide-react-native";
import { Text, View } from "react-native";
import { formatActivityRelativeTime } from "../../../lib/activity";
import { t } from "../../../lib/i18n";
import {
  effectKindLabel,
  effectStatusLabel,
  reviewDecisionLabel,
} from "../../../lib/vesper/activity";
import { colors, s, vt } from "../theme";

/**
 * A receipt: one `ExternalEffect` row.
 *
 * What the agent did outside the app, what it named while doing it, and who or
 * what let it through. The raw request never leaves the server — these rows are
 * the same bounded set the approval card showed.
 */
export function VesperReceiptCard({ receipt }: { receipt: EffectReceipt }) {
  const verdict = reviewDecisionLabel(receipt.reviewDecision);
  const failed = receipt.status === "failed" || receipt.status === "abandoned";
  return (
    <View style={[s.card, { gap: 10, marginBottom: 11 }]}>
      <View style={[s.row, { gap: 12 }]}>
        <View
          style={[
            s.iconBox,
            { width: 34, height: 34, backgroundColor: failed ? colors.orange : colors.green },
          ]}
        >
          <Receipt size={16} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={[s.text, { fontWeight: "500" }]}>
            {effectKindLabel(receipt.kind)}
          </Text>
          <Text style={s.small}>{effectStatusLabel(receipt.status)}</Text>
        </View>
        <Text style={s.small}>{formatActivityRelativeTime(receipt.updatedAt)}</Text>
      </View>

      {receipt.summary.length > 0 && (
        <View style={{ gap: 7 }}>
          {receipt.summary.map((row) => (
            <View key={`${row.k}:${row.v}`} style={{ gap: 2 }}>
              <Text style={s.label}>{row.k}</Text>
              <Text numberOfLines={3} style={s.text}>
                {row.v}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!!verdict && (
        <View
          style={[
            s.row,
            {
              gap: 8,
              padding: 11,
              borderRadius: vt.radius.toolCardInner,
              backgroundColor: colors.canvas,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{verdict}</Text>
            {!!receipt.reviewReason && <Text style={s.small}>{receipt.reviewReason}</Text>}
            {!!receipt.reviewModel && (
              <Text style={s.small}>{t("Checked by {model}", { model: receipt.reviewModel })}</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
