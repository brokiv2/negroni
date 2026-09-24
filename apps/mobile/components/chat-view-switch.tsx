import type { ChatView } from "../lib/chat-view";
import { Pressable, Text, View } from "react-native";
import { GlassSurface } from "./glass-surface";
import { useResolvedAppearance } from "../lib/native";

export function ChatViewSwitch({
  value,
  onChange,
}: {
  value: ChatView;
  onChange: (view: ChatView) => void;
}) {
  const appearance = useResolvedAppearance();
  return (
    <GlassSurface
      appearance={appearance}
      style={{
        flexDirection: "row",
        alignSelf: "center",
        borderRadius: 24,
        padding: 3,
        minHeight: 46,
      }}
      fallbackStyle={{
        backgroundColor: appearance === "light" ? "rgba(255,255,255,0.88)" : "rgba(38,38,40,0.9)",
        borderWidth: 1,
        borderColor: appearance === "light" ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.12)",
      }}
    >
      {(["assistant", "team"] as const).map((view) => (
        <Pressable
          key={view}
          accessibilityRole="button"
          accessibilityLabel={view === "assistant" ? "Assistant view" : "Team view"}
          accessibilityState={{ selected: value === view }}
          onPress={() => onChange(view)}
          style={{
            minWidth: 118,
            minHeight: 40,
            paddingHorizontal: 17,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 21,
            backgroundColor:
              value === view
                ? appearance === "light" ? "#181818" : "#F4F4F2"
                : "transparent",
          }}
        >
          <Text style={{
            fontSize: 14,
            fontWeight: value === view ? "600" : "500",
            color: value === view
              ? appearance === "light" ? "#FFFFFF" : "#181818"
              : appearance === "light" ? "#555555" : "#C8C8CC",
          }}>
            {view === "assistant" ? "Assistant" : "Team"}
          </Text>
        </Pressable>
      ))}
    </GlassSurface>
  );
}
