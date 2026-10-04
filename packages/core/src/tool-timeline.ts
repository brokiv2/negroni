import { humanizeToolName } from "./events.js";

type AuditEvent = {
  id: string;
  runId?: string | null;
  type: string;
  payload: unknown;
  createdAt: Date | string;
};
export type ToolActivity = {
  id: string;
  runId: string;
  name: string;
  label: string;
  status: "running" | "succeeded" | "error" | "interrupted" | "waiting";
  startedAt: string;
  durationMs: number | null;
};
/** Public activity contains audit metadata only, never arguments, results or reasoning. */
export function projectToolTimeline(
  events: AuditEvent[],
  runStates: Map<string, string>,
): ToolActivity[] {
  const rows = new Map<string, ToolActivity>();
  for (const event of events) {
    if (!event.runId || !["agent.tool.called", "agent.tool.completed"].includes(event.type))
      continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!name) continue;
    const execution = typeof payload.executionId === "string" ? payload.executionId : event.id;
    const key = `${event.runId}:${execution}`;
    const at = new Date(event.createdAt).toISOString();
    const prior = rows.get(key);
    const complete = event.type === "agent.tool.completed";
    rows.set(key, {
      id: key,
      runId: event.runId,
      name,
      label: humanizeToolName(name),
      status: complete
        ? payload.outcome === "paused"
          ? "waiting"
          : payload.outcome === "succeeded"
            ? "succeeded"
            : "error"
        : "running",
      startedAt: prior?.startedAt ?? at,
      durationMs:
        complete && typeof payload.durationMs === "number" ? Math.max(0, payload.durationMs) : null,
    });
  }
  return [...rows.values()].map((row) => {
    if (row.status !== "running") return row;
    const state = runStates.get(row.runId) ?? "";
    if (["waiting_input", "waiting_takeover"].includes(state)) {
      return { ...row, status: "waiting" as const };
    }
    return ["completed", "failed", "cancelled"].includes(state)
      ? { ...row, status: "interrupted" as const }
      : row;
  });
}
