import { describe, expect, it } from "vitest";

import { buildTaskUrl, parseHarnessConfig } from "../../src/config/load-config";
import { resolveModelSpec } from "../../src/config/model-catalog";

const minimumConfig = {
  taskUrl: "https://vibe-9d6e5.web.app/tasks/visual-similarity",
  participantId: "001",
  model: "google/gemini-3.7-flash",
  runMode: "dev",
} as const;

describe("harness configuration", () => {
  it("builds an encoded agent URL without leaking unrelated query fields", () => {
    expect(buildTaskUrl(minimumConfig)).toBe(
      "https://vibe-9d6e5.web.app/tasks/visual-similarity?participant_id=A001&model=google%2Fgemini-3.7-flash&run=dev",
    );
  });

  it("applies bounded performance and viewport defaults", () => {
    expect(parseHarnessConfig(minimumConfig)).toMatchObject({
      viewport: { width: 1080, height: 675 },
      screenshotQuality: 90,
      maxSteps: 256,
      maxInvalidActions: 3,
      performance: {
        outputTokens: 2048,
        connectTimeoutMs: 10_000,
        requestTimeoutMs: 60_000,
        totalRunTimeoutMs: 1_800_000,
        settleDelayMs: 100,
        maxResponseBytes: 32_768,
        maxProviderRetries: 2,
      },
    });
  });

  it("accepts the catalogued Gemini computer-use model", () => {
    expect(resolveModelSpec(minimumConfig.model)).toEqual({
      modelId: "google/gemini-3.7-flash",
      apiModelId: "gemini-3.7-flash",
      provider: "gemini",
      supportsComputerUse: true,
    });
  });

  it("rejects unsafe identity, run, URL, and JPEG settings", () => {
    expect(() => parseHarnessConfig({ ...minimumConfig, participantId: "A001" })).toThrow("participantId");
    expect(() => parseHarnessConfig({ ...minimumConfig, runMode: "full" })).toThrow("runMode");
    expect(() => parseHarnessConfig({ ...minimumConfig, taskUrl: "file:///tmp/task.html" })).toThrow("taskUrl");
    expect(() => parseHarnessConfig({ ...minimumConfig, screenshotQuality: 79 })).toThrow("screenshotQuality");
    expect(() => parseHarnessConfig({ ...minimumConfig, screenshotQuality: 101 })).toThrow("screenshotQuality");
  });

  it("rejects non-Gemini model IDs and ignores obsolete Vertex locations", () => {
    expect(() => parseHarnessConfig({ ...minimumConfig, model: "openai/gpt-5" })).toThrow("model");
    expect(parseHarnessConfig({ ...minimumConfig, location: "global" })).not.toHaveProperty("location");
  });
});
