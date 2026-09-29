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
});
