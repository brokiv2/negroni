import { toUtterances } from "@rakazo/core";
import { type ApiRequestContext, type MobileSnapshot, rpc } from "./api";
import { callDelay, checkCallActive } from "./call-turn";

export async function sendCallTurn(
  botId: string,
  text: string,
  requestContext: ApiRequestContext,
  signal: AbortSignal,
): Promise<string[]> {
  checkCallActive(signal);
  const options = { requestContext, signal };
  const sent = await rpc<{ runId: string; seq: number }>(
    "threads/send",
    {
      botId,
      text,
      interactionMode: "voice",
      clientNonce: `call-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    options,
  );
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    await callDelay(750, signal);
    const snapshot = await rpc<MobileSnapshot>("threads/get", { botId }, options);
    if (snapshot.run && snapshot.run.id !== sent.runId) {
      throw new Error("The conversation changed. Open the chat to continue.");
    }
    const run = snapshot.run;
    if (run && ["waiting_input", "waiting_takeover"].includes(run.status)) {
      throw new Error("The bot needs attention. Open the chat to continue.");
    }
    if (run && ["failed", "cancelled", "stopped"].includes(run.status)) {
      throw new Error(run.error || "The bot stopped. Open the chat for details.");
    }
    if (run && ["queued", "leased", "running"].includes(run.status)) continue;
    const answer = snapshot.messages
      .filter(
        (message) =>
          message.role === "bot" && message.runId === sent.runId && (message.seq ?? -1) > sent.seq,
      )
      .map((message) =>
        message.blocks
          .filter((block) => block.kind === "text")
          .map((block) => block.text)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n");
    if (answer) return toUtterances(answer);
    if (!run || run.status === "completed")
      throw new Error("The bot finished without a spoken response. Open the chat.");
  }
  throw new Error("The bot is still working. Follow its progress in the chat.");
}
