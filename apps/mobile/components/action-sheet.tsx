import type { ComponentProps, ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mobileTokens } from "../lib/appearance";
import { useResolvedAppearance } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

export type SheetAction = {
  label: string;
  detail?: string;
  ios: string;
  android: ComponentProps<typeof NativeSymbol>["android"];
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  destructive?: boolean;
};

export function ActionSheet({ visible, title, subtitle, actions = [], children, onClose, onDismiss }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions?: SheetAction[];
  children?: ReactNode;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const appearance = useResolvedAppearance();
  const theme = mobileTokens();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose} onDismiss={onDismiss} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <Pressable accessibilityLabel="Dismiss menu" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { maxHeight: height - insets.top - 32, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: appearance === "light" ? "#FFFFFF" : "#222224", borderColor: theme.hairline }]}>
          
          <View style={styles.heading}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={[styles.title, { color: theme.ink }]}>{title}</Text>
              {subtitle ? <Text style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={[styles.close, { backgroundColor: theme.surface2 }]}>
              <NativeSymbol ios="xmark" android="close" size={16} />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false} contentContainerStyle={styles.body}>
            {actions.map((action) => <SheetRow key={action.label} {...action} />)}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetRow(action: SheetAction) {
  useResolvedAppearance();
  const theme = mobileTokens();
  const ink = action.destructive ? theme.danger : theme.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: action.disabled, selected: action.selected }} disabled={action.disabled} onPress={action.onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed || action.selected ? theme.surface2 : "transparent", opacity: action.disabled && !action.selected ? 0.4 : 1 }]}>
      <View style={styles.icon}><NativeSymbol ios={action.ios} android={action.android} size={20} color={ink} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: ink, fontSize: 17, fontWeight: "500" }}>{action.label}</Text>
        {action.detail ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 3 }}>{action.detail}</Text> : null}
      </View>
      {action.selected ? <NativeSymbol ios="checkmark" android="checkmark" size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.28)" },
  sheet: { marginHorizontal: 10, borderRadius: 30, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", marginBottom: 8 },
  handle: { width: 32, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10 },
  heading: { flexDirection: "row", alignItems: "center", gap: 16, padding: 22, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 23, fontWeight: "600", letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 5 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 10, paddingBottom: 6 },
  row: { minHeight: 56, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 13 },
  icon: { width: 28, alignItems: "center" },
});
