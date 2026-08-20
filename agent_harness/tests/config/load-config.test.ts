import { describe, expect, it } from "vitest";

import { buildTaskUrl, buildTaskUrlFromHost, parseHarnessConfig } from "../../src/config/load-config";
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

  it("builds a task URL from a host and task name", () => {
    expect(buildTaskUrlFromHost({
      host: "https://vibe-9d6e5.web.app/",
      task: "object-matching",
      participantId: "1",
      model: "google/gemini-3.7-flash",
      runMode: "ops",
    })).toBe(
      "https://vibe-9d6e5.web.app/tasks/object-matching?participant_id=A1&model=google%2Fgemini-3.7-flash&run=ops",
    );
    expect(() => buildTaskUrlFromHost({
      host: "https://vibe-9d6e5.web.app/base",
      task: "visual-similarity",
      participantId: "1",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
    })).toThrow("host must not include a path");
  });

  it("accepts a single-digit participant ID and preserves it in the agent URL", () => {
    const config = { ...minimumConfig, participantId: "1" };
    expect(parseHarnessConfig(config).participantId).toBe("1");
    expect(buildTaskUrl(config)).toBe(
      "https://vibe-9d6e5.web.app/tasks/visual-similarity?participant_id=A1&model=google%2Fgemini-3.7-flash&run=dev",
    );
  });

  it("applies bounded performance and viewport defaults", () => {
    expect(parseHarnessConfig(minimumConfig)).toMatchObject({
      viewport: { width: 1080, height: 675 },
      screenshotQuality: 90,
      mouseMoveSteps: 1,
      mouseMoveDelayMs: 20,
      maxSteps: 384,
      maxInvalidActions: 3,
      performance: {
        outputTokens: 2048,
        connectTimeoutMs: 10_000,
        requestTimeoutMs: 120_000,
        totalRunTimeoutMs: 2_700_000,
        settleDelayMs: 2_000,
        maxResponseBytes: 131_072,
        maxProviderRetries: 2,
      },
    });
  });

  it("accepts bounded mouse movement steps", () => {
    expect(parseHarnessConfig({ ...minimumConfig, mouseMoveSteps: 37 }).mouseMoveSteps).toBe(37);
    expect(() => parseHarnessConfig({ ...minimumConfig, mouseMoveSteps: 0 })).toThrow("mouseMoveSteps");
    expect(() => parseHarnessConfig({ ...minimumConfig, mouseMoveSteps: 101 })).toThrow("mouseMoveSteps");
  });

  it("accepts bounded mouse movement delay", () => {
    expect(parseHarnessConfig({ ...minimumConfig, mouseMoveDelayMs: 35 })).toMatchObject({ mouseMoveDelayMs: 35 });
    expect(parseHarnessConfig({ ...minimumConfig, mouseMoveDelayMs: 0 })).toMatchObject({ mouseMoveDelayMs: 0 });
    expect(() => parseHarnessConfig({ ...minimumConfig, mouseMoveDelayMs: -1 })).toThrow("mouseMoveDelayMs");
    expect(() => parseHarnessConfig({ ...minimumConfig, mouseMoveDelayMs: 1001 })).toThrow("mouseMoveDelayMs");
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
