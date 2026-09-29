import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

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
});
export const UpdateAssistantWorkInput = z
  .object({
    workId: Id,
    version: z.number().int().positive(),
    status: z.enum(["waiting", "needs_input", "completed"]),
    nextWakeAt: IsoDate.optional(),
    wakeReason: z.string().trim().min(1).max(1000),
    result: z.string().trim().max(8000).default(""),
  })
  .superRefine((value, ctx) => {
    if ((value.status === "waiting") !== Boolean(value.nextWakeAt)) {
      ctx.addIssue({ code: "custom", message: "Only waiting work requires nextWakeAt." });
    }
    if (value.status === "completed" && !value.result) {
      ctx.addIssue({ code: "custom", message: "Completion requires verified result evidence." });
    }
  });
export const ControlAssistantWorkInput = z.object({
  workId: Id,
  version: z.number().int().positive(),
  action: z.enum(["pause", "resume", "cancel"]),
});
