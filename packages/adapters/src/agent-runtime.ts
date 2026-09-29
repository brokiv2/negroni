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
    const task = routes.task;
    const instructions =
      task && request.workload === "conversation"
        ? `${request.instructions}\nFor complex analysis, implementation or multi-step work, delegate a focused task with run_subagent using model_provider=${JSON.stringify(task.provider)} and model_id=${JSON.stringify(task.modelId)}. Keep brief conversation and the final synthesis here. Reuse a lasting specialist for recurring project work.`
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
