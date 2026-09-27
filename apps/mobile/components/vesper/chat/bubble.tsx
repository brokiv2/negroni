import type { MessageBlock } from "@rakazo/contracts";
import { Text, View } from "react-native";
import type { MobileMessage } from "../../../lib/api";
import type { ArtifactImageTarget } from "../../../lib/vesper/artifact-image";
import { isBubbleBlock } from "../../../lib/vesper/blocks";
import { colors, s, vt } from "../theme";
import { VesperBlock } from "./blocks";

/**
 * One message. Prose sits in a rounded bubble — sky-blue and right-aligned from
 * the person, gray and left-aligned from the assistant — with the tail corner
 * tightened. Cards draw their own surface and sit outside it.
 */
export function MessageBubble({
  message,
  target,
  computerReachable,
  onAnswer,
  onOpenComputer,
}: {
  message: MobileMessage;
  target?: ArtifactImageTarget | null;
  computerReachable?: boolean;
  onAnswer?: (block: MessageBlock, answer: string) => void;
  onOpenComputer?: () => void;
}) {
  const user = message.role === "user";
  const bubbleBlocks = message.blocks.filter((block) => isBubbleBlock(block.kind));
  const standaloneBlocks = message.blocks.filter((block) => !isBubbleBlock(block.kind));
  if (!bubbleBlocks.length && !standaloneBlocks.length) return null;
  return (
    <View
      style={{
        alignSelf: user ? "flex-end" : "flex-start",
        maxWidth: user ? "85%" : "95%",
        width: standaloneBlocks.length ? "95%" : undefined,
        gap: 8,
      }}
    >
      {bubbleBlocks.length > 0 && (
        <View
          style={{
            paddingHorizontal: vt.space.bubblePaddingHorizontal,
            paddingVertical: vt.space.bubblePaddingVertical,
            borderRadius: vt.radius.bubble,
            borderBottomRightRadius: user ? vt.radius.bubbleTail : vt.radius.bubble,
            borderBottomLeftRadius: user ? vt.radius.bubble : vt.radius.bubbleTail,
            backgroundColor: user ? colors.blue : vt.extras.bubbleAssistant,
            gap: 6,
          }}
        >
          {bubbleBlocks.map((block, index) =>
            user && block.kind === "text" ? (
              // The person's own words never go through markdown.
              <Text key={`${message.id}:${index}`} selectable style={s.chatBody}>
                {block.text}
              </Text>
            ) : (
              <VesperBlock
                key={`${message.id}:${index}`}
                block={block}
                target={target}
                computerReachable={computerReachable}
                onAnswer={onAnswer}
                onOpenComputer={onOpenComputer}
              />
            ),
          )}
        </View>
      )}
      {standaloneBlocks.map((block, index) => (
        <VesperBlock
          key={`${message.id}:card:${index}`}
          block={block}
          target={target}
          computerReachable={computerReachable}
          onAnswer={onAnswer}
          onOpenComputer={onOpenComputer}
        />
      ))}
    </View>
  );
}

/** The three-dot "working" pill. */
export function TypingDots() {
  return (
    <View
      accessibilityLabel="working"
      style={[
        s.row,
        {
          alignSelf: "flex-start",
          gap: 7,
          paddingHorizontal: 19,
          paddingVertical: 18,
          backgroundColor: vt.extras.bubbleAssistant,
          borderRadius: 28,
        },
      ]}
    >
      {[0.4, 0.75, 0.5].map((opacity) => (
        <View
          key={opacity}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.muted,
            opacity,
          }}
        />
      ))}
    </View>
  );
}
