import type { PersonalThread } from "@rakazo/contracts";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { VesperComputerScreen } from "../../components/vesper/computer/computer-screen";
import { colors } from "../../components/vesper/theme";
import { rpc } from "../../lib/api";

/**
 * Where the header's "Computer · take control" pill lands.
 *
 * A route rather than a sheet: the live desktop wants the whole window, and a
 * route keeps the back gesture doing the obvious thing. The shell passes the bot
 * id it already resolved; a cold start straight into this route resolves its own,
 * so a deep link does not land on a dead screen.
 */
export default function VesperComputer() {
  const router = useRouter();
  const { botId: param } = useLocalSearchParams<{ botId?: string }>();
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (param) return;
    const abort = new AbortController();
    void rpc<PersonalThread>("personal/thread", {}, { signal: abort.signal })
      .then((thread) => {
        if (!abort.signal.aborted) setResolved(thread.botId);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [param]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
      <VesperComputerScreen
        botId={param ?? resolved}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/(vesper)"))}
      />
    </SafeAreaView>
  );
}
