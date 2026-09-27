import type { ActionApprovalRule, ActionAutoReviewSettings } from "@rakazo/contracts";
import { ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";
import { Button, Card, CheckRow, Chip, Empty, ErrorNotice, SectionHeading } from "../kit";
import { colors, s } from "../theme";

/**
 * Approval rules.
 *
 * Rules are made by answering "always allow" to a request in the conversation,
 * so this screen reads them back, takes one away, or turns one into an ask
 * again. It does not offer to invent a rule for a tool that has never run —
 * that is how you end up allowing something you have not seen.
 */
export function VesperApprovalsScreen() {
  const [rules, setRules] = useState<ActionApprovalRule[]>([]);
  const [autoReview, setAutoReview] = useState<ActionAutoReviewSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const [list, review] = await Promise.allSettled([
      rpc<ActionApprovalRule[]>("approvalRules/list", {}, { signal }),
      rpc<ActionAutoReviewSettings>("autoReview/get", {}, { signal }),
    ]);
    if (signal.aborted) return;
    if (list.status === "fulfilled") setRules(list.value);
    if (review.status === "fulfilled") setAutoReview(review.value);
    setError(
      list.status === "rejected"
        ? (list.reason as Error).message
        : review.status === "rejected"
          ? (review.reason as Error).message
          : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);

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

  const allowed = rules.filter((rule) => rule.effect === "always_allow");
  const asked = rules.filter((rule) => rule.effect === "require_approval");

  return (
    <View style={{ gap: 22 }}>
      <ErrorNotice error={error} />
      {loading && <ActivityIndicator color={colors.blueDark} />}

      {!!autoReview && (
        <Card style={{ gap: 10 }}>
          <SectionHeading title={t("Second opinion")} />
          <CheckRow
            label={t("Have a reviewer check risky actions first")}
            checked={autoReview.enabled}
            onPress={() =>
              void run(async () => {
                setAutoReview(
                  await rpc<ActionAutoReviewSettings>("autoReview/set", {
                    enabled: !autoReview.enabled,
                  }),
                );
              })
            }
          />
          <Text style={s.small}>
            {autoReview.checkerAvailable
              ? t(
                  "A separate model reads the action before it runs and asks you when it is unsure.",
                )
              : t("No reviewer model is configured on this server yet.")}
          </Text>
        </Card>
      )}

      <View style={{ gap: 10 }}>
        <SectionHeading title={t("Always allowed")} />
        {allowed.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            busy={busy}
            action={t("Ask me again")}
            onAction={() =>
              void run(async () => {
                const next = await rpc<ActionApprovalRule>("approvalRules/set", {
                  effect: "require_approval",
                  matchKind: rule.matchKind,
                  matchValue: rule.matchValue,
                });
                setRules((current) =>
                  current.map((entry) => (entry.id === rule.id ? next : entry)),
                );
              })
            }
            onForget={() =>
              void run(async () => {
                await rpc("approvalRules/remove", { id: rule.id });
                setRules((current) => current.filter((entry) => entry.id !== rule.id));
              })
            }
          />
        ))}
        {!allowed.length && !loading && (
          <Empty
            icon={ShieldCheck}
            title={t("Vesper asks about everything")}
            detail={t(
              "When you answer Always allow to a request in the conversation, it shows up here.",
            )}
          />
        )}
      </View>

      {!!asked.length && (
        <View style={{ gap: 10 }}>
          <SectionHeading title={t("Always asked about")} />
          {asked.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              busy={busy}
              onForget={() =>
                void run(async () => {
                  await rpc("approvalRules/remove", { id: rule.id });
                  setRules((current) => current.filter((entry) => entry.id !== rule.id));
                })
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ruleKindLabel(kind: ActionApprovalRule["matchKind"]): string {
  switch (kind) {
    case "tool":
      return t("Tool");
    case "connector":
      return t("Connection");
    case "category":
      return t("Kind of action");
  }
}

function RuleRow({
  rule,
  busy,
  action,
  onAction,
  onForget,
}: {
  rule: ActionApprovalRule;
  busy: boolean;
  action?: string;
  onAction?: () => void;
  onForget: () => void;
}) {
  return (
    <Card style={{ gap: 10 }}>
      <Chip tint={colors.sky}>{ruleKindLabel(rule.matchKind)}</Chip>
      <Text selectable style={s.text}>
        {rule.matchValue}
      </Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {!!action && !!onAction && (
          <Button small busy={busy} onPress={onAction}>
            {action}
          </Button>
        )}
        <Button small danger busy={busy} onPress={onForget}>
          {t("Remove rule")}
        </Button>
      </View>
    </Card>
  );
}
