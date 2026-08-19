import { describe, expect, it } from "vitest";

import { resolveModelSpec } from "../../src/config/model-catalog";

describe("model catalog", () => {
  it.each([
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
  ])("resolves google/%s as a Gemini Computer Use model", (apiModelId) => {
    expect(resolveModelSpec(`google/${apiModelId}`)).toEqual({
      modelId: `google/${apiModelId}`,
      apiModelId,
      provider: "gemini",
      supportsComputerUse: true,
    });
  });

  it("rejects unknown models", () => {
    expect(() => resolveModelSpec("unknown/model")).toThrow("Unknown model");
  });
});
