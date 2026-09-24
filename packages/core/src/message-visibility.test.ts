import type { ThreadMessage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  delegationChip,
  personalTranscriptBlocks,
  transcriptContentBlocks,
  userVisibleMessages,
  workedWithLabel,
} from "./message-visibility.js";

function message(id: string, runId: string, blocks: ThreadMessage["blocks"]): ThreadMessage {
  return {
    id,
    threadId: "thread-1",
    seq: 1,
    role: "bot",
    blocks,
    runId,
    createdAt: "2026-08-30T22:00:00.000Z",
  };
}

const peerExchange = [
  message("user", "run-user", [{ kind: "text", text: "Please ask Coder." }]),
  message("sent", "run-user", [
    { kind: "bot_message_sent", toBotId: "coder", toBotName: "Coder", text: "Check this." },
  ]),
  message("received", "run-peer", [
    {
      kind: "bot_message_received",
      fromBotId: "coder",
      fromBotName: "Coder",
      text: "Done.",
    },
  ]),
  message("activity", "run-peer", [{ kind: "steps", steps: [{ label: "Message bot", count: 1 }] }]),
  message("reply", "run-peer", [{ kind: "text", text: "Sent Coder the endpoints." }]),
  message("answer", "run-user", [{ kind: "text", text: "Coder is checking it." }]),
];

describe("user-visible messages", () => {
  it("keeps bot-to-bot exchanges out of the user transcript", () => {
    expect(userVisibleMessages(peerExchange).map((item) => item.id)).toEqual(["user", "answer"]);
  });

  it("keeps compact peer receipts when includePeerReceipts is set", () => {
    expect(
      userVisibleMessages(peerExchange, { includePeerReceipts: true }).map((item) => item.id),
    ).toEqual(["user", "sent", "received", "answer"]);
  });

  it("uses authoritative peer run ids when the receipt is outside the loaded page", () => {
    const messages = [
      message("reply", "run-peer", [{ kind: "text", text: "Echoed peer reply" }]),
      message("answer", "run-user", [{ kind: "text", text: "Visible answer" }]),
    ];

    expect(
      userVisibleMessages(messages, { knownPeerRunIds: ["run-peer"] }).map((item) => item.id),
    ).toEqual(["answer"]);
  });
});

describe("delegated result summaries", () => {
  it.each(["result", "status"] as const)(
    "shows the coordinator's %s follow-up on web and mobile",
    (intent) => {
      const rows = [
        message("receipt", "run-result", [
          {
            kind: "bot_message_received",
            fromBotId: "reviewer",
            fromBotName: "Reviewer",
            text: "Verified 12",
            intent,
          },
        ]),
        message("summary", "run-result", [
          { kind: "text", text: "Reviewer verified 144 / 12 = 12." },
        ]),
      ];
      expect(userVisibleMessages(rows).map((row) => row.id)).toEqual(["summary"]);
      expect(userVisibleMessages(rows, { includePeerReceipts: true }).map((row) => row.id)).toEqual(
        ["receipt", "summary"],
      );
    },
  );
});

describe("transcript activity removal", () => {
  it("drops tool history and live tool metadata without losing actual response text", () => {
    const blocks: ThreadMessage["blocks"] = [
      { kind: "text", text: "Checking the request." },
      { kind: "steps", steps: [{ label: "Read file", count: 1 }], durationMs: 1000 },
      { kind: "progress", text: "Using browser", pendingToolNames: ["browser"] },
      { kind: "progress", text: "The result is ready." },
      { kind: "text", text: "Answer: 12." },
    ];
    expect(transcriptContentBlocks(blocks)).toEqual([blocks[0], blocks[3], blocks[4]]);
    expect(blocks).toHaveLength(5);
  });

  it("keeps interactive blocks and peer receipts", () => {
    const receipt = peerExchange[1]!.blocks[0]!;
    const ask: ThreadMessage["blocks"][number] = {
      kind: "ask",
      text: "Approve this action?",
      approvalEffectId: "effect-1",
    };
    expect(transcriptContentBlocks([receipt, ask])).toEqual([receipt, ask]);
  });

  it("keeps coordination visible in team chats and hides it in the assistant view", () => {
    const blocks: ThreadMessage["blocks"] = [
      { kind: "handoff", fromBotId: "chief", toBotId: "coder", text: "Check this" },
      { kind: "subagent", status: "running", subagentId: "helper", label: "Research" },
      { kind: "text", text: "Here is the answer." },
    ];
    expect(transcriptContentBlocks(blocks)).toEqual(blocks);
    expect(transcriptContentBlocks(blocks, { hideCoordination: true })).toEqual([blocks[2]]);
  });
});

describe("personal delegation chips", () => {
  it("turns each delegation block into a Worked with chip", () => {
    expect(
      delegationChip({ kind: "bot_message_sent", toBotId: "b1", toBotName: "Analyst", text: "x" }),
    ).toEqual({ botId: "b1", name: "Analyst", live: false });
    expect(
      delegationChip({
        kind: "subagent",
        agentId: "a1",
        name: "Scout",
        task: "Compare prices",
        status: "running",
      }),
    ).toEqual({ name: "Scout", live: true, detail: "Compare prices" });
    expect(
      delegationChip({ kind: "child_bot", botId: "b2", name: "Travel", status: "created" }),
    ).toEqual({ botId: "b2", name: "Travel", live: false });
    expect(
      delegationChip({ kind: "handoff", fromBotId: "b1", toBotId: "b3", text: "over to you" }),
    ).toEqual({ botId: "b3", live: false });
    expect(delegationChip({ kind: "text", text: "hi" })).toBeNull();
    expect(workedWithLabel("Analyst")).toBe("Worked with Analyst");
  });

  it("keeps delegation blocks and drops raw worker replies in the Personal transcript", () => {
    const blocks = personalTranscriptBlocks([
      { kind: "text", text: "Done." },
      { kind: "bot_message_sent", toBotId: "b1", toBotName: "Analyst", text: "run it" },
      {
        kind: "bot_message_received",
        fromBotId: "b1",
        fromBotName: "Analyst",
        text: "raw",
        hop: 1,
      },
      { kind: "handoff", fromBotId: "b1", toBotId: "b3", text: "over" },
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(["text", "bot_message_sent", "handoff"]);
  });
});
