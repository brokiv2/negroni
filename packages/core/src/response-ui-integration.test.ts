import { ResponseUiBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { projectMessages, reduceLiveMessageBlocks, withLiveStreamingProgress } from "./events.js";
import { createResponseUiStream } from "./response-ui.js";
import { responseUiPlainText } from "./response-ui-plain.js";
import { speechFromBlocks } from "./speech-text.js";

const block = ResponseUiBlock.parse({
  kind: "response_ui",
  id: "demo",
  summary: "Budget calculator",
  complete: true,
  spec: {
    root: "root",
    summary: "Budget calculator",
    state: { amount: 2 },
    elements: {
      root: { type: "Stack", props: {}, children: ["amount", "total", "followup"] },
      amount: {
        type: "Input",
        props: { label: "Amount", input: "number", bind: "/amount", min: 0, max: 100 },
        children: [],
      },
      total: {
        type: "Metric",
        props: {
          label: "Total",
          value: { $calc: { op: "multiply", args: [{ $state: "/amount" }, 3] } },
        },
        children: [],
      },
      followup: {
        type: "Button",
        props: {
          label: "Continue",
          action: { type: "follow_up", prompt: "Private follow-up draft" },
        },
        children: [],
      },
    },
  },
});
describe("response blocks through the chat pipeline", () => {
  it("streams and projects owned image references with a readable legacy fallback", () => {
    const image = {
      type: "Image",
      props: { artifactId: "owned-image", alt: "Dinner table", caption: "Three place settings" },
      children: [],
    };
    const raw = [
      "```negroni-ui",
      JSON.stringify({ op: "add", path: "/summary", value: "Dinner table" }),
      JSON.stringify({ op: "add", path: "/root", value: "photo" }),
      JSON.stringify({ op: "add", path: "/elements/photo", value: image }),
      "```",
    ].join("\n");
    const stream = createResponseUiStream();
    const events = [...stream.push(raw), ...stream.finish()];
    const complete = events.findLast((event) => event.type === "ui" && event.block.complete);
    expect(complete?.type).toBe("ui");
    if (complete?.type !== "ui") throw new Error("Image composition did not compile");
    const parsed = ResponseUiBlock.parse(complete.block);
    const messages = projectMessages([
      {
        id: "image-event",
        threadId: "thread",
        botId: "bot",
        seq: 1,
        createdAt: "2026-10-01T10:00:00Z",
        type: "thread.message.created",
        payload: { messageId: "image-reply", blocks: [parsed] },
      },
    ]);
    expect(messages[0]?.blocks).toEqual([parsed]);
    expect(parsed.spec.elements.photo).toEqual(image);
    expect(responseUiPlainText(parsed)).toBe("Dinner table\nThree place settings");
    expect(responseUiPlainText(parsed)).not.toContain("owned-image");
    for (const props of [
      { alt: "Missing reference" },
      { ...image.props, artifactId: "" },
      { ...image.props, alt: "" },
      { ...image.props, src: "https://example.test/image.png" },
      { ...image.props, url: "data:image/png;base64,AA==" },
    ]) {
      expect(
        ResponseUiBlock.safeParse({
          ...parsed,
          spec: { ...parsed.spec, elements: { photo: { ...image, props } } },
        }).success,
      ).toBe(false);
    }
  });
  it("preserves prose around a live composition and replaces each component update in place", () => {
    const start = reduceLiveMessageBlocks([{ kind: "progress", text: "Adjust this.\n" }], {
      type: "progress",
      payload: { responseUi: { ...block, complete: false } },
    });
    const complete = reduceLiveMessageBlocks(start, {
      type: "progress",
      payload: { responseUi: block },
    });
    const tail = reduceLiveMessageBlocks(complete, {
      type: "progress",
      payload: { delta: "Afterwards.", streaming: true },
    });
    expect(tail).toEqual([
      { kind: "text", text: "Adjust this.\n" },
      block,
      { kind: "progress", text: "Afterwards." },
    ]);
    expect(
      reduceLiveMessageBlocks(tail, {
        type: "progress",
        payload: { responseUi: { ...block, spec: {} } },
      }),
    ).toEqual(tail);
    expect(
      withLiveStreamingProgress({ messages: [{ id: "progress:run", blocks: tail }] }, false)
        ?.messages,
    ).toEqual([]);
  });
  it("updates a persisted response without moving its message or clearing another live run", () => {
    const base = {
      id: "event",
      threadId: "thread",
      botId: "bot",
      createdAt: "2026-10-01T10:00:00Z",
    };
    const messages = projectMessages([
      {
        ...base,
        id: "one",
        seq: 0,
        type: "thread.message.created",
        runId: "finished",
        payload: { messageId: "reply", blocks: [block] },
      },
      {
        ...base,
        id: "two",
        seq: 1,
        type: "thread.progress",
        runId: "other",
        payload: { text: "Working", activity: true },
      },
      {
        ...base,
        id: "three",
        seq: 2,
        type: "thread.message.updated",
        payload: { messageId: "reply", blocks: [{ ...block, revision: 1, state: { amount: 4 } }] },
      },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "reply",
      runId: "finished",
      seq: 0,
      createdAt: base.createdAt,
    });
    expect(messages[0]?.blocks[0]).toMatchObject({ state: { amount: 4 } });
    expect(messages[1]?.runId).toBe("other");
  });
  it("reads current values and calculated results without exposing JSON or a fake button", () => {
    const current = { ...block, state: { amount: 4 } };
    expect(responseUiPlainText(current)).toBe("Amount: 4\nTotal: 12");
    expect(speechFromBlocks([current])).toContain(block.summary);
  });
});
