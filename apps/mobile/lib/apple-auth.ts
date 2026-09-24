import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

export async function appleSignInAvailable(): Promise<boolean> {
  return Platform.OS === "ios" && AppleAuthentication.isAvailableAsync();
}

export async function requestAppleIdentity(): Promise<{ token: string; nonce: string } | null> {
  if (!(await appleSignInAvailable())) throw new Error("Apple ID is unavailable on this device");
  const random = await Crypto.getRandomBytesAsync(32);
  const nonce = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      ],
      nonce,
    });
    if (!credential.identityToken) throw new Error("Apple did not return an identity token");
    return { token: credential.identityToken, nonce };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_REQUEST_CANCELED") {
      return null;
    }
    throw error;
  }
}
