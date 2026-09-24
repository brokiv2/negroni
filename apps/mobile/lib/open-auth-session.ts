import * as WebBrowser from "expo-web-browser";

/** In-app auth session that closes itself when the callback deep-links to `returnUrl`. */
export async function openConnectionAuthSession(url: string, returnUrl: string) {
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  return { type: result.type, url: result.type === "success" ? result.url : undefined };
}
