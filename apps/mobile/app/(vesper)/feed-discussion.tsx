import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VesperChatScreen } from "../../components/vesper/chat/chat-screen";
import { Button } from "../../components/vesper/kit";
import { colors, s } from "../../components/vesper/theme";
export default function FeedDiscussionRoute() {
  const { itemId, botId, title } = useLocalSearchParams<{
    itemId: string;
    botId: string;
    title: string;
  }>();
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: 16, gap: 12 }}>
        <Button onPress={() => router.back()}>Back</Button>
        <Text numberOfLines={2} style={s.text}>
          {title}
        </Text>
      </View>
      <VesperChatScreen
        key={itemId}
        botId={botId}
        feedItemId={itemId}
        desktop={false}
        onBotResolved={() => {}}
        computerReachable={false}
        onOpenComputer={() => router.push({ pathname: "/(vesper)/computer", params: { botId } })}
      />
    </SafeAreaView>
  );
}
