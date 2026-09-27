import { vesperLight } from "@rakazo/ui-tokens";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

/**
 * The Vesper shell's routes. A flat Stack with its own chrome, matching the
 * Negroni convention — the two shells live in one Expo project and are switched
 * at the top level, not shipped as separate apps.
 */
export default function VesperLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: vesperLight.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Vesper" }} />
        <Stack.Screen name="computer" options={{ title: "Computer" }} />
      </Stack>
    </>
  );
}
