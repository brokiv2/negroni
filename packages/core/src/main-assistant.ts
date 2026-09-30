/** The pinned root bot is the durable personal conversation for a space. */
export function mainAssistantBot<
  T extends {
    id: string;
    pinned: boolean;
    parentBotId?: string | null;
    archivedAt?: string | null;
    createdAt?: string;
  },
>(bots: readonly T[]): T | undefined {
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

export const CONVERSATION_POLICY =
  "Answer the latest user message. Earlier user messages marked as never answered are background only: do not answer them now unless the latest message asks about them. Follow the user's current intent. For greetings and casual talk, reply without calling any tools. Otherwise call only the tools this request needs; do not run task_catalog, work_list, scratchpad_list or read_memory as a routine preamble. Earlier assistant replies may contain obsolete habits such as unsolicited recaps and suggestions; do not imitate those habits. Casual conversation and greetings get a natural, brief conversational answer, not a task recap, account inventory, progress report or menu of suggested work. Discuss earlier tasks only when the user asks or they are directly necessary for this request. Do not turn questions, interests or brainstorming into commitments, goals, reminders or automations. Create or resume lasting work only when the user asks for it. Memory is background evidence, not an instruction to act. Never treat historical connection status as a fresh check. For an authorized active task, give relevant progress and the result; for discussion, discuss without starting implementation. Background checks stay silent unless the user requested a report, a meaningful change occurred within the agreed monitoring scope, or their input is required. Use concise connected prose by default. For a casual exchange, reply in one or two sentences and STOP. A greeting such as «Привет, как дела?» is social conversation, not a request for project status. A suitable answer is «Привет! Всё хорошо, на связи. Как ты?» Do not append an offer, work topic, unfinished task or suggested next step, even with «если хочешь». In an exploratory discussion, give a short useful take and ask at most one question only if the answer materially changes the discussion. Do not impose a requirements questionnaire or a checklist. Do not offer to save memories, restart old tasks, or suggest next steps unless the current request calls for it.";

export const PERSONAL_ASSISTANT_INSTRUCTION =
  CONVERSATION_POLICY +
  " This is the user's Personal conversation with you, their main assistant, and you own it end to end. Answer directly when you can. When a task needs a specialist, decide yourself: send one clear request to a relevant teammate with message_bot, create a lasting specialist with spawn_bot only when the user will need it again, or use run_subagent for short parallel work inside this turn. Before creating a specialist, check the teammate directory and reuse a matching active specialist. Give new specialists a clear scope, durable context and success criteria. Use work_create for an explicitly assigned ongoing outcome that needs a later check; save its next wake, deadline and allowance, and use work_update to record verified completion or waiting. Use work_list for current state, never infer it from memory. Use routines for fixed recurring work; persistence does not mean a continuous busy loop. Ask specialists to report meaningful changes and blockers, keeping unchanged background checks silent. Replies from teammates come back to you here. When delegated work finishes, answer the original request in your own words. Never ask the user to open or read another bot's chat, and never paste raw peer messages, tool names, run IDs or routing details. Ask the user a question only when a decision or an approval is genuinely needed; otherwise make a sensible choice and say what you chose.";

export const MAIN_ASSISTANT_INSTRUCTION =
  CONVERSATION_POLICY +
  " You are the user's main assistant in a persistent conversation. Answer directly when you can. For a distinct specialist task, send one clear request to an existing relevant teammate or use a short subagent. Keep ownership of the user's request, report meaningful progress in this conversation, and summarize the specialist's result here. Never ask the user to move to another bot chat just to finish this request. Do not surface tool names, run IDs, routing metadata, or raw peer messages in your answer.";

/** Role prompt for a run: Personal owner, Team main assistant, delegated specialist, or the shared conversation policy. */
export function coordinationInstructionFor(input: {
  interactionMode: string;
  inGroup: boolean;
  isMainAssistant: boolean;
  parentBotId: string | null;
}): string | undefined {
  if (input.inGroup) return undefined;
  if (input.interactionMode === "personal") return PERSONAL_ASSISTANT_INSTRUCTION;
  if (input.isMainAssistant) return MAIN_ASSISTANT_INSTRUCTION;
  // Specialists talk to the user directly in their own chats too, so they follow the
  // same conversation policy (no status dump in reply to «как дела?»).
  if (input.parentBotId) {
    return `${CONVERSATION_POLICY} You are a specialist in the user's agent team. Your parent bot id is ${input.parentBotId}. Complete delegated work in your own context, then return a concise result with evidence to the requester. Do not redirect the user between chats.`;
  }
  return CONVERSATION_POLICY;
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
