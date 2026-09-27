import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { VesperComputerScreen } from "../../components/vesper/computer/computer-screen";
import { colors } from "../../components/vesper/theme";

/**
 * Where the header's "Computer · take control" pill lands.
 *
 * A route rather than a sheet: the live desktop wants the whole window, and a
 * route keeps the back gesture doing the obvious thing.
 */
export default function VesperComputer() {
  const router = useRouter();
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
      <VesperComputerScreen
        botId={botId ?? null}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/(vesper)"))}
      />
    </SafeAreaView>
  );
}
