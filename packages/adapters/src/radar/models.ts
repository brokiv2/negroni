import type { AgentRunModel, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import type { ModelRoute } from "@rakazo/contracts";
import { ModelRoutingSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { resolveBackgroundModel } from "../background-triage.js";
import type { RadarOwner } from "./profile.js";

export type RadarModelDeps = {
  prisma: PrismaClient;
  /** The owner's configured conversation model (bot override or default credential). */
  resolveModel: (scope: RadarOwner & { botId?: string }) => Promise<AgentRunModel>;
  /** One provider/model pair with the owner's stored credential. */
  resolveConnectedModel: (
    scope: RadarOwner,
    provider: string,
    modelId: string,
  ) => Promise<AgentRunModel>;
};

/**
 * Background passes (judging) use the routing's background role or the cheapest enabled
 * model; second opinions, briefs, prep and profile synthesis use the conversation model.
 * Both resolve lazily, once per cycle.
 */
export function radarModels(deps: RadarModelDeps, owner: RadarOwner, botId: string) {
  let conversation: Promise<AgentRunModel> | undefined;
  let background: Promise<AgentRunModel> | undefined;
  const routing = async () => {
    const member = await deps.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: owner.spaceId, userId: owner.userId } },
      select: { modelRouting: true },
    });
    const parsed = ModelRoutingSchema.safeParse(member?.modelRouting);
    return parsed.success ? parsed.data : null;
  };
  const resolveRoute = (route: ModelRoute) =>
    deps.resolveConnectedModel(owner, route.provider, route.modelId);
  const conversationModel = () => {
    conversation ??= (async () => {
      const route = (await routing())?.conversation;
      if (route) {
        try {
          return await resolveRoute(route);
        } catch {
          // Fall back to the configured default below.
        }
      }
      return deps.resolveModel({ ...owner, botId });
    })();
    return conversation;
  };
  return {
    conversation: async (): Promise<AgentRunModel> => ({
      ...(await conversationModel()),
      maxTokens: Math.min((await conversationModel()).maxTokens ?? 4096, 4096),
      thinkingLevel: "off",
      acceptsImages: false,
    }),
    background: (): Promise<AgentRunModel> => {
      background ??= (async () =>
        resolveBackgroundModel({
          routing: await routing(),
          override: process.env.BACKGROUND_MODEL,
          main: await conversationModel(),
          resolve: resolveRoute,
        }))();
      return background;
    },
  };
}

type UsageEvent = Extract<AgentRuntimeEvent, { type: "usage" }>;

/** Spend is recorded like any other model use, attributed to the main assistant. */
export function recordRadarUsage(prisma: PrismaClient, owner: RadarOwner, botId: string) {
  return async (event: UsageEvent) => {
    await prisma.usageRecord
      .create({
        data: {
          spaceId: owner.spaceId,
          userId: owner.userId,
          botId,
          provider: event.provider,
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
          cacheWriteTokens: event.cacheWriteTokens,
        },
      })
      .catch(() => undefined);
  };
}
