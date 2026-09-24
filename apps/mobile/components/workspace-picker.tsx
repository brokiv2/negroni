import { useRouter } from "expo-router";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatView } from "../lib/chat-view";
import { mobileTokens } from "../lib/appearance";
import { useResolvedAppearance } from "../lib/native";
import { NativeSymbol } from "./native-symbol";
import { SheetRow } from "./action-sheet";

export function WorkspacePicker({ visible, selected, assistantAvailable, assistantId, assistantName = "Negroni", onClose, onSelect, onOpenPersonalSection, onOpenConversation }: {
  visible: boolean;
  selected: ChatView;
  assistantAvailable: boolean;
  assistantId?: string;
  assistantName?: string;
  onClose: () => void;
  onSelect: (view: ChatView) => void;
  onOpenPersonalSection?: (section: "today" | "goals" | "ideas" | "activity" | "memory") => void;
  onOpenConversation?: () => void;
}) {
  const appearance = useResolvedAppearance();
  const theme = mobileTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const openPersonal = (section: "today" | "goals" | "ideas" | "activity" | "memory") => {
    if (!assistantId) return;
    onClose();
    if (onOpenPersonalSection) { onOpenPersonalSection(section); return; }
    router.push({ pathname: "/assistant-hub", params: { botId: assistantId, name: assistantName, section } });
  };
  return (
    <Modal transparent visible={visible} animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Close navigation" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View accessibilityViewIsModal style={{ width: Math.min(width - 46, 350), flex: 1, backgroundColor: appearance === "light" ? "#FAFAF9" : "#19191B", paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 18), paddingHorizontal: 16, borderTopRightRadius: 30, borderBottomRightRadius: 30 }}>
          <View style={styles.heading}>
            <Text style={{ fontSize: 26, fontWeight: "600", letterSpacing: -1, color: theme.ink }}>Negroni</Text>
            <Pressable accessibilityLabel="Close navigation" onPress={onClose} style={styles.close}><NativeSymbol ios="xmark" android="close" size={18} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 4 }}>
            <SheetRow label="Personal" detail="Your everyday assistant" ios="sparkles" android="sparkles-outline" selected={selected === "assistant"} disabled={!assistantAvailable} onPress={() => { onClose(); onSelect("assistant"); }} />
            <SheetRow label="Team" detail="Your agents and conversations" ios="person.2" android="people-outline" selected={selected === "team"} onPress={() => { onClose(); onSelect("team"); }} />
            {selected === "assistant" && assistantId ? <View style={{ marginTop: 26 }}>
              <SheetRow label="Conversation" ios="bubble.left" android="chatbubble-outline" onPress={() => { onClose(); onOpenConversation?.(); }} />
              <SheetRow label="For you" ios="square.grid.2x2" android="grid-outline" onPress={() => openPersonal("today")} />
              <SheetRow label="Goals" ios="scope" android="flag-outline" onPress={() => openPersonal("goals")} />
              <SheetRow label="Ideas" ios="lightbulb" android="bulb-outline" onPress={() => openPersonal("ideas")} />
              <SheetRow label="Activity" ios="waveform.path" android="pulse-outline" onPress={() => openPersonal("activity")} />
              <SheetRow label="Memory" ios="brain" android="albums-outline" onPress={() => openPersonal("memory")} />
              <SheetRow label="Voice" ios="waveform" android="mic-outline" onPress={() => { onClose(); router.push({ pathname: "/bot-settings", params: { botId: assistantId, section: "voice" } }); }} />
            </View> : null}
          </ScrollView>
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline, paddingTop: 10 }}>
            <SheetRow label="Integrations" ios="puzzlepiece.extension" android="extension-puzzle-outline" onPress={() => { onClose(); router.push("/integrations"); }} />
            <SheetRow label="Settings" ios="gearshape" android="settings-outline" onPress={() => { onClose(); router.push("/account"); }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.24)" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 30 },
  close: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
});
