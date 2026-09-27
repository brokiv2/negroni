import {
  Check,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { t } from "../../../lib/i18n";
import { VESPER_SECTIONS, type VesperSection, vesperSectionLabel } from "../../../lib/vesper/nav";
import { colors, s, shadow, vt } from "../theme";

const ICONS: Record<VesperSection, LucideIcon> = {
  chat: MessageCircle,
  activity: PanelsTopLeft,
  ideas: Lightbulb,
  goals: SquareCheck,
  apps: Shapes,
};

/** The floating white pill with the five destinations. */
export function VesperBottomNav({
  section,
  desktop,
  onNavigate,
}: {
  section: VesperSection;
  desktop: boolean;
  onNavigate: (next: VesperSection) => void;
}) {
  return (
    <View
      style={{
        paddingHorizontal: vt.space.navPaddingHorizontal,
        paddingTop: vt.space.navPaddingTop,
        paddingBottom: desktop ? vt.space.navPaddingBottomDesktop : vt.space.navPaddingBottom,
        alignItems: "center",
      }}
    >
      <View
        style={[
          {
            flexDirection: "row",
            width: "100%",
            maxWidth: vt.size.navPillMaxWidth,
            padding: 5,
            backgroundColor: colors.card,
            borderRadius: vt.radius.navPill,
            borderWidth: 1,
            borderColor: vt.extras.navBorder,
          },
          shadow("nav"),
        ]}
      >
        {VESPER_SECTIONS.map((item) => {
          const Icon = ICONS[item];
          const active = section === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityLabel={vesperSectionLabel(item)}
              accessibilityState={{ selected: active }}
              onPress={() => onNavigate(item)}
              style={{
                flex: 1,
                height: vt.size.navItemHeight,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: active ? vt.extras.navActive : "transparent",
                borderRadius: vt.radius.navItem,
              }}
            >
              <Icon size={23} strokeWidth={1.8} color={colors.text} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The dark confirmation pill that sits above the nav. */
export function VesperToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
    >
      <View
        style={[
          s.row,
          {
            gap: 10,
            padding: 14,
            backgroundColor: colors.text,
            borderRadius: vt.radius.toast,
            maxWidth: 560,
          },
        ]}
      >
        <Check size={16} color={colors.blue} />
        <Text style={{ color: colors.card, fontSize: 13, flexShrink: 1 }}>{message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Dismiss notification")}
          onPress={onDismiss}
        >
          <X size={16} color={colors.card} />
        </Pressable>
      </View>
    </View>
  );
}
