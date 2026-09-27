import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../../../lib/i18n";
import { IconButton } from "../kit";
import { colors, s, vt } from "../theme";

/**
 * A pushed Vesper screen: the shell's canvas and content column, a back button,
 * and a section title in the same 25px the sections use.
 *
 * Screens Vesper hands over to Negroni (Models, Voice, Connections, Account)
 * do not use this — they keep Negroni's own chrome, which is the point of
 * routing to them instead of rebuilding them.
 */
export function VesperScreenFrame({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= vt.size.desktopBreakpoint;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
      <View
        style={{ flex: 1, width: "100%", maxWidth: vt.size.contentMaxWidth, alignSelf: "center" }}
      >
        <View
          style={[
            s.row,
            {
              gap: 8,
              paddingHorizontal: desktop
                ? vt.space.screenPaddingHorizontalDesktop - 10
                : vt.space.screenPaddingHorizontal - 10,
              paddingVertical: 8,
            },
          ]}
        >
          <IconButton icon={ChevronLeft} label={t("Back")} onPress={() => router.back()} />
          <Text style={s.heading}>{title}</Text>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: desktop
              ? vt.space.screenPaddingHorizontalDesktop
              : vt.space.screenPaddingHorizontal,
            paddingBottom: 40,
            paddingTop: 8,
          }}
        >
          {children}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
