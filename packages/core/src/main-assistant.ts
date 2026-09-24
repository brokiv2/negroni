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

export type ThreadKindValue = "team" | "personal";
export type RunInteractionMode = "chat" | "voice" | "personal";

/** A run started in the Personal thread is the assistant's own conversation; a call stays voice. */
export function runInteractionModeFor(input: {
  requested?: "chat" | "voice" | null;
  threadKind?: ThreadKindValue | null;
}): RunInteractionMode {
  if (input.requested === "voice") return "voice";
  return input.threadKind === "personal" ? "personal" : "chat";
}

export const PERSONAL_ASSISTANT_INSTRUCTION =
  "This is the user's Personal conversation with you, their main assistant, and you own it end to end. Answer directly when you can. When a task needs a specialist, decide yourself: send one clear request to a relevant teammate with message_bot, create a lasting specialist with spawn_bot only when the user will need it again, or use run_subagent for short parallel work inside this turn. Replies from teammates come back to you here. Tell the user the outcome in your own words: what happened, what matters, what is next. Never ask the user to open or read another bot's chat, and never paste raw peer messages, tool names, run IDs or routing details. Ask the user a question only when a decision or an approval is genuinely needed; otherwise make a sensible choice and say what you chose.";

export const MAIN_ASSISTANT_INSTRUCTION =
  "You are the user's main assistant in a persistent conversation. Answer directly when you can. For a distinct specialist task, send one clear request to an existing relevant teammate or use a short subagent. Keep ownership of the user's request, report meaningful progress in this conversation, and summarize the specialist's result here. Never ask the user to move to another bot chat just to finish this request. Do not surface tool names, run IDs, routing metadata, or raw peer messages in your answer.";

/** Role prompt for a run: Personal owner, Team main assistant, delegated specialist, or none. */
export function coordinationInstructionFor(input: {
  interactionMode: string;
  inGroup: boolean;
  isMainAssistant: boolean;
  parentBotId: string | null;
}): string | undefined {
  if (input.inGroup) return undefined;
  if (input.interactionMode === "personal") return PERSONAL_ASSISTANT_INSTRUCTION;
  if (input.isMainAssistant) return MAIN_ASSISTANT_INSTRUCTION;
  if (input.parentBotId) {
    return `You are a specialist in the user's agent team. Your parent bot id is ${input.parentBotId}. Complete delegated work in your own context, then return a concise result with evidence to the requester. Do not redirect the user between chats.`;
  }
  return undefined;
}

export type PersonalTab = "for-you" | "goals" | "ideas" | "activity" | "memory";

/** One line per Personal tab, shown when the tab is empty: what the tab is for. */
export function personalTabExplainer(tab: PersonalTab, assistantName: string): string {
  const name = assistantName.trim() || "Your assistant";
  switch (tab) {
    case "for-you":
      return `Decisions, progress and results from ${name} show up here.`;
    case "goals":
      return `Outcomes you want. ${name} tracks them and reports progress.`;
    case "ideas":
      return `Suggestions from ${name}, and ideas you park for later.`;
    case "activity":
      return `What ${name} got done, day by day.`;
    case "memory":
      return `What ${name} knows about you. Edit anything that's off.`;
  }
}
