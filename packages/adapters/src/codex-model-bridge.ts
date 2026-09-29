import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  TextContent,
  Tool,
} from "@earendil-works/pi-ai";
import type { AgentRunModel } from "@rakazo/adapter-kit";
import { reliableStreamOptions, resolveRuntimeModel } from "./pi-runtime.js";

type Item = Record<string, unknown>;
const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function contentParts(value: unknown): Array<TextContent | ImageContent> {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((part): Array<TextContent | ImageContent> => {
    if (typeof part?.text === "string") return [{ type: "text", text: part.text }];
    if (part?.type === "input_image" && typeof part.image_url === "string") {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url);
      if (match) return [{ type: "image", mimeType: match[1]!, data: match[2]! }];
      throw new Error("Codex bridge accepts inline images only");
    }
    return [];
  });
}

/** Responses wire format is translated here; Codex owns the agent/tool loop. */
export function bridgeContext(
  body: Item,
  model: AgentRunModel,
  allowed: Set<string>,
  cache: Map<string, AssistantMessage>,
): Context {
  const messages: Message[] = [];
  const instructions = typeof body.instructions === "string" ? [body.instructions] : [];
  const restored = new Set<AssistantMessage>();
  const calls = new Map<string, string>();
  const assistant = (content: AssistantMessage["content"]): AssistantMessage => ({
    role: "assistant",
    content,
    api: "openai-completions",
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason: "stop",
    timestamp: Date.now(),
  });
  for (const item of Array.isArray(body.input) ? body.input : []) {
    const saved = cache.get(String(item.id ?? item.call_id ?? ""));
    if (saved) {
      if (!restored.has(saved)) {
        messages.push(saved);
        restored.add(saved);
      }
      for (const part of saved.content) if (part.type === "toolCall") calls.set(part.id, part.name);
      continue;
    }
    if (item.type === "function_call") {
      calls.set(item.call_id, item.name);
      messages.push(
        assistant([
          {
            type: "toolCall",
            id: item.call_id,
            name: item.name,
            arguments: JSON.parse(item.arguments || "{}"),
          },
        ]),
      );
    } else if (item.type === "function_call_output") {
      messages.push({
        role: "toolResult",
        toolCallId: item.call_id,
        toolName: calls.get(item.call_id) ?? "tool",
        content: contentParts(item.output),
        isError: false,
        timestamp: Date.now(),
      });
    } else if (item.type === "message" || item.role) {
      const parts = contentParts(item.content);
      if (item.role === "system" || item.role === "developer")
        instructions.push(
          parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
        );
      else if (item.role === "assistant")
        messages.push(assistant(parts.filter((p): p is TextContent => p.type === "text")));
      else messages.push({ role: "user", content: parts, timestamp: Date.now() });
    }
  }
  const tools: Tool[] = [];
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    const candidates = tool.type === "namespace" ? tool.tools : [tool];
    for (const candidate of candidates ?? []) {
      if (candidate.type === "function" && allowed.has(candidate.name)) {
        tools.push({
          name: candidate.name,
          description: candidate.description ?? "",
          parameters: candidate.parameters,
        });
      }
    }
  }
  return { systemPrompt: instructions.join("\n\n"), messages, tools };
}

export async function startCodexModelBridge(
  modelConfig: AgentRunModel,
  allowed: Set<string>,
  signal: AbortSignal,
) {
  const resolved = resolveRuntimeModel(modelConfig);
  if (!resolved.model)
    throw new Error(`Model is not available: ${modelConfig.provider}/${modelConfig.id}`);
  const model = resolved.model;
  const token = randomUUID();
  const cache = new Map<string, AssistantMessage>();
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.writeHead(404).end();
      return;
    }
    const disconnected = new AbortController();
    res.on("close", () => disconnected.abort());
    const requestSignal = AbortSignal.any([signal, disconnected.signal]);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Item;
      const context = bridgeContext(body, modelConfig, allowed, cache);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      const id = `resp_${randomUUID()}`;
      let sequence = 0;
      const send = (type: string, data: Item) =>
        res.write(`data: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
      send("response.created", {
        response: { id, object: "response", status: "in_progress", output: [] },
      });
      const output: Item[] = [];
      const messageIds: string[] = [];
      const indexes = new Map<number, number>();
      const stream = resolved.models.streamSimple(
        model,
        context,
        reliableStreamOptions(
          model,
          {
            apiKey: resolved.apiKey,
            signal: requestSignal,
            reasoning:
              modelConfig.thinkingLevel === "off"
                ? undefined
                : (modelConfig.thinkingLevel ?? "low"),
          },
          modelConfig.maxTokens,
        ),
      );
      for await (const event of stream) {
        if (event.type === "text_start") {
          const itemId = `msg_${randomUUID()}`;
          const index = output.length;
          indexes.set(event.contentIndex, index);
          output.push({
            id: itemId,
            type: "message",
            role: "assistant",
            status: "in_progress",
            content: [{ type: "output_text", text: "", annotations: [] }],
          });
          messageIds.push(itemId);
          send("response.output_item.added", { output_index: index, item: output[index] });
          send("response.content_part.added", {
            item_id: itemId,
            output_index: index,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
        } else if (event.type === "text_delta") {
          const index = indexes.get(event.contentIndex)!;
          send("response.output_text.delta", {
            item_id: output[index]!.id,
            output_index: index,
            content_index: 0,
            delta: event.delta,
          });
        } else if (event.type === "text_end") {
          const index = indexes.get(event.contentIndex)!;
          output[index] = {
            ...output[index],
            status: "completed",
            content: [{ type: "output_text", text: event.content, annotations: [] }],
          };
          send("response.output_text.done", {
            item_id: output[index]!.id,
            output_index: index,
            content_index: 0,
            text: event.content,
          });
          send("response.output_item.done", { output_index: index, item: output[index] });
        } else if (event.type === "toolcall_end") {
          if (!allowed.has(event.toolCall.name))
            throw new Error("Model returned an unregistered tool");
          const call = event.toolCall;
          const item = {
            type: "function_call",
            id: `fc_${randomUUID()}`,
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
            status: "completed",
          };
          const index = output.length;
          output.push(item);
          messageIds.push(item.id);
          send("response.output_item.added", {
            output_index: index,
            item: { ...item, arguments: "", status: "in_progress" },
          });
          send("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: index,
            delta: item.arguments,
          });
          send("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: index,
            arguments: item.arguments,
          });
          send("response.output_item.done", { output_index: index, item });
        } else if (event.type === "error") {
          throw new Error("Model request failed");
        } else if (event.type === "done") {
          for (const itemId of messageIds) cache.set(itemId, event.message);
          const u = event.message.usage;
          send("response.completed", {
            response: {
              id,
              object: "response",
              status: "completed",
              model: modelConfig.id,
              output,
              usage: {
                input_tokens: u.input + u.cacheRead + u.cacheWrite,
                output_tokens: u.output,
                total_tokens: u.totalTokens,
                input_tokens_details: { cached_tokens: u.cacheRead },
              },
            },
          });
        }
      }
      res.end();
    } catch {
      // Provider errors can contain URLs, headers or credential material.
      const error = {
        code: "model_connection_failed",
        message: "The model connection failed. Check its settings and retry.",
      };
      if (res.headersSent)
        res.end(
          `data: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error } })}\n\n`,
        );
      else {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error }));
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    token,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
