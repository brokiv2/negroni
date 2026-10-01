import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AdapterContext,
  AgentRunModel,
  AgentRunRequest,
  AgentRuntime,
} from "@rakazo/adapter-kit";
import { CodexAgentRuntime } from "./codex-runtime.js";
import { PiAgentRuntime } from "./pi-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

export interface AgentModelRoute {
  provider: string;
  modelId: string;
}
export interface AgentModelRouting {
  conversation?: AgentModelRoute;
  task?: AgentModelRoute;
}
export function parseAgentModelRouting(value: unknown): AgentModelRouting {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid agent model routing");
  const result: AgentModelRouting = {};
  for (const key of ["conversation", "task"] as const) {
    const route = (value as AgentModelRouting)[key];
    if (route === undefined) continue;
    if (
      !route ||
      typeof route.provider !== "string" ||
      !route.provider.trim() ||
      typeof route.modelId !== "string" ||
      !route.modelId.trim()
    )
      throw new Error(`Invalid ${key} model route`);
    result[key] = { provider: route.provider.trim(), modelId: route.modelId.trim() };
  }
  return result;
}

/**
 * How a conversation run should hand off work, given the tools it actually has. Long
 * work goes to a teammate asynchronously so this conversation stays free; a temporary
 * helper blocks the turn, so it is only for short work whose answer is needed now.
 * A tool that is not available is never suggested.
 */
export function delegationRoutingNote(
  tools: readonly { name: string }[],
  task: AgentModelRoute,
): string {
  const has = (name: string) => tools.some((tool) => tool.name === name);
  const helper = has("run_subagent")
    ? `use run_subagent with model_provider=${JSON.stringify(task.provider)} and model_id=${JSON.stringify(task.modelId)}`
    : "";
  if (has("message_bot")) {
    return [
      "For long-running or multi-step work, hand a focused task to a relevant teammate with message_bot, tell the user briefly what you started, and end your turn; the result wakes you here for review.",
      helper
        ? `Only for a short piece of analysis whose answer you need within this reply, ${helper}.`
        : "",
      "Keep brief conversation and the final synthesis here.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (helper) {
    return `For a short focused piece of analysis inside this reply, ${helper}. Keep brief conversation and the final synthesis here.`;
  }
  return "";
}

/** Credentials are always resolved in the active user/space, never in the routing file. */
export class RoutedAgentRuntime implements AgentRuntime {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly loadRouting: () => Promise<AgentModelRouting>,
  ) {}
  async modelForWorkload(workload: "conversation" | "task") {
    const route = (await this.loadRouting())[workload];
    return route ? { provider: route.provider, id: route.modelId } : undefined;
  }
  describe() {
    return this.runtime.describe();
  }
  abort(runId: string) {
    return this.runtime.abort(runId);
  }
  async *run(request: AgentRunRequest, context?: Partial<AdapterContext>) {
    const routes = await this.loadRouting();
    const resolve = async (route: AgentModelRoute | undefined): Promise<AgentRunModel> => {
      if (!route) return request.model;
      if (!request.resolveModel)
        throw new Error("Model routing requires connected model credentials");
      return request.resolveModel(route.provider, route.modelId);
    };
    const route = request.workload === "conversation" ? routes.conversation : routes.task;
    const model = request.modelRoutingApplied ? request.model : await resolve(route);
    const routingNote =
      routes.task && request.workload === "conversation"
        ? delegationRoutingNote(request.tools, routes.task)
        : "";
    const instructions = routingNote
      ? `${request.instructions}\n${routingNote}`
      : request.instructions;
    yield* this.runtime.run(
      {
        ...request,
        model: { ...model, interactionMode: request.model.interactionMode },
        instructions,
        resolveTaskModel: request.resolveTaskModel ?? (() => resolve(routes.task)),
      },
      context,
    );
  }
}

export function createAgentRuntime(options: {
  kind: string;
  dataDir: string;
  sessionRoot?: string;
  binary?: string;
}): AgentRuntime {
  if (options.kind === "scripted") return new ScriptedAgentRuntime();
  if (options.kind === "pi") return new PiAgentRuntime({ sessionRoot: options.sessionRoot });
  if (options.kind !== "codex") throw new Error(`Unknown agent runtime: ${options.kind}`);
  return new RoutedAgentRuntime(new CodexAgentRuntime({ binary: options.binary }), async () => {
    try {
      return parseAgentModelRouting(
        JSON.parse(await readFile(join(options.dataDir, "agent-routing.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  });
}
