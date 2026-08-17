import { describe, expect, it } from "vitest";

import { resolveModelSpec } from "../../src/config/model-catalog";

describe("model catalog", () => {
  it("resolves each supported Google Agent Platform API family", () => {
    expect(resolveModelSpec("google/gemini-3.5-flash").apiFamily).toBe("google");
    expect(resolveModelSpec("meta/llama-4-maverick-17b-128e-instruct-maas").apiFamily).toBe("openai-compatible");
    expect(resolveModelSpec("anthropic/claude-sonnet-4-6").apiFamily).toBe("raw-predict");
  });

  it("rejects locations unavailable to the selected model", () => {
    expect(() => resolveModelSpec("google/gemini-3.5-flash", "moon-1")).toThrow("location");
  });
});
