import type { SpaceBot } from "@rakazo/contracts";
import { assistantHierarchyIds } from "@rakazo/core";
import { useRouter } from "expo-router";
import { Users } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { rpc } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Empty, LinkRow } from "./kit";
import { s } from "./theme";

export function AssistantTeamScreen({
  botId,
  refreshToken,
}: {
  botId: string | null;
  refreshToken: number;
}) {
  const router = useRouter();
  const [bots, setBots] = useState<SpaceBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void rpc<SpaceBot[]>("bots/list", {})
      .then((result) => {
        if (active) setBots(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);
  if (loading) return <ActivityIndicator />;
  if (error) return <Text style={s.muted}>{t("Could not load agents.")}</Text>;
  const ids = botId ? assistantHierarchyIds(botId, bots) : new Set<string>();
  const specialists = bots.filter((bot) => bot.id !== botId && ids.has(bot.id));
  return (
    <View style={{ gap: 12 }}>
      {specialists.map((bot) => (
        <LinkRow
          key={bot.id}
          icon={Users}
          title={bot.name}
          detail={bot.title}
          onPress={() => router.push({ pathname: "/thread", params: { botId: bot.id } })}
        />
      ))}
      {!specialists.length && (
        <Empty
          icon={Users}
          title={t("No specialists yet")}
          detail={t("Your assistant creates a team when a project needs one.")}
        />
      )}
    </View>
  );
}
