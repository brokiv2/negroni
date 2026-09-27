import { Bell, Menu, Monitor } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { t } from "../../../lib/i18n";
import {
  type ComputerPillState,
  computerPillLabel,
  computerPillOnline,
} from "../../../lib/vesper/computer-pill";
import { VesperAvatar, type VesperAvatarVariant } from "../avatar";
import { IconButton } from "../kit";
import { colors, s, vt } from "../theme";

/**
 * The header: menu on the left, the assistant's face with its name and one-line
 * status in the middle, notifications on the right, and — on chat only — the
 * computer pill underneath.
 */

export function ComputerPill({
  state,
  onPress,
}: {
  state: ComputerPillState;
  onPress: () => void;
}) {
  const online = computerPillOnline(state);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={computerPillLabel(state)}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          alignSelf: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: vt.radius.computerPill,
          backgroundColor: vt.extras.pillNeutral,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Monitor size={13} color={colors.muted} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{computerPillLabel(state)}</Text>
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: online ? vt.extras.statusOnline : vt.extras.statusOffline,
        }}
      />
    </Pressable>
  );
}

export function VesperHeader({
  name,
  status,
  avatar = "sky",
  desktop,
  unread,
  showComputerPill,
  computerState,
  onOpenMenu,
  onOpenNotifications,
  onOpenIdentity,
  onOpenComputer,
}: {
  name: string;
  status: string;
  avatar?: VesperAvatarVariant;
  desktop: boolean;
  unread: number;
  showComputerPill: boolean;
  computerState: ComputerPillState;
  onOpenMenu: () => void;
  onOpenNotifications: () => void;
  onOpenIdentity: () => void;
  onOpenComputer: () => void;
}) {
  return (
    <View
      style={{
        height: desktop ? vt.size.headerHeightDesktop : vt.size.headerHeight,
        paddingTop: desktop ? 14 : 2,
        marginHorizontal: 20,
      }}
    >
      <View style={{ position: "absolute", left: 0, top: 16 }}>
        <IconButton icon={Menu} label={t("Open conversations and menu")} onPress={onOpenMenu} />
      </View>
      <View style={{ alignItems: "center", gap: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Open {name} activity and approvals", { name })}
          onPress={onOpenIdentity}
          style={({ pressed }) => ({
            alignItems: "center",
            maxWidth: "70%",
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <VesperAvatar size={desktop ? 58 : 49} variant={avatar} />
          <Text style={[s.text, vt.type.headerName, { color: colors.text }]}>{name}</Text>
          <Text
            numberOfLines={1}
            style={{ ...vt.type.headerStatus, color: colors.muted, marginBottom: 6 }}
          >
            {status}
          </Text>
        </Pressable>
        {showComputerPill && <ComputerPill state={computerState} onPress={onOpenComputer} />}
      </View>
      <View style={{ position: "absolute", right: 0, top: 16 }}>
        <IconButton
          icon={Bell}
          label={t("Notifications, {count} unread or pending", { count: unread })}
          onPress={onOpenNotifications}
        >
          {unread > 0 && (
            <View
              pointerEvents="none"
              style={{
                width: 6,
                height: 6,
                borderRadius: 4,
                position: "absolute",
                top: 7,
                right: 9,
                backgroundColor: vt.extras.accentInk,
              }}
            />
          )}
        </IconButton>
      </View>
    </View>
  );
}
