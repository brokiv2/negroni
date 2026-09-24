import { describe, expect, it } from "vitest";
import { connectedModelOptions, modelOptionKey, parseModelOptionKey } from "./model-selection.js";

describe("connectedModelOptions", () => {
  const catalog = [
    { provider: "vendor", id: "fast", label: "Fast", billing: "api" },
    { provider: "vendor", id: "deep", label: "Deep", billing: "api" },
    { provider: "custom", id: "placeholder", label: "Custom", billing: "api", placeholder: true },
    { provider: "disconnected", id: "other", label: "Other", billing: "api" },
  ];

  it("expands a connected catalog provider and excludes disconnected providers", () => {
    expect(
      connectedModelOptions(
        [{ provider: "vendor", modelId: "fast", label: "Vendor" }],
        catalog,
      ).map((option) => option.modelId),
    ).toEqual(["fast", "deep"]);
  });

  it("preserves custom model IDs and never offers a placeholder model", () => {
    expect(
      connectedModelOptions(
        [{ provider: "custom", modelId: "local-model", label: "Local" }],
        catalog,
      ),
    ).toEqual([
      {
        key: "custom::local-model",
        provider: "custom",
        modelId: "local-model",
        label: "Local · local-model",
      },
    ]);
    expect(
      connectedModelOptions([{ provider: "custom", modelId: undefined, label: "Local" }], catalog),
    ).toEqual([]);
  });

  it("deduplicates repeated connections", () => {
    const credential = { provider: "vendor", modelId: "fast", label: "Vendor" };
    expect(connectedModelOptions([credential, credential], catalog)).toHaveLength(2);
  });
});

describe("model option identity", () => {
  it("keeps provider and model ID paired even when the model ID contains a separator", () => {
    expect(parseModelOptionKey(modelOptionKey("custom", "team::model"))).toEqual({
      provider: "custom",
      modelId: "team::model",
    });
    expect(parseModelOptionKey("")).toBeNull();
    expect(parseModelOptionKey("custom::")).toBeNull();
  });
});
