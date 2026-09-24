import { DarkTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { TabletShell } from "../components/tablet-shell";
import { AvatarStyleProvider } from "../components/avatar-style";
import { currentApiBase, loadApiBase, loadSessionToken, selectedSpaceId } from "../lib/api";
import { loadAppearancePreference, mobileTokens } from "../lib/appearance";
import {
  configureForegroundNotifications,
  resumeLiveNotifications,
} from "../lib/live-notifications";
import { native, useResolvedAppearance } from "../lib/native";
import { applyMobileUiDirection } from "../lib/ui-direction";

applyMobileUiDirection();
configureForegroundNotifications();

const lightTheme = {
  ...DarkTheme,
  dark: false,
  colors: {
    ...DarkTheme.colors,
    primary: "#1A1A1A",
    background: "#F4F4F2",
    card: "#F4F4F2",
    text: "#1A1A1A",
    border: "#D0D0CC",
    notification: "#2A9E86",
  },
};

export default function Layout() {
  const [ready, setReady] = useState(false);
  const resolved = useResolvedAppearance();
  const navigationTheme = useMemo(() => {
    const base = resolved === "light" ? lightTheme : DarkTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: String(native.page),
        card: String(native.page),
        text: mobileTokens().ink,
        border: "transparent",
        primary: mobileTokens().ink,
      },
    };
  }, [resolved]);

  useEffect(() => {
    void Promise.all([loadApiBase(), loadAppearancePreference()])
      .catch(() => undefined)
      .finally(() => {
        setReady(true);
        void loadSessionToken()
          .then((token) => resumeLiveNotifications(currentApiBase(), token, selectedSpaceId() ?? ""))
          .catch(() => undefined);
      });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        {ready ? (
          <AvatarStyleProvider>
            <ThemeProvider value={navigationTheme}>
              <StatusBar style={resolved === "light" ? "dark" : "light"} />
              <TabletShell>
                <Stack
                  screenOptions={{
                    headerStyle: { backgroundColor: String(native.page) },
                    headerTintColor: mobileTokens().ink,
                    headerShadowVisible: false,
                    headerBackButtonDisplayMode: "minimal",
                    contentStyle: { backgroundColor: String(native.page) },
                  }}
                >
                  <Stack.Screen name="index" options={{ headerShown: false, title: "Negroni" }} />
                  <Stack.Screen name="sign-in" options={{ headerShown: false }} />
                  <Stack.Screen name="account" options={{ title: "Account" }} />
                  <Stack.Screen name="models" options={{ title: "Models" }} />
                  <Stack.Screen name="voice" options={{ title: "Voice" }} />
                  <Stack.Screen
                    name="call"
                    options={{ title: "Voice call", presentation: "fullScreenModal" }}
                  />
                  <Stack.Screen name="integrations" options={{ title: "Integrations" }} />
                  <Stack.Screen
                    name="new"
                    options={{
                      title: "New bot",
                      presentation: "modal",
                      gestureEnabled: true,
                      headerBackVisible: false,
                    }}
                  />
                  <Stack.Screen
                    name="new-group"
                    options={{
                      title: "New group",
                      presentation: "modal",
                      gestureEnabled: true,
                    }}
                  />
                  <Stack.Screen
                    name="new-space"
                    options={{
                      title: "New space",
                      presentation: "modal",
                      gestureEnabled: true,
                      headerBackVisible: false,
                    }}
                  />
                  <Stack.Screen name="group-thread" options={{ title: "Group" }} />
                  <Stack.Screen name="group-settings" options={{ title: "Group settings" }} />
                  <Stack.Screen name="bot-settings" options={{ title: "Chat settings" }} />
                  <Stack.Screen name="thread" options={{ title: "Thread" }} />
                  <Stack.Screen name="assistant-hub" options={{ headerShown: false }} />
                  <Stack.Screen name="routine" options={{ title: "Routine" }} />
                  <Stack.Screen name="computer" options={{ title: "Computer" }} />
                </Stack>
              </TabletShell>
            </ThemeProvider>
          </AvatarStyleProvider>
        ) : (
          <View style={{ flex: 1, backgroundColor: String(native.page), paddingTop: 90, paddingHorizontal: 22, gap: 18 }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: String(native.fill) }} />
            <View style={{ width: "60%", height: 28, borderRadius: 14, backgroundColor: String(native.fill) }} />
            <View style={{ height: 48, borderRadius: 24, backgroundColor: String(native.fill) }} />
          </View>
        )}
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const appearance = useResolvedAppearance();
  const isLight = appearance === "light";
  return (
    <View
      style={{
        flex: 1,
        padding: 32,
        gap: 20,
        justifyContent: "center",
        backgroundColor: isLight ? "#F4F4F2" : "#141416",
      }}
    >
      <Text style={{ color: isLight ? "#1A1A1A" : "#ECECEE", fontSize: 22 }}>This screen could not open</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 16, alignSelf: "flex-start", borderRadius: 22, backgroundColor: isLight ? "#FFFFFF" : "#29292B" }}>
        <Text style={{ color: isLight ? "#1A1A1A" : "#ECECEE", fontSize: 17 }}>Try again</Text>
      </Pressable>
    </View>
  );
}
