import { describe, expect, it } from "vitest";

import { resolveModelSpec } from "../../src/config/model-catalog";

describe("model catalog", () => {
  it("resolves the Gemini Computer Use model only", () => {
    expect(resolveModelSpec("google/gemini-3.7-flash")).toEqual({
      modelId: "google/gemini-3.7-flash",
      apiModelId: "gemini-3.7-flash",
      provider: "gemini",
      supportsComputerUse: true,
    });
  });

  it("rejects unknown and non-computer-use models", () => {
    expect(() => resolveModelSpec("unknown/model")).toThrow("Unknown model");
    expect(() => resolveModelSpec("google/gemini-3.5-flash")).toThrow("Unknown model");
  });
});
