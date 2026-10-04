import { describe, expect, it } from "vitest";
import { emptyModelRouting, ModelRoutingSchema, routingToSave } from "./model-routing.js";

describe("background model role", () => {
  const fast = { provider: "p", modelId: "fast" };
  const cheap = { provider: "p", modelId: "cheap" };

  it("is optional so older routing documents still parse", () => {
    expect(ModelRoutingSchema.parse({ enabled: [fast] }).background).toBeUndefined();
    expect(emptyModelRouting().background).toBeNull();
  });

  it("keeps the stored choice when a client omits it and drops a model no longer enabled", () => {
    const stored = { ...emptyModelRouting(), enabled: [fast, cheap], background: cheap };
    const { background: _omitted, ...older } = { ...stored, enabled: [fast, cheap] };
    expect(routingToSave(older, stored).background).toEqual(cheap);
    expect(routingToSave({ ...older, enabled: [fast] }, stored).background).toBeNull();
    expect(routingToSave({ ...stored, background: null }, stored).background).toBeNull();
    expect(routingToSave({ ...stored, background: fast }, stored).background).toEqual(fast);
    expect(routingToSave(older, null).background).toBeNull();
  });
});
