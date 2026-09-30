import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentToolExecutionResult,
} from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { isToolPauseResult } from "./approval-effect.js";
import { DELEGATION_TOOL_NAMES } from "./builtin-tools.js";
import { resolveCodexBinary } from "./codex-binary.js";
import { startCodexModelBridge } from "./codex-model-bridge.js";
import { normalizeAgentToolNames } from "./pi-runtime.js";

export interface CodexRuntimeOptions {
  binary?: string;
}

/** Codex owns each turn. All side effects still pass through the Negroni executor. */
export class CodexAgentRuntime implements AgentRuntime {
  private active = new Map<string, AbortController>();
  constructor(private readonly options: CodexRuntimeOptions = {}) {}
  describe() {
    return {
      id: "codex",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: true, tools: true, scripted: false },
    };
  }
  async abort(runId: string) {
    this.active.get(runId)?.abort();
  }
  run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncIterableIterator<AgentRuntimeEvent> {
    const controller = new AbortController();
    const iterator = this.events(request, controller, context);
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => iterator.next(),
      return: () => {
        controller.abort();
        return iterator.return(undefined);
      },
      throw: (error) => {
        controller.abort();
        return iterator.throw(error);
      },
    };
  }
  private async *events(
    request: AgentRunRequest,
    controller: AbortController,
    context?: Partial<AdapterContext>,
  ): AsyncGenerator<AgentRuntimeEvent> {
    const signal = context?.signal
      ? AbortSignal.any([controller.signal, context.signal])
      : controller.signal;
    signal.throwIfAborted();
    this.active.set(request.runId, controller);
    const events: AgentRuntimeEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let failure: unknown;
    const emit = (event: AgentRuntimeEvent) => {
      events.push(event);
      wake?.();
    };
    const work = this.execute(request, signal, emit)
      .catch((error) => {
        if (!signal.aborted) failure = error;
      })
      .finally(() => {
        finished = true;
        wake?.();
      });
    try {
      while (!finished || events.length) {
        const next = events.shift();
        if (next) yield next;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
      if (failure) throw failure;
    } finally {
      controller.abort();
      await work;
      this.active.delete(request.runId);
    }
  }
  private async execute(
    request: AgentRunRequest,
    signal: AbortSignal,
    emit: (event: AgentRuntimeEvent) => void,
  ) {
    const definitions = request.tools;
    const names = normalizeAgentToolNames(definitions);
    const toolMap = new Map(names.map((name, i) => [name, definitions[i]!]));
    const home = await mkdtemp(join(tmpdir(), "negroni-codex-"));
    const stopped = new AbortController();
    const childSignal = AbortSignal.any([signal, stopped.signal]);
    let bridge: Awaited<ReturnType<typeof startCodexModelBridge>> | undefined;
    let proc: ReturnType<typeof spawn> | undefined;
    let paused = false;
    let seq = 0;
    let threadId = "";
    let turnId = "";
    let helperCount = 0;
    let hasText = false;
    let toolCount = 0;
    let complete: (() => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    const pending = new Map<
      number,
      {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    const inFlight = new Set<Promise<void>>();
    const seenSteering: string[] = [];
    const send = (message: unknown) => {
      if (!proc?.stdin?.writable) throw new Error("Codex disconnected");
      proc.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const rpc = (method: string, params: unknown): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex ${method} timed out`));
        }, 30_000);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ id, method, params });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    const stop = () => {
      stopped.abort();
      proc?.kill("SIGTERM");
      complete?.();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      bridge = await startCodexModelBridge(request.model, new Set(names), childSignal);
      signal.throwIfAborted();
      proc = spawn(
        await resolveCodexBinary(this.options.binary ?? process.env.CODEX_BINARY),
        ["app-server"],
        {
          cwd: home,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            TMPDIR: tmpdir(),
            CODEX_HOME: home,
            NEGRONI_MODEL_BRIDGE_TOKEN: bridge.token,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      proc.stderr?.resume(); // Never forward provider/config logs into a user's conversation.
      const completion = new Promise<void>((resolve, reject) => {
        complete = resolve;
        fail = reject;
      });
      // A startup failure can precede awaiting completion.
      void completion.catch(() => undefined);
      const rejectPending = () => {
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(new Error("Codex process exited"));
        }
        pending.clear();
      };
      proc.on("error", () => {
        rejectPending();
        fail?.(
          new Error("Codex could not start. Set CODEX_BINARY to an installed Codex executable."),
        );
      });
      proc.on("exit", () => {
        rejectPending();
        if (signal.aborted || paused) complete?.();
        else fail?.(new Error("Codex process exited before completing the turn"));
      });
      const onTool = async (message: any) => {
        const p = message.params;
        if (message.method !== "item/tool/call") {
          send({
            id: message.id,
            error: { code: -32601, message: "Only application tools are available" },
          });
          return;
        }
        const tool = toolMap.get(p.tool);
        if (!tool || paused || signal.aborted) {
          send({
            id: message.id,
            result: {
              success: false,
              contentItems: [{ type: "inputText", text: "Tool unavailable" }],
            },
          });
          return;
        }
        if (++toolCount > 128) throw new Error("Codex tool budget exhausted");
        const args = p.arguments as Record<string, unknown>;
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new Error("Invalid tool arguments");
        const executionId = `${request.runId}:${p.callId}`;
        const started = Date.now();
        emit({ type: "tool", name: tool.name, args, executionId });
        let result: unknown;
        let error: unknown;
        try {
          if (tool.name === "run_subagent") {
            if (helperCount >= 4) throw new Error("At most four helpers can run together");
            const task = String(args.task ?? "").trim();
            const name = String(args.name ?? "helper").slice(0, 80);
            if (!task) throw new Error("A helper task is required");
            helperCount++;
            emit({ type: "subagent", agentId: executionId, name, task, status: "running" });
            let answer = "";
            try {
              const provider = String(args.model_provider ?? "").trim();
              const modelId = String(args.model_id ?? "").trim();
              if (Boolean(provider) !== Boolean(modelId))
                throw new Error("Set both model_provider and model_id");
              const model = provider
                ? await request.resolveModel?.(provider, modelId)
                : ((await request.resolveTaskModel?.()) ?? request.model);
              if (!model) throw new Error("Helper model is unavailable");
              for await (const event of this.run(
                {
                  ...request,
                  runId: executionId,
                  workload: "task",
                  prompt: task,
                  model,
                  history: [],
                  currentTurnImages: undefined,
                  claimSteering: undefined,
                  executeTool: request.executeTool
                    ? async (...args) => {
                        const result = await request.executeTool!(...args);
                        if (isToolPauseResult(result)) paused = true;
                        return result;
                      }
                    : undefined,
                  instructions: `${request.instructions}\nYou are a temporary specialist. Complete only this task and report evidence to the parent.\n${String(args.instructions ?? "")}`,
                  tools: definitions.filter((item) => !DELEGATION_TOOL_NAMES.has(item.name)),
                },
                { ...contextFor(childSignal) },
              )) {
                if (event.type === "text") answer += event.text;
                else if (event.type === "done" && event.text) answer = event.text;
                else if (event.type === "ask" || event.type === "takeover") {
                  paused = true;
                  emit(event);
                } else if (event.type === "usage") emit(event);
              }
              emit({
                type: "subagent",
                agentId: executionId,
                name,
                task,
                status: paused ? "running" : "completed",
                result: answer,
              });
              result = { result: answer };
            } catch {
              emit({ type: "subagent", agentId: executionId, name, task, status: "failed" });
              result = { error: "Helper could not complete the task" };
            } finally {
              helperCount--;
            }
          } else if (tool.name === "ask_user") {
            const options = Array.isArray(args.options) ? args.options.map(String) : [];
            if (
              options.length < 2 ||
              options.length > 4 ||
              options.some((option) => !option.trim() || option.length > 80) ||
              new Set(options).size !== options.length
            )
              throw new Error("Choose two to four distinct options");
            emit({
              type: "ask",
              text: String(args.question ?? ""),
              actions: options.map((label, i) => ({ id: `choice-${i + 1}`, label })),
            });
            paused = true;
            result = { waiting: true };
          } else if (tool.name === "request_takeover") {
            emit({ type: "takeover", reason: String(args.reason ?? "User action required") });
            paused = true;
            result = { waiting: true };
          } else {
            if (!request.executeTool) throw new Error("Executor unavailable");
            result = await request.executeTool(tool.name, args, executionId, tool.route);
            if (isToolPauseResult(result)) paused = true;
          }
        } catch (caught) {
          error = caught;
          result = { error: "Tool could not complete the request" };
        } finally {
          try {
            await request.onToolCompleted?.({
              name: tool.name,
              executionId,
              durationMs: Date.now() - started,
              result,
              error,
              paused,
            });
          } catch {}
        }
        const content = (result as AgentToolExecutionResult | undefined)?.content;
        const contentItems = Array.isArray(content)
          ? content.map((part) =>
              part.type === "image"
                ? { type: "inputImage", imageUrl: `data:${part.mimeType};base64,${part.data}` }
                : { type: "inputText", text: part.text },
            )
          : [{ type: "inputText", text: JSON.stringify(result ?? null) }];
        send({ id: message.id, result: { success: !error, contentItems } });
        if (paused) {
          stop();
          return;
        }
        if (request.claimSteering && threadId && turnId) {
          const updates = await request.claimSteering(seenSteering);
          for (const update of updates) {
            await rpc("turn/steer", {
              threadId,
              expectedTurnId: turnId,
              input: [{ type: "text", text: update.text }, ...imageInputs(update.images)],
            });
            seenSteering.push(update.id);
          }
        }
      };
      createInterface({ input: proc.stdout! }).on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined && message.method) {
            const task = onTool(message)
              .catch(() => fail?.(new Error("Codex tool dispatch failed")))
              .finally(() => inFlight.delete(task));
            inFlight.add(task);
            return;
          }
          if (message.id !== undefined) {
            const waiter = pending.get(message.id);
            if (!waiter) return;
            clearTimeout(waiter.timer);
            pending.delete(message.id);
            if (message.error) waiter.reject(new Error("Codex rejected the runtime request"));
            else waiter.resolve(message.result);
            return;
          }
          const p = message.params;
          if (message.method === "turn/started") turnId = p.turn.id;
          if (message.method === "item/agentMessage/delta") {
            hasText ||= Boolean(p.delta?.trim());
            emit({ type: "text", text: p.delta });
          }
          if (message.method === "thread/tokenUsage/updated") {
            const u = p.tokenUsage.last;
            emit({
              type: "usage",
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              cacheReadTokens: u.cachedInputTokens ?? 0,
              cacheWriteTokens: 0,
              provider: request.model.provider,
              model: request.model.id,
            });
          }
          if (message.method === "turn/completed") {
            if (p.turn.status === "failed")
              fail?.(new Error("Codex turn failed; check the selected model connection"));
            else complete?.();
          }
        } catch {
          fail?.(new Error("Invalid Codex protocol message"));
        }
      });
      await rpc("initialize", {
        clientInfo: { name: "negroni", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      send({ method: "initialized" });
      const started = await rpc("thread/start", {
        model: request.model.id,
        modelProvider: "negroni",
        ephemeral: true,
        cwd: home,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: request.instructions,
        config: {
          model_providers: {
            negroni: {
              name: "Negroni",
              base_url: bridge.baseUrl,
              env_key: "NEGRONI_MODEL_BRIDGE_TOKEN",
              wire_api: "responses",
              requires_openai_auth: false,
              supports_websockets: false,
            },
          },
          features: {
            shell_tool: false,
            multi_agent: false,
            multi_agent_v2: false,
            code_mode: false,
          },
          web_search: "disabled",
        },
        dynamicTools: definitions.map((tool, i) => ({
          type: "function",
          name: names[i],
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      threadId = started.thread.id;
      if (request.history.length)
        await rpc("thread/inject_items", {
          threadId,
          items: request.history.map((item) => ({
            type: "message",
            role: item.role,
            content: [
              {
                type: item.role === "assistant" ? "output_text" : "input_text",
                text: item.content,
              },
              ...(item.images ?? []).map((image) => ({
                type: "input_image",
                image_url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
              })),
            ],
          })),
        });
      const turn = await rpc("turn/start", {
        threadId,
        input: [{ type: "text", text: request.prompt }, ...imageInputs(request.currentTurnImages)],
      });
      turnId = turn.turn.id;
      await completion;
      if (!paused && !signal.aborted) {
        if (!hasText && !request.allowSilentEmpty)
          emit({
            type: "text",
            text: request.emptyResponseText ?? "The model returned no answer. Please try again.",
          });
        emit({ type: "done" });
      }
    } finally {
      stopped.abort();
      signal.removeEventListener("abort", stop);
      proc?.kill("SIGTERM");
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("Codex run closed"));
      }
      await Promise.allSettled(inFlight);
      await bridge?.close();
      if (proc && proc.exitCode === null && proc.signalCode === null && proc.pid) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            proc?.kill("SIGKILL");
          }, 2_000);
          proc!.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
        (error) => {
          // Cleanup must never turn a completed answer into a failed run.
          getLogger().warn("Codex temporary directory cleanup failed", { code: error?.code });
        },
      );
    }
  }
}
function contextFor(signal: AbortSignal): Partial<AdapterContext> {
  return { signal };
}
function imageInputs(images: AgentRunRequest["currentTurnImages"]) {
  return (images ?? []).map((image) => ({
    type: "image",
    url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
  }));
}
