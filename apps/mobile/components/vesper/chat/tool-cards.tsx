import type { MessageBlock } from "@rakazo/contracts";
import { browserCardSiteLabel, planCardProgress, planCardStatusLabel } from "@rakazo/core";
import { Check, FileText, Globe2, Hand, type LucideIcon, Mail, Search } from "lucide-react-native";
import type { ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { t } from "../../../lib/i18n";
import type { ArtifactImageTarget } from "../../../lib/vesper/artifact-image";
import { Button } from "../kit";
import { colors, s, vt } from "../theme";
import { CardImage } from "./card-image";

/**
 * The five rich tool-result cards.
 *
 * Only `browser` has a live emitter today; the other four have final shapes and
 * builders but no data source yet, so they are exercised from fixtures. Nothing
 * here fabricates sample data to make a card appear.
 *
 * The rule every one of them follows: an absent optional field is meaningful,
 * not a bug. Never draw an empty box, a zero, or "undefined" in its place — and
 * when the card cannot be drawn at all, fall back to `summary`.
 */

type CardProps<K extends MessageBlock["kind"]> = {
  block: Extract<MessageBlock, { kind: K }>;
  target: ArtifactImageTarget | null;
};

function Surface({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View
      style={{
        maxWidth: vt.size.toolCardMaxWidth,
        width: "100%",
        backgroundColor: tint ?? vt.extras.bubbleAssistant,
        borderRadius: vt.radius.card,
        padding: 15,
        gap: 11,
      }}
    >
      {children}
    </View>
  );
}

function CardHead({
  icon: Icon,
  title,
  detail,
  trailing,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={[s.row, { gap: 11 }]}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: vt.radius.toolCardInner,
          backgroundColor: colors.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={18} color={colors.blueDark} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={s.heading}>
          {title}
        </Text>
        {!!detail && (
          <Text numberOfLines={1} style={s.small}>
            {detail}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );
}

/** Open only http(s), even when the card carries something else. */
function openExternal(url: string | undefined): void {
  if (!url) return;
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") return;
  } catch {
    return;
  }
  void Linking.openURL(url).catch(() => undefined);
}

function isHttpUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function BrowserCard({
  block,
  target,
  onTakeControl,
  computerReachable,
}: CardProps<"browser"> & {
  onTakeControl?: (computerId: string) => void;
  /** From `computer.status`, never re-derived from the card. */
  computerReachable: boolean;
}) {
  // Title absent means the page reported none, or it is still loading.
  const heading = block.title || browserCardSiteLabel(block.url);
  const failed = block.status === "error";
  const canTakeControl = !!block.computerId && computerReachable && !!onTakeControl;
  return (
    <Surface>
      <CardHead
        icon={Globe2}
        title={t("Browser")}
        detail={browserCardSiteLabel(block.url)}
        trailing={
          block.status === "ready" ? <Check size={18} color={vt.extras.checkOk} /> : undefined
        }
      />
      {failed ? (
        // A picture of a failed load is noise, not evidence.
        <Text style={[s.muted, { color: colors.danger }]}>{block.error || block.summary}</Text>
      ) : (
        <CardImage
          image={block.screenshot}
          target={target}
          label={heading}
          loading={block.status === "loading"}
        />
      )}
      {canTakeControl && (
        <Button
          small
          icon={Hand}
          onPress={() => onTakeControl?.(block.computerId as string)}
          style={{ backgroundColor: colors.card }}
        >
          {t("Take control")}
        </Button>
      )}
    </Surface>
  );
}

export function MailCard({
  block,
  onOpen,
}: CardProps<"mail"> & { onOpen?: (url: string) => void }) {
  // The server already handles zero / singular / plural / "at least N".
  if (block.mode === "search") {
    return (
      <View style={[s.row, { gap: 8, alignSelf: "flex-start" }]}>
        <Search size={14} color={colors.muted} />
        <Text style={s.muted}>{block.summary}</Text>
      </View>
    );
  }
  const heading = block.subject || block.summary;
  const meta = [
    t("Email"),
    block.messageCount ? t("{count} messages", { count: block.messageCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Surface tint={vt.extras.surfaceMailCard}>
      <CardHead icon={Mail} title={block.sender || heading} detail={meta} />
      {!!block.subject && <Text style={[s.text, { fontWeight: "600" }]}>{block.subject}</Text>}
      {!!block.excerpt && (
        <Text numberOfLines={3} style={s.muted}>
          {block.excerpt}
        </Text>
      )}
      {isHttpUrl(block.openUrl) && (
        <Button
          small
          onPress={() => (onOpen ? onOpen(block.openUrl as string) : openExternal(block.openUrl))}
          style={{ backgroundColor: colors.card }}
        >
          {t("Open email")}
        </Button>
      )}
    </Surface>
  );
}

export function PdfCard({
  block,
  target,
  onOpen,
}: CardProps<"pdf"> & { onOpen?: (artifactId: string) => void }) {
  const fields = block.fields?.slice(0, 4) ?? [];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={block.summary}
      onPress={() => onOpen?.(block.artifactId)}
    >
      <Surface tint={vt.extras.surfaceToolCard}>
        <CardHead
          icon={FileText}
          title={block.name}
          detail={
            block.pageCount
              ? t("{count} pages", { count: block.pageCount })
              : t("Tap to read the document")
          }
          trailing={
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderRadius: 6,
                backgroundColor: vt.extras.pdfBadge,
              }}
            >
              <Text style={{ color: colors.card, fontSize: 9, fontWeight: "700" }}>PDF</Text>
            </View>
          }
        />
        {block.previewImage ? (
          <CardImage image={block.previewImage} target={target} label={block.name} />
        ) : (
          <View
            style={{
              backgroundColor: vt.extras.docPage,
              borderWidth: 1,
              borderColor: vt.extras.docPageBorder,
              borderRadius: vt.radius.toolCardInner,
              padding: 14,
              gap: 9,
            }}
          >
            {fields.length ? (
              fields.map((field) => (
                <View key={field.name} style={{ gap: 2 }}>
                  <Text style={s.label}>{field.name}</Text>
                  {/* An empty value is an empty form field, not missing data. */}
                  <Text style={s.text}>{field.value || "—"}</Text>
                </View>
              ))
            ) : (
              <Text style={s.muted}>{block.name}</Text>
            )}
          </View>
        )}
      </Surface>
    </Pressable>
  );
}

export function PlanCard({
  block,
  onOpenRun,
}: CardProps<"plan"> & { onOpenRun?: (runId: string) => void }) {
  const { done, total } = planCardProgress(block.steps);
  const waiting = block.status === "waiting_input" || block.status === "waiting_approval";
  return (
    <Surface tint={vt.extras.surfaceToolCard}>
      <View style={[s.row, { gap: 11 }]}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: vt.radius.toolCardInner,
            backgroundColor: waiting ? vt.extras.tintOrange : vt.extras.tintSky,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={16} color={waiting ? colors.text : colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.heading}>{block.title}</Text>
          <Text style={s.small}>
            {/* The core helper gives the English copy; t() localizes it, so the
                card and the header status line never disagree. */}
            {total
              ? `${t(planCardStatusLabel(block.status))} · ${t("{done}/{total} steps", { done, total })}`
              : t(planCardStatusLabel(block.status))}
          </Text>
        </View>
      </View>
      {total > 0 && (
        <View
          style={{
            height: 4,
            borderRadius: vt.radius.progressBar,
            backgroundColor: colors.line,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: 4,
              width: `${Math.round((done / total) * 100)}%`,
              backgroundColor: vt.extras.progressFill,
            }}
          />
        </View>
      )}
      {block.steps.length > 0 && (
        <View style={{ gap: 6 }}>
          {block.steps.map((step, index) => (
            <View key={step.id ?? `${index}:${step.title}`} style={{ gap: 1 }}>
              <View style={[s.row, { gap: 9 }]}>
                <Text style={[s.small, { width: 16, color: vt.extras.listGlyph }]}>
                  {step.status === "done" || step.status === "skipped" ? "✓" : `${index + 1}.`}
                </Text>
                <Text style={[s.text, { flex: 1 }]}>{step.title}</Text>
              </View>
              {!!step.detail && (
                <Text numberOfLines={1} style={[s.small, { marginLeft: 25 }]}>
                  {step.detail}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      {!!block.note && (
        <Text numberOfLines={2} style={[s.small, waiting && { color: vt.extras.accentInk }]}>
          {block.note}
        </Text>
      )}
      {!!block.runId && !!onOpenRun && (
        <Button
          small
          onPress={() => onOpenRun(block.runId as string)}
          style={{ backgroundColor: colors.card }}
        >
          {t("Open the run")}
        </Button>
      )}
    </Surface>
  );
}

export function FinanceCard({ block }: CardProps<"finance">) {
  const finance = vt.finance;
  // Currency absent means "whatever the source file used" — never guess a symbol.
  const amount = (value: number) =>
    block.currency
      ? `${value.toLocaleString("en-US")} ${block.currency}`
      : value.toLocaleString("en-US");
  const tiles = [
    { label: t("Income"), value: amount(block.income), tint: finance.tileValue },
    { label: t("Spending"), value: amount(block.spending), tint: finance.tileValue },
    { label: t("Remaining"), value: amount(block.saved), tint: finance.savedValue },
  ];
  return (
    <View
      style={{
        maxWidth: vt.size.toolCardMaxWidth,
        width: "100%",
        backgroundColor: finance.body,
        borderRadius: vt.radius.financeCard,
        overflow: "hidden",
      }}
    >
      <View style={{ backgroundColor: finance.gradientVia, padding: 16, gap: 4 }}>
        <Text style={{ color: finance.tileValue, fontSize: 16, fontWeight: "600" }}>
          {block.title}
        </Text>
        {!!block.period && (
          <Text style={{ color: finance.caption, fontSize: 11 }}>
            {`${block.period.from} – ${block.period.to}`}
          </Text>
        )}
      </View>
      <View style={[s.row, { gap: 8, padding: 16 }]}>
        {tiles.map((tile) => (
          <View
            key={tile.label}
            style={{
              flex: 1,
              backgroundColor: finance.tile,
              borderRadius: vt.radius.financeTile,
              padding: 12,
              gap: 4,
            }}
          >
            <Text style={{ color: finance.tileLabel, fontSize: 10 }}>{tile.label}</Text>
            <Text style={{ color: tile.tint, fontSize: 15, fontWeight: "600" }}>{tile.value}</Text>
          </View>
        ))}
      </View>
      {!block.currency && (
        <Text style={{ color: finance.footnote, fontSize: 10, paddingHorizontal: 16 }}>
          {t("Amounts are in the source file's currency.")}
        </Text>
      )}
      {block.spending > 0 && block.categories.length > 0 && (
        <View style={{ padding: 16, gap: 9 }}>
          {block.categories.map((category) => (
            <View key={category.name} style={{ gap: 4 }}>
              <View style={s.between}>
                <Text style={{ color: finance.tileValue, fontSize: 12 }}>{category.name}</Text>
                <Text style={{ color: finance.tileLabel, fontSize: 12 }}>
                  {amount(category.amount)}
                </Text>
              </View>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: finance.barTrack,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: 4,
                    // Clamped: a category can never overflow its own bar.
                    width: `${Math.round(Math.min(1, Math.max(0, category.amount / block.spending)) * 100)}%`,
                    backgroundColor: vt.extras.accentInk,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
      {!!block.transactionCount && (
        <Text
          style={{
            color: finance.footnote,
            fontSize: 10,
            paddingHorizontal: 16,
            paddingBottom: 16,
          }}
        >
          {t("Showing the first {count} of {total}", {
            count: block.transactions?.length ?? 0,
            total: block.transactionCount,
          })}
        </Text>
      )}
    </View>
  );
}
