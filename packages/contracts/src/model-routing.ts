import * as z from "zod";

export const ModelRouteSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(200),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export const modelRouteKey = (route: ModelRoute) => JSON.stringify([route.provider, route.modelId]);

export const ModelRoutingSchema = z
  .object({
    enabled: z.array(ModelRouteSchema).max(100).default([]),
    conversation: ModelRouteSchema.nullable().default(null),
    task: ModelRouteSchema.nullable().default(null),
    router: ModelRouteSchema.nullable().default(null),
    /** Short tool-less background passes (Radar triage, feed checks). */
    background: ModelRouteSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const keys = new Set(value.enabled.map(modelRouteKey));
    if (keys.size !== value.enabled.length)
      ctx.addIssue({ code: "custom", path: ["enabled"], message: "Duplicate model" });
    for (const role of ["conversation", "task", "router"] as const) {
      const route = value[role];
      if (route && !keys.has(modelRouteKey(route)))
        ctx.addIssue({ code: "custom", path: [role], message: "Choose an enabled model" });
    }
  });
export type ModelRouting = z.infer<typeof ModelRoutingSchema>;
export const emptyModelRouting = (): ModelRouting => ({
  enabled: [],
  conversation: null,
  task: null,
  router: null,
  background: null,
});

/**
 * What a save stores. Clients that predate the background role omit it, so the stored
 * choice carries over; a background model that is no longer enabled is dropped rather
 * than failing the save, because those clients clear only the roles they know when a
 * model is removed.
 */
export function routingToSave(input: ModelRouting, stored: ModelRouting | null): ModelRouting {
  const background =
    input.background === undefined ? (stored?.background ?? null) : input.background;
  const enabled = new Set(input.enabled.map(modelRouteKey));
  return {
    ...input,
    background: background && enabled.has(modelRouteKey(background)) ? background : null,
  };
}
