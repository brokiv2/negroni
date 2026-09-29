import { type Brand, isBrand } from "@rakazo/ui-tokens";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/**
 * Which shell the app opens in. Negroni and Vesper are two shells inside one
 * binary — one Expo project, one bundle id — switched here rather than shipped
 * as separate apps.
 */
export type ShellMode = Brand;

export const SHELL_MODE_KEY = "rakazo.shell_mode";

export const DEFAULT_SHELL_MODE: ShellMode = "vesper";

export function normalizeShellMode(raw: string | null | undefined): ShellMode {
  return isBrand(raw) ? raw : DEFAULT_SHELL_MODE;
}

let memoryMode: ShellMode | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeShellMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Synchronous read for render paths; `loadShellMode` fills it at boot. */
export function getCachedShellMode(): ShellMode {
  return memoryMode ?? DEFAULT_SHELL_MODE;
}

/** True once the stored value has been read, so a boot render can wait for it. */
export function isShellModeLoaded(): boolean {
  return memoryMode !== null;
}

export async function loadShellMode(): Promise<ShellMode> {
  try {
    memoryMode = normalizeShellMode(await SecureStore.getItemAsync(SHELL_MODE_KEY));
  } catch {
    memoryMode = memoryMode ?? DEFAULT_SHELL_MODE;
  }
  notify();
  return memoryMode;
}

export async function setShellMode(mode: ShellMode): Promise<ShellMode> {
  memoryMode = mode;
  try {
    if (mode === DEFAULT_SHELL_MODE) await SecureStore.deleteItemAsync(SHELL_MODE_KEY);
    else await SecureStore.setItemAsync(SHELL_MODE_KEY, mode);
  } catch {
    // Keep the in-memory choice when SecureStore is unavailable.
  }
  notify();
  return mode;
}

/** Which shell to render. Re-renders when the choice changes. */
export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribeShellMode, getCachedShellMode, () => DEFAULT_SHELL_MODE);
}

/** Test-only: drop the cached value without touching storage. */
export function resetShellModeForTests(mode: ShellMode | null = null): void {
  memoryMode = mode;
  notify();
}
