import * as SecureStore from "expo-secure-store";

export type ChatView = "assistant" | "team";
const KEY = "negroni.chat-view";

export async function loadChatView(): Promise<ChatView> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === "assistant" ? "assistant" : "team";
  } catch {
    return "team";
  }
}

export async function saveChatView(view: ChatView): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, view);
  } catch {
    // Preference storage can be unavailable in a web preview.
  }
}
