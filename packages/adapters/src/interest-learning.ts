import type {
  AdapterContext,
  AgentRunModel,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";
import { FeedProfileSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { INTEREST_INSTRUCTIONS, quoteInSource, runJsonPass } from "./background-triage.js";
import { eligibleFeedInterests, mutateFeedProfile, observeFeedInterest } from "./feed-profile.js";

const DAY = 86_400_000;
const MESSAGE_LIMIT = 30;
export const INTEREST_CONFIDENCE_MIN = 0.85;

function messageText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter(
      (block): block is { kind: "text"; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { kind?: unknown }).kind === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Chat-time learning depends on the conversation model volunteering a bookkeeping tool call,
 * which it rarely does. Each background cycle therefore reviews the user's own messages
 * since the previous cycle on the cheap model. Topics still need evidence from two separate
 * messages before research uses them, and the active cycle is never cancelled by a new topic.
 */
export async function learnInterestsInBackground(input: {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  researchId: string;
  model: AgentRunModel;
  request: Pick<AgentRunRequest, "botId" | "threadId" | "runId">;
  context: AdapterContext;
  onUsage?: (event: Extract<AgentRuntimeEvent, { type: "usage" }>) => Promise<void>;
}): Promise<{ messages: number; observed: number }> {
  const { prisma } = input;
  const cycle = await prisma.feedResearch.findUniqueOrThrow({
    where: { id: input.researchId },
    include: { profile: true },
  });
  const profile = FeedProfileSchema.parse(cycle.profile.data);
  if (!profile.learningEnabled) return { messages: 0, observed: 0 };
  const owner = { spaceId: cycle.spaceId, userId: cycle.userId };
  const previous = await prisma.feedResearch.findFirst({
    where: { ...owner, createdAt: { lt: cycle.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = new Date(
    Math.max(previous?.createdAt.getTime() ?? 0, cycle.createdAt.getTime() - DAY),
  );
  const rows = await prisma.message.findMany({
    where: {
      role: "user",
      createdAt: { gte: since, lt: cycle.createdAt },
      thread: {
        ...owner,
        kind: { not: "research" },
        groupId: null,
        externalConversationId: null,
      },
    },
    orderBy: { createdAt: "desc" },
    take: MESSAGE_LIMIT,
    select: { id: true, blocks: true },
  });
  const messages = rows
    .map((row) => ({ id: row.id, text: messageText(row.blocks) }))
    .filter((m) => m.text.length >= 12);
  if (!messages.length) return { messages: 0, observed: 0 };
  const verdict = await runJsonPass({
    runtime: input.runtime,
    request: input.request,
    suffix: "interests",
    model: input.model,
    instructions: INTEREST_INSTRUCTIONS,
    prompt: JSON.stringify({
      knownTopics: profile.interests.map((i) => i.topic),
      excludedTopics: profile.excludedTopics,
      messages: messages.map((m) => ({ id: m.id, text: m.text.slice(0, 800) })),
    }),
    context: input.context,
    onUsage: input.onUsage,
    timeoutMs: 45_000,
  });
  const entries = Array.isArray(verdict?.interests) ? verdict.interests.slice(0, 3) : [];
  const accepted: Array<{ raw: Record<string, unknown>; source: { id: string; text: string } }> =
    [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const message = messages.find((m) => m.id === e.messageId);
    const confidence = typeof e.confidence === "number" ? e.confidence : Number(e.confidence);
    const evidence = typeof e.evidence === "string" ? e.evidence.trim().slice(0, 500) : "";
    if (!message || !(confidence >= INTEREST_CONFIDENCE_MIN) || confidence > 1) continue;
    if (!evidence || !quoteInSource(message.text, evidence)) continue;
    // observeFeedInterest demands a literal substring. A quote that only differs in
    // whitespace or typography is replaced by the message's own text (only its id is stored).
    const literal = message.text.includes(evidence) ? evidence : message.text.slice(0, 500);
    accepted.push({
      raw: {
        topic: typeof e.topic === "string" ? e.topic.trim().slice(0, 100) : "",
        reason: typeof e.reason === "string" ? e.reason.slice(0, 300) : "",
        evidence: literal,
        confidence,
      },
      source: message,
    });
  }
  if (!accepted.length) return { messages: messages.length, observed: 0 };
  const updated = await mutateFeedProfile(
    prisma,
    owner,
    (p) =>
      accepted.reduce((acc, { raw, source }) => {
        try {
          return observeFeedInterest(acc, raw, source);
        } catch {
          return acc;
        }
      }, p),
    { preserveResearch: true },
  );
  getLogger().info("background interest learning", {
    "research.id": input.researchId,
    messages: messages.length,
    observed: accepted.length,
    active: eligibleFeedInterests(updated).length,
  });
  return { messages: messages.length, observed: accepted.length };
}
