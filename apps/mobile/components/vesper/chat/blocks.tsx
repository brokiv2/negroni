import { ChatMarkdown } from "@rakazo/chat-ui/native";
import type { MessageBlock } from "@rakazo/contracts";
import {
  CircleAlert,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Monitor,
  Plug,
  Users,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { t } from "../../../lib/i18n";
import type { ArtifactImageTarget } from "../../../lib/vesper/artifact-image";
import { vesperBlockRenderer } from "../../../lib/vesper/blocks";
import { Button } from "../kit";
import { colors, s, vt } from "../theme";
import { BrowserCard, FinanceCard, MailCard, PdfCard, PlanCard } from "./tool-cards";

/**
 * Generic block renderers.
 *
 * This is the dispatch point the richer tool-result cards slot into. When the
 * Browser / Mail / PDF / Plan / Finance block kinds land in `@rakazo/contracts`,
 * add the kind to `lib/vesper/blocks.ts` and a case to `VesperBlock` — nothing
 * else in the transcript has to change.
 */

function ToolCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        maxWidth: vt.size.toolCardMaxWidth,
        width: "100%",
        backgroundColor: vt.extras.surfaceToolCard,
        borderRadius: vt.radius.card,
        padding: 15,
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}

function CardHeader({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
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
        {icon}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.heading}>{title}</Text>
        {!!detail && (
          <Text numberOfLines={1} style={s.small}>
            {detail}
          </Text>
        )}
      </View>
    </View>
  );
}

function KeyValueCard({
  lines,
  title,
  subtitle,
}: {
  lines: { k: string; v: string }[];
  title?: string;
  subtitle?: string;
}) {
  return (
    <ToolCard>
      {/* Both are new and optional: a bare `lines` list must still lay out. */}
      {!!title && <Text style={s.heading}>{title}</Text>}
      {!!subtitle && <Text style={s.small}>{subtitle}</Text>}
      {lines.map((line) => (
        <View key={`${line.k}:${line.v}`} style={{ gap: 2 }}>
          <Text style={s.label}>{line.k}</Text>
          <Text style={s.text}>{line.v}</Text>
        </View>
      ))}
    </ToolCard>
  );
}

function StepsCard({
  steps,
  durationMs,
}: {
  steps: { label: string; count: number }[];
  durationMs?: number;
}) {
  return (
    <ToolCard>
      <CardHeader
        icon={<ListChecks size={18} color={colors.blueDark} />}
        title={t("Plan")}
        detail={
          durationMs
            ? t("{count} steps · {seconds}s", {
                count: steps.length,
                seconds: Math.round(durationMs / 1000),
              })
            : t("{count} steps", { count: steps.length })
        }
      />
      <View style={{ gap: 7 }}>
        {steps.map((step, index) => (
          <View key={`${index}:${step.label}`} style={[s.row, { gap: 9 }]}>
            <Text style={[s.small, { width: 18, color: vt.extras.listGlyph }]}>{index + 1}.</Text>
            <Text style={[s.text, { flex: 1 }]}>
              {step.count > 1 ? `${step.label} ×${step.count}` : step.label}
            </Text>
          </View>
        ))}
      </View>
    </ToolCard>
  );
}

function ProgressLine({
  text,
  pending,
  percent,
}: {
  text: string;
  pending?: string[];
  percent?: number;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.muted}>{text}</Text>
      {/* Absent percent means indeterminate: no bar sitting at zero. */}
      {percent !== undefined && (
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
              width: `${Math.round(Math.min(100, Math.max(0, percent)))}%`,
              backgroundColor: vt.extras.progressFill,
            }}
          />
        </View>
      )}
      {!!pending?.length && <Text style={s.small}>{pending.join(" · ")}</Text>}
    </View>
  );
}

function DelegationChip({ label }: { label: string }) {
  return (
    <View
      style={[
        s.row,
        {
          alignSelf: "flex-start",
          gap: 7,
          paddingHorizontal: 11,
          paddingVertical: 7,
          borderRadius: vt.radius.chip,
          backgroundColor: vt.extras.surfaceToolCard,
        },
      ]}
    >
      <Users size={13} color={colors.muted} />
      <Text style={s.small}>{label}</Text>
    </View>
  );
}

function delegationLabel(block: MessageBlock): string {
  switch (block.kind) {
    case "subagent":
      return block.name ? t("Worked with {name}", { name: block.name }) : t("Worked with a helper");
    case "child_bot":
      return t("Worked with {name}", { name: block.name });
    case "cloud_agent":
      return t("Worked with {name}", { name: block.title });
    case "handoff":
      return block.text || t("Handed over");
    case "channel_message":
      return `${block.fromLabel}: ${block.text}`;
    case "bot_message_sent":
      return t("Messaged {name}", { name: block.toBotName });
    case "bot_message_received":
      return t("Message from {name}", { name: block.fromBotName });
    default:
      return t("Worked with a helper");
  }
}

