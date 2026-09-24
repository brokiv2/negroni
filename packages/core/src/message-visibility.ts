import type { MessageBlock } from "@rakazo/contracts";

type PresentableMessage = {
  runId?: string;
  blocks: readonly MessageBlock[];
};

export type UserVisibleMessagesOptions = {
  /**
   * Keep `bot_message_sent` / `bot_message_received` rows as compact chips
   * (web CollaborationMarker; mobile AgentEventLabel). Peer bodies stay hidden.
   */
  includePeerReceipts?: boolean;
  /** Internal peer-request run IDs when receipts may be out of window. Excludes result/status reporting runs. */
  knownPeerRunIds?: Iterable<string>;
};

export function isPeerReceiptBlocks(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) => block.kind === "bot_message_sent" || block.kind === "bot_message_received",
  );
}

/** A delegated result/status wakes the coordinator to report back to the user. */
export function peerMessageReportsToUser(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === "bot_message_received" &&
      (block.intent === "result" || block.intent === "status"),
  );
}

/** Drop internal peer-request replies; keep coordinator result summaries. */
export function userVisibleMessages<T extends PresentableMessage>(
  messages: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T[] {
  const peerRunIds = new Set([
    ...(options.knownPeerRunIds ?? []),
    ...messages
      .filter(
        (message) =>
          message.blocks.some((block) => block.kind === "bot_message_received") &&
          !peerMessageReportsToUser(message.blocks),
      )
      .flatMap((message) => (message.runId ? [message.runId] : [])),
  ]);
  const includePeerReceipts = options.includePeerReceipts === true;

  return messages.filter((message) => {
    if (isPeerReceiptBlocks(message.blocks)) return includePeerReceipts;
    return !message.runId || !peerRunIds.has(message.runId);
  });
}

/** Chat shows responses and interactive content, without tool execution disclosures. */
export function transcriptContentBlocks(
  blocks: readonly MessageBlock[],
  options: { hideCoordination?: boolean } = {},
): MessageBlock[] {
  return blocks.filter(
    (block) =>
      block.kind !== "steps" &&
      !(options.hideCoordination && (block.kind === "handoff" || block.kind === "subagent")) &&
      !(
        block.kind === "progress" &&
        ((block.pendingToolNames?.length ?? 0) > 0 || /^Using\s+/i.test(block.text))
      ),
  );
}
