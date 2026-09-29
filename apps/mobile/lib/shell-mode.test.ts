import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

describe("shell mode", () => {
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

  it("defaults to the personal shell for anything unrecognized", async () => {
    const { normalizeShellMode } = await import("./shell-mode");
    expect(normalizeShellMode(null)).toBe("vesper");
    expect(normalizeShellMode("muse")).toBe("vesper");
    expect(normalizeShellMode("vesper")).toBe("vesper");
    expect(normalizeShellMode("negroni")).toBe("negroni");
  });

  it("reads the stored shell and reports it as loaded", async () => {
    const { getItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockResolvedValue("vesper");
    const { getCachedShellMode, isShellModeLoaded, loadShellMode } = await import("./shell-mode");

    expect(isShellModeLoaded()).toBe(false);
    expect(getCachedShellMode()).toBe("vesper");
    await expect(loadShellMode()).resolves.toBe("vesper");
    expect(isShellModeLoaded()).toBe(true);
    expect(getCachedShellMode()).toBe("vesper");
  });

  it("falls back to the personal shell when SecureStore throws", async () => {
    const { getItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockRejectedValue(new Error("no keychain"));
    const { getCachedShellMode, loadShellMode } = await import("./shell-mode");

    await expect(loadShellMode()).resolves.toBe("vesper");
    expect(getCachedShellMode()).toBe("vesper");
  });

  it("persists Vesper and clears the key when switching back", async () => {
    const { deleteItemAsync, setItemAsync } = await import("expo-secure-store");
    const { SHELL_MODE_KEY, setShellMode } = await import("./shell-mode");

    await setShellMode("vesper");
    expect(deleteItemAsync).toHaveBeenCalledWith(SHELL_MODE_KEY);

    await setShellMode("negroni");
    expect(setItemAsync).toHaveBeenCalledWith(SHELL_MODE_KEY, "negroni");
  });

  it("keeps the in-memory choice when the write fails", async () => {
    const { setItemAsync } = await import("expo-secure-store");
    vi.mocked(setItemAsync).mockRejectedValue(new Error("locked"));
    const { getCachedShellMode, setShellMode } = await import("./shell-mode");

    await expect(setShellMode("vesper")).resolves.toBe("vesper");
    expect(getCachedShellMode()).toBe("vesper");
  });

  it("notifies subscribers on load and on change", async () => {
    const { getItemAsync } = await import("expo-secure-store");
    vi.mocked(getItemAsync).mockResolvedValue(null);
    const { loadShellMode, setShellMode, subscribeShellMode } = await import("./shell-mode");

    const listener = vi.fn();
    const unsubscribe = subscribeShellMode(listener);
    await loadShellMode();
    expect(listener).toHaveBeenCalledTimes(1);
    await setShellMode("vesper");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await setShellMode("negroni");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
