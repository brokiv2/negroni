import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

export const AssistantWorkEventWatch = z
  .object({
    connectionId: Id,
    threadKey: z.string().trim().min(1).max(400).optional(),
    externalId: z.string().trim().min(1).max(400).optional(),
    actorAddress: z.string().trim().min(1).max(320).toLowerCase().optional(),
    kind: z.string().trim().min(1).max(60).optional(),
    textIncludes: z.string().trim().min(1).max(160).optional(),
  })
  .refine(
    (watch) => Boolean(watch.threadKey || watch.externalId || watch.actorAddress || watch.kind),
    "Choose a specific thread, item, sender or event kind in this account.",
  );
export type AssistantWorkEventWatch = z.infer<typeof AssistantWorkEventWatch>;
export const AssistantWorkEventWatches = z.array(AssistantWorkEventWatch).max(8);

export const AssistantWorkStatus = z.enum([
  "active",
  "waiting",
  "needs_input",
  "paused",
  "completed",
  "cancelled",
]);
export const AssistantWorkSchema = z.object({
  id: Id,
  botId: Id,
  threadId: Id,
  title: z.string(),
  objective: z.string(),
  status: AssistantWorkStatus,
  version: z.number().int(),
  nextWakeAt: IsoDate.nullable(),
  eventWatches: AssistantWorkEventWatches.default([]),
  recoveryAt: IsoDate.nullable().default(null),
  recoveryCount: z.number().int().nonnegative().default(0),
  wakeReason: z.string(),
  lastResult: z.string(),
  activeRunId: Id.nullable(),
  runCount: z.number().int(),
  maxRuns: z.number().int(),
  deadline: IsoDate,
  updatedAt: IsoDate,
});
export const CreateAssistantWorkInput = z.object({
  title: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(8000),
  nextWakeAt: IsoDate,
  wakeReason: z.string().trim().min(1).max(1000),
  deadline: IsoDate,
  maxRuns: z.number().int().min(1).max(100).default(24),
  eventWatches: AssistantWorkEventWatches.default([]),
});
export const UpdateAssistantWorkInput = z
  .object({
    workId: Id,
    version: z.number().int().positive(),
    status: z.enum(["waiting", "needs_input", "completed"]),
    nextWakeAt: IsoDate.optional(),
    wakeReason: z.string().trim().min(1).max(1000),
    result: z.string().trim().max(8000).default(""),
    eventWatches: AssistantWorkEventWatches.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.status === "waiting") !== Boolean(value.nextWakeAt)) {
      ctx.addIssue({ code: "custom", message: "Only waiting work requires nextWakeAt." });
    }
    if (value.status === "completed" && !value.result) {
      ctx.addIssue({ code: "custom", message: "Completion requires verified result evidence." });
    }
    if (value.status !== "waiting" && value.eventWatches?.length) {
      ctx.addIssue({ code: "custom", message: "Only waiting work can subscribe to events." });
    }
  });
export const ControlAssistantWorkInput = z.object({
  workId: Id,
  version: z.number().int().positive(),
  action: z.enum(["pause", "resume", "cancel"]),
});
