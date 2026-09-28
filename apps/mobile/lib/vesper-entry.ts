import { loadChatView, saveChatView } from "./chat-view";
import { setShellMode } from "./shell-mode";

/** Where the Vesper route group starts. */
export const VESPER_ENTRY_ROUTE = "/(vesper)";

/**
 * Enter the Vesper shell.
 *
 * Vesper is a shell, not a chat view, so the stored `"assistant"` view is dropped
 * on the way in. Leaving it behind is what would make "Switch to Negroni" bounce:
 * Negroni would read the stale view and send the user straight back.
 */
export async function enterVesperShell(replace: (route: string) => void): Promise<void> {
  await saveChatView("team");
  await setShellMode("vesper");
  replace(VESPER_ENTRY_ROUTE);
}

/** Clear an `"assistant"` chat view persisted by the personal hub Vesper replaced. */
export async function clearLegacyAssistantChatView(): Promise<void> {
  if ((await loadChatView()) === "assistant") await saveChatView("team");
}
