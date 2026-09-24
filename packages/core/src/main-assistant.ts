/** The pinned root bot is the durable personal conversation for a space. */
export function mainAssistantBot<T extends {
  id: string;
  pinned: boolean;
  parentBotId?: string | null;
  archivedAt?: string | null;
  createdAt?: string;
}>(bots: readonly T[]): T | undefined {
  const roots = bots.filter((bot) => !bot.parentBotId && !bot.archivedAt);
  const candidates = roots.length ? roots : bots.filter((bot) => !bot.archivedAt);
  return [...candidates].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  })[0];
}

/** One workspace includes the main assistant and every bot delegated beneath it. */
export function assistantHierarchyIds(
  rootId: string,
  bots: readonly { id: string; parentBotId?: string | null }[],
): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const bot of bots) {
      if (!ids.has(bot.id) && bot.parentBotId && ids.has(bot.parentBotId)) {
        ids.add(bot.id);
        changed = true;
      }
    }
  }
  return ids;
}
