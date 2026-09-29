import * as z from "zod";
import { Id, RunStatus } from "./ids.js";

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: z.enum([
    "user",
    "routine",
    "resume",
    "follow_up",
    "reaction",
    "spawn",
    "skill",
    "bot_message",
    "webhook",
    "messaging",
    "cloud_agent",
    "created",
  ]),
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;

/**
 * A receipt: one `ExternalEffect` row, the durable record of something the agent
 * did in the outside world.
 *
 * The raw `request` and `result` blobs stay on the server. What crosses the wire
 * is the same bounded set of fields that already reaches the visible approval
 * card, so a receipt can never show more than the approval it came from.
 */
export const EffectReceiptSchema = z.object({
  id: Id,
  runId: Id,
  /** Tool name, e.g. `gmail_send_email`. */
  kind: z.string(),
  /** `intended` | `executing` | `succeeded` | `failed` | `abandoned`. */
  status: z.string(),
  /** Recipient, subject, amount — whatever the call actually named. */
  summary: z.array(z.object({ k: z.string(), v: z.string() })),
  reviewDecision: z.string().nullable(),
  reviewReason: z.string().nullable(),
  reviewModel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EffectReceipt = z.infer<typeof EffectReceiptSchema>;

export const EffectsListOutputSchema = z.object({
  effects: z.array(EffectReceiptSchema),
});
export type EffectsListOutput = z.infer<typeof EffectsListOutputSchema>;

export const EFFECTS_LIST_MAX_LIMIT = 50;

export const ToolActivitySchema = z.object({
  id: Id,
  runId: Id,
  name: z.string(),
  label: z.string(),
  status: z.enum(["running", "succeeded", "error", "interrupted", "waiting"]),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
});
