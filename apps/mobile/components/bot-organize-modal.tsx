import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { MobileBot, MobileBotSection } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useResolvedAppearance } from "../lib/native";
import { ActionSheet, SheetRow } from "./action-sheet";

export type BotOrganizationUpdate = { pinned?: boolean; sectionId?: string | null; notifyOnFinish?: boolean };

export function BotOrganizeModal({ bot, sections, onClose, onUpdate, onCreateSection }: {
  bot: Pick<MobileBot, "name" | "pinned" | "sectionId"> & Partial<Pick<MobileBot, "notifyOnFinish">>;
  sections: MobileBotSection[];
  onClose: () => void;
  onUpdate: (update: BotOrganizationUpdate) => Promise<void>;
  onCreateSection: (name: string) => Promise<void>;
}) {
  useResolvedAppearance();
  const theme = mobileTokens();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  async function save(request: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    setError(false);
    try { await request(); onClose(); }
    catch { setError(true); setSaving(false); }
  }
  return (
    <ActionSheet visible title={bot.name} onClose={onClose} actions={[
      { label: bot.pinned ? "Unpin chat" : "Pin chat", ios: bot.pinned ? "pin.slash" : "pin", android: "pin-outline", disabled: saving, onPress: () => void save(() => onUpdate({ pinned: !bot.pinned })) },
      ...(typeof bot.notifyOnFinish === "boolean" ? [{ label: bot.notifyOnFinish ? "Mute notifications" : "Unmute notifications", ios: bot.notifyOnFinish ? "bell.slash" : "bell", android: "notifications-outline" as const, disabled: saving, onPress: () => void save(() => onUpdate({ notifyOnFinish: !bot.notifyOnFinish })) }] : []),
    ]}>
      <View style={{ height: 1, backgroundColor: theme.hairline, marginHorizontal: 14, marginVertical: 10 }} />
      <Text style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 14, marginBottom: 6 }}>Move to</Text>
      {[{ id: null, name: "All chats" }, ...sections].map((section) => <SheetRow key={section.id ?? "unassigned"} label={section.name} ios="folder" android="folder-outline" selected={bot.sectionId === section.id} disabled={saving || bot.sectionId === section.id} onPress={() => void save(() => onUpdate({ sectionId: section.id }))} />)}
      {creating ? (
        <View style={{ padding: 12, gap: 12 }}>
          <TextInput autoFocus value={name} onChangeText={setName} maxLength={60} placeholder="Section name" placeholderTextColor={theme.muted} returnKeyType="done" onSubmitEditing={() => { if (name.trim()) void save(() => onCreateSection(name.trim())); }} style={{ color: theme.ink, backgroundColor: theme.surface2, borderRadius: 16, minHeight: 50, fontSize: 17, paddingHorizontal: 16 }} />
          <Pressable accessibilityRole="button" disabled={saving || !name.trim()} onPress={() => void save(() => onCreateSection(name.trim()))} style={{ backgroundColor: theme.ink, borderRadius: 24, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: !name.trim() ? 0.35 : 1 }}><Text style={{ color: theme.page, fontSize: 16, fontWeight: "600" }}>Create section</Text></Pressable>
        </View>
      ) : <SheetRow label="New section" ios="folder.badge.plus" android="add-circle-outline" disabled={saving} onPress={() => setCreating(true)} />}
      {saving ? <ActivityIndicator color={theme.ink} style={{ marginVertical: 10 }} /> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, padding: 14 }}>Couldn't save this change. Please try again.</Text> : null}
    </ActionSheet>
  );
}
