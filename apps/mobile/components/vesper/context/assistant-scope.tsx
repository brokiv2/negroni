import type { MemoryDocument, Routine, ScratchpadItem } from "@rakazo/contracts";
import { assistantHierarchyIds } from "@rakazo/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { type MobileBot, rpc } from "../../../lib/api";
import { t } from "../../../lib/i18n";

/**
 * The assistant's own scope: the main assistant bot and everything delegated
 * beneath it.
 *
 * `ScratchpadItem` and `Routine` are bot-scoped, not user-scoped, so a goal the
 * assistant filed against a specialist it spawned belongs to that specialist's
 * bot id. Goals, Ideas and Personal context therefore fan their reads over the
 * hierarchy the way the personal workspace already does, and write back to the
 * bot the row actually came from.
 *
 * There is no `scratchpad.*` event type and `routine.updated` is appended to the
 * bot's Team thread rather than the Personal one, so there is nothing to
 * subscribe to here. These hooks read on entry and after a mutation. They never
 * poll.
 */

export type AssistantScope = {
  /** The hierarchy's scratchpad rows: goals, ideas and finished goals together. */
  items: ScratchpadItem[];
  routines: Routine[];
  /** Bot ids in the hierarchy, root first. */
  hierarchy: string[];
  loading: boolean;
  /** Set when at least one read failed; what did load is still shown. */
  error: string | null;
  reload: () => Promise<void>;
  /** Apply one mutated row locally so a list does not flicker through a refetch. */
  applyItem: (item: ScratchpadItem) => void;
  dropItem: (itemId: string) => void;
  applyRoutine: (routine: Routine) => void;
  dropRoutine: (routineId: string) => void;
};

const PARTIAL = () => t("Some of this could not be loaded.");

async function resolveHierarchy(botId: string, signal: AbortSignal): Promise<string[]> {
  const bots = await rpc<MobileBot[]>("bots/list", {}, { signal }).catch(() => null);
  if (!bots) return [botId];
  const ids = assistantHierarchyIds(botId, bots);
  return [botId, ...[...ids].filter((id) => id !== botId)];
}

export function useAssistantScope(botId: string | null): AssistantScope {
  const [items, setItems] = useState<ScratchpadItem[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [hierarchy, setHierarchy] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    request.current?.abort();
    if (!botId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const signal = controller.signal;
    setLoading(true);
    try {
      const ids = await resolveHierarchy(botId, signal);
      if (signal.aborted) return;
      setHierarchy(ids);
      const [scratchpad, schedules] = await Promise.all([
        Promise.allSettled(
          ids.map((id) =>
            rpc<ScratchpadItem[]>("scratchpad/list", { botId: id, includeDone: true }, { signal }),
          ),
        ),
        Promise.allSettled(
          ids.map((id) => rpc<Routine[]>("routines/list", { botId: id }, { signal })),
        ),
      ]);
      if (signal.aborted) return;
      setItems(scratchpad.flatMap((result) => (result.status === "fulfilled" ? result.value : [])));
      setRoutines(
        schedules.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
      );
      const incomplete = [...scratchpad, ...schedules].some(
        (result) => result.status === "rejected",
      );
      setError(incomplete ? PARTIAL() : null);
    } catch (failure) {
      if (!signal.aborted) setError((failure as Error).message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);

  const applyItem = useCallback((item: ScratchpadItem) => {
    setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
  }, []);
  const dropItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((entry) => entry.id !== itemId));
  }, []);
  const applyRoutine = useCallback((routine: Routine) => {
    setRoutines((current) => [routine, ...current.filter((entry) => entry.id !== routine.id)]);
  }, []);
  const dropRoutine = useCallback((routineId: string) => {
    setRoutines((current) => current.filter((entry) => entry.id !== routineId));
  }, []);

  return {
    items,
    routines,
    hierarchy,
    loading,
    error,
    reload,
    applyItem,
    dropItem,
    applyRoutine,
    dropRoutine,
  };
}

export type AssistantMemory = {
  documents: MemoryDocument[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Replace one document after `memory.update` returns its new revision. */
  applyDocument: (document: MemoryDocument) => void;
};

/**
 * The memory documents for this assistant: what is true of the person (`user`
 * scope) and what this bot has learned (`bot` scope).
 */
export function useAssistantMemory(botId: string | null): AssistantMemory {
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    request.current?.abort();
    if (!botId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const signal = controller.signal;
    setLoading(true);
    const [user, bot] = await Promise.allSettled([
      rpc<MemoryDocument[]>("memory/list", { scope: "user" }, { signal }),
      rpc<MemoryDocument[]>("memory/list", { botId }, { signal }),
    ]);
    if (signal.aborted) return;
    setDocuments([
      ...(user.status === "fulfilled" ? user.value : []),
      ...(bot.status === "fulfilled" ? bot.value : []),
    ]);
    setError(
      user.status === "rejected" && bot.status === "rejected"
        ? (user.reason as Error).message
        : user.status === "rejected" || bot.status === "rejected"
          ? PARTIAL()
          : null,
    );
    setLoading(false);
  }, [botId]);

  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);

  const applyDocument = useCallback((document: MemoryDocument) => {
    setDocuments((current) =>
      current.map((entry) => (entry.id === document.id ? document : entry)),
    );
  }, []);

  return { documents, loading, error, reload, applyDocument };
}

/**
 * The assistant's own name, for the shell header.
 *
 * Renaming happens on a pushed screen, so this re-reads when the shell regains
 * focus rather than on a timer. `Bot.name` is the same row Negroni renames, so
 * the two shells never disagree about what the assistant is called.
 */
export function useAssistantName(botId: string | null, fallback: string): string {
  const [name, setName] = useState(fallback);

  useFocusEffect(
    useCallback(() => {
      if (!botId) {
        setName(fallback);
        return;
      }
      const abort = new AbortController();
      void rpc<{ name: string }>("bots/get", { botId }, { signal: abort.signal })
        .then((bot) => {
          if (!abort.signal.aborted) setName(bot.name.trim() || fallback);
        })
        .catch(() => undefined);
      return () => abort.abort();
    }, [botId, fallback]),
  );

  return name;
}