export function VesperBlock({
  block,
  target,
  computerReachable = false,
  onAnswer,
  onOpenComputer,
  onOpenArtifact,
  onOpenRun,
}: {
  block: MessageBlock;
  /** Whose artifacts to resolve card images against. */
  target?: ArtifactImageTarget | null;
  /** From `computer.status` — a card never asserts its own liveness. */
  computerReachable?: boolean;
  onAnswer?: (block: MessageBlock, answer: string) => void;
  onOpenComputer?: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenRun?: (runId: string) => void;
}) {
  switch (vesperBlockRenderer(block.kind)) {
    case "text":
      return "text" in block ? <ChatMarkdown appearance="light">{block.text}</ChatMarkdown> : null;
    case "meta":
      return "text" in block ? <Text style={s.small}>{block.text}</Text> : null;
    case "progress":
      return block.kind === "progress" ? (
        <ProgressLine text={block.text} pending={block.pendingToolNames} percent={block.percent} />
      ) : null;
    case "card":
      if (block.kind === "card") {
        return <KeyValueCard lines={block.lines} title={block.title} subtitle={block.subtitle} />;
      }
      if (block.kind === "skill_draft") {
        return (
          <ToolCard>
            <CardHeader
              icon={<ListChecks size={18} color={colors.blueDark} />}
              title={block.name}
              detail={block.goal}
            />
          </ToolCard>
        );
      }
      return null;
    case "steps":
      return block.kind === "steps" ? (
        <StepsCard steps={block.steps} durationMs={block.durationMs} />
      ) : null;
    case "ask":
      if (block.kind === "ask") {
        const answered = block.status === "answered";
        return (
          <View
            style={{
              backgroundColor: answered ? vt.extras.tintGreen : vt.extras.tintLavender,
              borderRadius: vt.radius.card,
              padding: vt.space.cardPadding,
              gap: 10,
              maxWidth: vt.size.toolCardMaxWidth,
              width: "100%",
            }}
          >
            <Text style={s.text}>{block.text}</Text>
            {!!block.detail && <Text style={s.muted}>{block.detail}</Text>}
            {answered ? (
              <Text style={s.small}>{block.answer}</Text>
            ) : (
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                {(block.actions ?? []).map((action) => (
                  <Button
                    key={action.id}
                    small
                    primary={action.outcome !== "cancelled"}
                    onPress={() => onAnswer?.(block, action.id)}
                  >
                    {action.label}
                  </Button>
                ))}
              </View>
            )}
          </View>
        );
      }
      if (block.kind === "choice") {
        return (
          <View
            style={{
              backgroundColor: vt.extras.tintLavender,
              borderRadius: vt.radius.card,
              padding: vt.space.cardPadding,
              gap: 10,
              maxWidth: vt.size.toolCardMaxWidth,
              width: "100%",
            }}
          >
            <Text style={s.text}>{block.question}</Text>
            {!!block.subtitle && <Text style={s.muted}>{block.subtitle}</Text>}
            <View style={{ gap: 7 }}>
              {block.options.map((option) => (
                <Button
                  key={option.id}
                  small
                  primary={block.answerId === option.id}
                  onPress={() => onAnswer?.(block, option.id)}
                >
                  {`${option.letter}. ${option.label}`}
                </Button>
              ))}
            </View>
          </View>
        );
      }
      if (block.kind === "mcp_approval") {
        return (
          <ToolCard>
            <CardHeader
              icon={<Plug size={18} color={colors.blueDark} />}
              title={block.name}
              detail={block.endpoint ?? undefined}
            />
          </ToolCard>
        );
      }
      return null;
    case "connect": {
      const name = block.kind === "app_connect" || block.kind === "connect" ? block.name : "";
      const connected =
        (block.kind === "app_connect" || block.kind === "connect") && block.status === "connected";
      return (
        <ToolCard>
          <CardHeader
            icon={<Plug size={18} color={colors.blueDark} />}
            title={name}
            detail={
              block.kind === "app_connect"
                ? block.description
                : connected
                  ? t("Connected")
                  : t("Needs authorization")
            }
          />
        </ToolCard>
      );
    }
    case "computer":
      return block.kind === "computer" ? (
        <ToolCard>
          <CardHeader
            icon={<Monitor size={18} color={colors.blueDark} />}
            title={t("Computer")}
            detail={block.text || block.state}
          />
          {!!onOpenComputer && (
            <Button small onPress={onOpenComputer}>
              {t("Take control")}
            </Button>
          )}
        </ToolCard>
      ) : null;
    case "image":
      return block.kind === "image" ? (
        <ToolCard>
          <CardHeader
            icon={<ImageIcon size={18} color={colors.blueDark} />}
            title={block.name}
            detail={block.mimeType}
          />
        </ToolCard>
      ) : null;
    case "file":
      return block.kind === "file" ? (
        <ToolCard>
          <CardHeader
            icon={<FileText size={18} color={colors.blueDark} />}
            title={block.name}
            detail={block.mimeType}
          />
        </ToolCard>
      ) : null;
    case "chart":
      return block.kind === "chart" ? (
        <ToolCard>
          <CardHeader
            icon={<ListChecks size={18} color={colors.blueDark} />}
            title={block.name}
            detail={t("{count} rows", { count: block.data.length })}
          />
        </ToolCard>
      ) : null;
    case "browser":
      return block.kind === "browser" ? (
        <BrowserCard
          block={block}
          target={target ?? null}
          computerReachable={computerReachable}
          onTakeControl={onOpenComputer ? () => onOpenComputer() : undefined}
        />
      ) : null;
    case "mail":
      return block.kind === "mail" ? <MailCard block={block} target={target ?? null} /> : null;
    case "pdf":
      return block.kind === "pdf" ? (
        <PdfCard block={block} target={target ?? null} onOpen={onOpenArtifact} />
      ) : null;
    case "plan":
      return block.kind === "plan" ? (
        <PlanCard block={block} target={target ?? null} onOpenRun={onOpenRun} />
      ) : null;
    case "finance":
      return block.kind === "finance" ? (
        <FinanceCard block={block} target={target ?? null} />
      ) : null;
    case "delegation":
      return <DelegationChip label={delegationLabel(block)} />;
    case "unknown":
      // A block kind newer than this build. Say so rather than dropping it.
      return (
        <View style={[s.row, { gap: 8 }]}>
          <CircleAlert size={14} color={colors.muted} />
          <Text style={s.small}>{t("This message needs a newer app to show.")}</Text>
        </View>
      );
  }
}
