import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const CHAT_VIEW_KEY = "negroni.chat-view";

/** A SecureStore stand-in so the entry point is exercised against real persistence. */
async function useFakeStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const { getItemAsync, setItemAsync, deleteItemAsync } = await import("expo-secure-store");
  vi.mocked(getItemAsync).mockImplementation(async (key: string) => store.get(key) ?? null);
  vi.mocked(setItemAsync).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  vi.mocked(deleteItemAsync).mockImplementation(async (key: string) => {
    store.delete(key);
  });
  return store;
}

describe("Vesper entry point", () => {
  beforeEach(async () => {
    vi.resetModules();
    const store = await import("expo-secure-store");
    vi.mocked(store.getItemAsync).mockReset();
    vi.mocked(store.setItemAsync).mockReset();
    vi.mocked(store.deleteItemAsync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches the shell to Vesper and navigates into the route group", async () => {
    await useFakeStore();
    const { getCachedShellMode } = await import("./shell-mode");
    const { enterVesperShell, VESPER_ENTRY_ROUTE } = await import("./vesper-entry");

    const replace = vi.fn();
    await enterVesperShell(replace);

    expect(getCachedShellMode()).toBe("vesper");
    expect(replace).toHaveBeenCalledWith("/(vesper)");
    expect(VESPER_ENTRY_ROUTE).toBe("/(vesper)");
  });

  it("persists the shell so the next launch opens Vesper", async () => {
    const store = await useFakeStore();
    const { SHELL_MODE_KEY } = await import("./shell-mode");
    const { enterVesperShell } = await import("./vesper-entry");

    await enterVesperShell(vi.fn());
    expect(store.get(SHELL_MODE_KEY)).toBe("vesper");
  });

  it("navigates only after the shell is stored, so the redirect cannot race", async () => {
    await useFakeStore();
    const { SHELL_MODE_KEY } = await import("./shell-mode");
    const { setItemAsync } = await import("expo-secure-store");
    const { enterVesperShell } = await import("./vesper-entry");

    const writes: string[] = [];
    const previous = vi.mocked(setItemAsync).getMockImplementation();
    vi.mocked(setItemAsync).mockImplementation(async (key: string, value: string) => {
      writes.push(key);
      await previous?.(key, value);
    });

    await enterVesperShell(() => writes.push("navigate"));
    expect(writes).toEqual([CHAT_VIEW_KEY, SHELL_MODE_KEY, "navigate"]);
  });

  it("leaves no assistant chat view behind, so Switch to Negroni stays on Team", async () => {
    const store = await useFakeStore({ [CHAT_VIEW_KEY]: "assistant" });
    const { loadChatView } = await import("./chat-view");
    const { enterVesperShell } = await import("./vesper-entry");

    await enterVesperShell(vi.fn());

    expect(store.get(CHAT_VIEW_KEY)).toBe("team");
    await expect(loadChatView()).resolves.toBe("team");
  });

  it("still enters Vesper when the chat view cannot be written", async () => {
    await useFakeStore();
    const { setItemAsync } = await import("expo-secure-store");
    vi.mocked(setItemAsync).mockRejectedValue(new Error("locked"));
    const { getCachedShellMode } = await import("./shell-mode");
    const { enterVesperShell } = await import("./vesper-entry");

    const replace = vi.fn();
    await enterVesperShell(replace);

    expect(getCachedShellMode()).toBe("vesper");
    expect(replace).toHaveBeenCalledWith("/(vesper)");
  });

  it("clears a stale assistant chat view left by the old personal hub", async () => {
    const store = await useFakeStore({ [CHAT_VIEW_KEY]: "assistant" });
    const { clearLegacyAssistantChatView } = await import("./vesper-entry");

    await clearLegacyAssistantChatView();
    expect(store.get(CHAT_VIEW_KEY)).toBe("team");
  });

  it("does not rewrite a chat view that is already Team", async () => {
    await useFakeStore({ [CHAT_VIEW_KEY]: "team" });
    const { setItemAsync } = await import("expo-secure-store");
    const { clearLegacyAssistantChatView } = await import("./vesper-entry");

    await clearLegacyAssistantChatView();
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});
