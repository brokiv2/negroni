import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { AppState, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type MobileBot, type MobileGroup, rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useResolvedAppearance } from "../lib/native";

export function TabletShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { view } = useGlobalSearchParams<{ view?: string }>();
  const wide = width >= 768 && view !== "assistant" && !["/", "/sign-in", "/call", "/assistant-hub"].includes(pathname);
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {wide ? <TabletSidebar /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

function TabletSidebar() {
  useResolvedAppearance();
  const tokens = mobileTokens();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [chats, setChats] = useState<
    Array<{ id: string; name: string; preview: string | null; group: boolean }>
  >([]);
  const params = useGlobalSearchParams<{ botId?: string; groupId?: string }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      void Promise.all([
        rpc<MobileBot[]>("bots/list", {}, { signal: controller.signal }),
        rpc<MobileGroup[]>("groups/list", {}, { signal: controller.signal }),
      ])
        .then((next) => {
          if (!controller.signal.aborted) {
            setChats([
              ...next[0]
                .filter((bot) => !bot.archivedAt)
                .map((bot) => ({ id: bot.id, name: bot.name, preview: bot.preview, group: false })),
              ...next[1]
                .filter((group) => !group.archivedAt)
                .map((group) => ({
                  id: group.id,
                  name: group.name,
                  preview: group.preview,
                  group: true,
                })),
            ]);
            setError(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    };
    load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
    });
    return () => {
      controller.abort();
      subscription.remove();
    };
  }, [pathname]);
  return (
    <View
      style={{
        width: 300,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom,
        backgroundColor: tokens.page,
        borderRightWidth: 1,
        borderRightColor: tokens.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace("/")}
        style={{ padding: 20 }}
      >
        <Text style={{ color: tokens.ink, fontSize: 23, fontWeight: "600" }}>Negroni</Text>
        <Text style={{ color: tokens.muted, marginTop: 8 }}>All chats</Text>
      </Pressable>
      {error ? (
        <Text style={{ color: tokens.muted, padding: 20 }}>Could not refresh chats</Text>
      ) : null}
      <FlatList
        data={chats}
        keyExtractor={(chat) => `${chat.group ? "group" : "bot"}:${chat.id}`}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              item.group
                ? router.replace({
                    pathname: "/group-thread",
                    params: { groupId: item.id, name: item.name },
                  })
                : router.replace({
                    pathname: "/thread",
                    params: { botId: item.id, name: item.name },
                  })
            }
            accessibilityState={{
              selected: item.id === (item.group ? params.groupId : params.botId),
            }}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              backgroundColor:
                item.id === (item.group ? params.groupId : params.botId)
                  ? tokens.surface2
                  : "transparent",
            }}
          >
            <Text numberOfLines={1} style={{ color: tokens.ink, fontSize: 17 }}>
              {item.name}
            </Text>
            <Text numberOfLines={2} style={{ color: tokens.muted, marginTop: 6 }}>
              {item.preview}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
