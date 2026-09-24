import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { rpc } from "./api";

export async function registerPushToken() {
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) throw new Error("Notifications are disabled in iOS Settings.");

  if (Platform.OS === "ios") {
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    if (typeof deviceToken.data !== "string" || !deviceToken.data) {
      throw new Error("Apple did not return a push token for this device.");
    }
    await rpc("notifications/registerPush", {
      provider: "apns",
      token: deviceToken.data,
      environment: __DEV__ ? "development" : "production",
    });
    return;
  }

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Expo push project is not configured for this build.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!token) throw new Error("Expo did not return a push token for this device.");
  await rpc("notifications/registerPush", { provider: "expo", token });
}

export async function unregisterPushToken() {
  await rpc("notifications/unregisterPush").catch(() => undefined);
}
