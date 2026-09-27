import { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  isBubbleBlock,
  isStandaloneBlock,
  VESPER_BLOCK_RENDERERS,
  vesperBlockRenderer,
} from "./blocks";

/** Every `kind` the discriminated union declares, read from the schema itself. */
function contractBlockKinds(): string[] {
  return MessageBlock.options.map((option) => {
    const shape = (option as unknown as { shape: { kind: { value: string } } }).shape;
    return shape.kind.value;
  });
}

describe("block dispatch", () => {
  it("maps every block kind the contract declares", () => {
    const unmapped = contractBlockKinds().filter((kind) => !(kind in VESPER_BLOCK_RENDERERS));
    expect(unmapped).toEqual([]);
  });

  it("maps nothing that is not a block kind", () => {
    const kinds = new Set(contractBlockKinds());
    const stale = Object.keys(VESPER_BLOCK_RENDERERS).filter((kind) => !kinds.has(kind));
    expect(stale).toEqual([]);
  });

  it("never lets a known kind fall through to the unknown renderer", () => {
    for (const kind of contractBlockKinds()) {
      expect(vesperBlockRenderer(kind), kind).not.toBe("unknown");
    }
  });

  it("names a block kind from a newer server rather than dropping it", () => {
    expect(vesperBlockRenderer("browser")).toBe("unknown");
    expect(vesperBlockRenderer("mail")).toBe("unknown");
  });

  it("collapses every delegation flavour into one chip", () => {
    for (const kind of [
      "subagent",
      "child_bot",
      "cloud_agent",
      "handoff",
      "channel_message",
      "bot_message_sent",
      "bot_message_received",
    ]) {
      expect(vesperBlockRenderer(kind), kind).toBe("delegation");
    }
  });

  it("routes asks, choices and MCP approvals through the same answer surface", () => {
    expect(vesperBlockRenderer("ask")).toBe("ask");
    expect(vesperBlockRenderer("choice")).toBe("ask");
    expect(vesperBlockRenderer("mcp_approval")).toBe("ask");
  });

  it("keeps prose in the bubble and cards outside it", () => {
    expect(isBubbleBlock("text")).toBe(true);
    expect(isBubbleBlock("progress")).toBe(true);
    expect(isBubbleBlock("meta")).toBe(true);
    expect(isBubbleBlock("card")).toBe(false);
    expect(isStandaloneBlock("card")).toBe(true);
    expect(isStandaloneBlock("steps")).toBe(true);
    expect(isStandaloneBlock("file")).toBe(true);
    expect(isStandaloneBlock("text")).toBe(false);
  });

  it("puts an unknown block in neither bucket, so it renders on its own line", () => {
    expect(isBubbleBlock("browser")).toBe(false);
    expect(isStandaloneBlock("browser")).toBe(false);
  });
});
