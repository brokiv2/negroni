import * as Notifications from "expo-notifications";
import { DarkTheme, type ErrorBoundaryProps, Stack, ThemeProvider, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AvatarStyleProvider } from "../components/avatar-style";
import { ComputerUpdateProgress } from "../components/computer-update-progress";
import { TabletShell } from "../components/tablet-shell";
import {
  currentApiBase,
  loadApiBase,
  loadSessionToken,
  selectedSpaceId,
  selectSpace,
} from "../lib/api";
import { loadAppearancePreference, mobileTokens } from "../lib/appearance";
import { bootstrapI18n, useI18n } from "../lib/i18n";
import {
  configureForegroundNotifications,
  resumeLiveNotifications,
} from "../lib/live-notifications";
import { native, useResolvedAppearance } from "../lib/native";
import { notificationDestination } from "../lib/notification-destination";
import { loadResponseStreamingPreference } from "../lib/response-streaming";
import { loadShellMode } from "../lib/shell-mode";

configureForegroundNotifications();

export default function Layout() {
  useEffect(() => {
    // The app is portrait-only; the computer screen unlocks rotation while it is open.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
      () => undefined,
    );
  }, []);
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const handled = new Set<string>();
    const open = async (response: Notifications.NotificationResponse) => {
      const request = response.notification.request;
      if (handled.has(request.identifier)) return;
      handled.add(request.identifier);
      const data = request.content.data ?? {};
      const destination = notificationDestination(data);
      if (!destination || !(await loadSessionToken())) return;
      if (typeof data.spaceId === "string" && !(await selectSpace(data.spaceId))) return;
      if (!active) return;
      router.push(destination);
      await Notifications.clearLastNotificationResponseAsync();
    };
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void open(response).catch(() => undefined);
    });
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => response && open(response))
      .catch(() => undefined);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, router]);
  const resolved = useResolvedAppearance();
  const navigationTheme = useMemo(() => {
    const tokens = mobileTokens();
    return {
      ...DarkTheme,
      dark: resolved === "dark",
      colors: {
        ...DarkTheme.colors,
        background: tokens.background,
        card: tokens.background,
        text: tokens.foreground,
        border: tokens.border,
        primary: tokens.primary,
        notification: tokens.foreground,
      },
    };
  }, [resolved]);

  useEffect(() => {
    void Promise.all([
      Promise.all([
        loadApiBase(),
        loadAppearancePreference(),
        loadResponseStreamingPreference(),
        loadShellMode(),
      ])
        .then(async () =>
          resumeLiveNotifications(
            currentApiBase(),
            await loadSessionToken(),
            selectedSpaceId() ?? "",
          ),
        )
        .catch(() => undefined),
      bootstrapI18n(),
    ]).finally(() => setReady(true));
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
                    headerStyle: { backgroundColor: navigationTheme.colors.background },
                    headerTintColor: navigationTheme.colors.text,
                    headerShadowVisible: false,
                    headerBackButtonDisplayMode: "minimal",
                    contentStyle: { backgroundColor: String(native.page) },
                  }}
                >
                  <Stack.Screen name="index" options={{ headerShown: false, title: "Negroni" }} />
                  {/* The Vesper shell. One binary, two shells; see lib/shell-mode.ts. */}
                  <Stack.Screen name="(vesper)" options={{ headerShown: false }} />
                  <Stack.Screen name="sign-in" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="integration-setup"
                    options={{ title: t("Server integrations") }}
                  />
                  <Stack.Screen name="ai-data-sharing" options={{ title: "AI data sharing" }} />
                  <Stack.Screen name="account" options={{ title: t("Account") }} />
                  <Stack.Screen
                    name="change-password"
                    options={{
                      title: t("Change password"),
                      presentation: "formSheet",
                      sheetAllowedDetents: [0.6, 1],
                      sheetGrabberVisible: true,
                    }}
                  />
                  <Stack.Screen name="models" options={{ title: t("Models") }} />
                  <Stack.Screen name="voice" options={{ title: t("Voice") }} />
                  <Stack.Screen
                    name="call"
                    options={{ title: t("Voice call"), presentation: "fullScreenModal" }}
                  />
                  <Stack.Screen name="integrations" options={{ title: t("Integrations") }} />
                  <Stack.Screen
                    name="new"
                    options={{
                      title: t("New bot"),
                      presentation: "modal",
                      gestureEnabled: true,
                      headerBackVisible: false,
                    }}
                  />
                  <Stack.Screen
                    name="new-group"
                    options={{
                      title: t("New group"),
                      presentation: "modal",
                      gestureEnabled: true,
                    }}
                  />
                  <Stack.Screen
                    name="new-space"
                    options={{
                      title: t("New space"),
                      presentation: "modal",
                      gestureEnabled: true,
                      headerBackVisible: false,
                    }}
                  />
                  <Stack.Screen name="group-thread" options={{ title: t("Group") }} />
                  <Stack.Screen name="group-settings" options={{ title: t("Group settings") }} />
                  <Stack.Screen name="bot-settings" options={{ title: t("Chat settings") }} />
                  <Stack.Screen name="thread" options={{ title: t("Thread") }} />
                  <Stack.Screen name="routine" options={{ title: t("Routine") }} />
                  <Stack.Screen name="computer" options={{ title: t("Computer") }} />
                </Stack>
              </TabletShell>
              <ComputerUpdateProgress />
            </ThemeProvider>
          </AvatarStyleProvider>
        ) : (
          <View style={{ flex: 1, backgroundColor: String(native.page) }} />
        )}
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const appearance = useResolvedAppearance();
  const tokens = mobileTokens();
  return (
    <View
      style={{
        flex: 1,
        padding: 32,
        gap: 20,
        justifyContent: "center",
        backgroundColor: appearance === "light" ? tokens.background : tokens.card,
      }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 22 }}>This screen could not open</Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{
          padding: 16,
          alignSelf: "flex-start",
          borderRadius: 22,
          backgroundColor: tokens.accent,
        }}
      >
        <Text style={{ color: tokens.foreground, fontSize: 17 }}>Try again</Text>
      </Pressable>
    </View>
  );
}
