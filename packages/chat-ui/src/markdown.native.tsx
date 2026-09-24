import Markdown, {
  MarkdownStream,
  type RenderRules,
} from "@ronradtke/react-native-markdown-display";
import { memo } from "react";
import { Linking, StyleSheet, Text, useColorScheme, View } from "react-native";
import type { ChatMarkdownProps } from "./markdown";
import { sanitizeMarkdownUrl } from "./markdown";

function createStyles(colors: {
  text: string;
  strong: string;
  link: string;
  codeText: string;
  codeBackground: string;
  codeBorder: string;
  quoteBorder: string;
}) {
  return StyleSheet.create({
    body: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 25,
      width: "100%",
      minWidth: 0,
      flexShrink: 1,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 9,
      width: "100%",
      flexShrink: 1,
    },
    heading1: {
      color: colors.strong,
      fontSize: 21,
      lineHeight: 27,
      marginTop: 10,
      marginBottom: 5,
    },
    heading2: {
      color: colors.strong,
      fontSize: 19,
      lineHeight: 25,
      marginTop: 10,
      marginBottom: 5,
    },
    heading3: {
      color: colors.strong,
      fontSize: 17,
      lineHeight: 23,
      marginTop: 8,
      marginBottom: 4,
    },
    strong: {
      color: colors.strong,
      fontWeight: "700",
    },
    link: {
      color: colors.link,
      textDecorationLine: "underline",
      marginBottom: 0,
    },
    code_inline: {
      color: colors.codeText,
      backgroundColor: colors.codeBackground,
      borderColor: colors.codeBorder,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 0,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
    },
    code_block: {
      color: colors.codeText,
      backgroundColor: colors.codeBackground,
      borderColor: colors.codeBorder,
    },
    fence: {
      backgroundColor: colors.codeBackground,
      borderColor: colors.codeBorder,
    },
    fence_code: {
      backgroundColor: colors.codeBackground,
    },
    blockquote: {
      backgroundColor: "transparent",
      borderLeftColor: colors.quoteBorder,
    },
    table: {
      borderColor: colors.codeBorder,
    },
    tr: {
      borderColor: colors.codeBorder,
    },
    hr: {
      backgroundColor: colors.codeBorder,
    },
    bullet_list_content: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    ordered_list_content: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
  });
}

const darkStyles = createStyles({
  text: "#DFDFE2",
  strong: "#F3F3F4",
  link: "#86B7FF",
  codeText: "#ECECEE",
  codeBackground: "#0E0E10",
  codeBorder: "#34343A",
  quoteBorder: "#55555C",
});

const lightStyles = createStyles({
  text: "#29292D",
  strong: "#151515",
  link: "#165CC0",
  codeText: "#222226",
  codeBackground: "#F5F5F2",
  codeBorder: "#D2D2CE",
  quoteBorder: "#A0A09B",
});

async function openSafeLink(url: string) {
  const safeUrl = sanitizeMarkdownUrl(url);
  if (!safeUrl) return;
  if (await Linking.canOpenURL(safeUrl)) await Linking.openURL(safeUrl);
}

// Keep links as Text so they stay inside textgroup; Pressable (a View) is laid out
// outside the text flow and collapses the bubble height, overlapping later messages.
const renderRules: RenderRules = {
  link: (node, children, _parent, styleMap) => (
    <Text
      accessibilityRole="link"
      key={node.key}
      style={styleMap.link}
      onPress={() => {
        void openSafeLink(node.attributes.href ?? "");
      }}
    >
      {children}
    </Text>
  ),
};

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
  appearance,
}: ChatMarkdownProps) {
  const systemColorScheme = useColorScheme();
  const colorScheme = appearance ?? (systemColorScheme === "light" ? "light" : "dark");
  const sharedProps = {
    colorScheme,
    style: colorScheme === "light" ? lightStyles : darkStyles,
    rules: renderRules,
    allowedImageHandlers: ["https://", "http://"],
    onLinkPress: (url: string) => {
      void openSafeLink(url);
      return false;
    },
  };

  return (
    <View style={layout.wrap}>
      {streaming ? (
        <MarkdownStream
          {...sharedProps}
          cursorColor={colorScheme === "light" ? "#6C6C70" : "#85858A"}
          streaming
        >
          {children}
        </MarkdownStream>
      ) : (
        <Markdown {...sharedProps}>{children}</Markdown>
      )}
    </View>
  );
});

const layout = StyleSheet.create({
  wrap: {
    width: "100%",
    minWidth: 0,
    flexShrink: 1,
  },
});

export type { ChatMarkdownProps } from "./markdown";
