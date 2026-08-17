import { describe, expect, it } from "vitest";

import { parseHarnessConfig } from "../src/config/load-config";
import type { ComputerUseAgent } from "../src/providers/computer-use-agent";
import { createGeminiComputerUseAgent, parseCliArgs } from "../src/cli";

describe("agent harness CLI arguments", () => {
  it("requires exactly one JSON configuration path", () => {
    expect(parseCliArgs(["--config", "runs/dev.json"])).toEqual({ configPath: "runs/dev.json", headed: false });
    expect(() => parseCliArgs([])).toThrow("--config");
    expect(() => parseCliArgs(["--config", "a.json", "extra"])).toThrow("Unexpected argument");
  });

  it("accepts headed mode exactly once", () => {
    expect(parseCliArgs(["--config", "runs/dev.json", "--headed"])).toEqual({
      configPath: "runs/dev.json",
      headed: true,
    });
    expect(() => parseCliArgs(["--config", "runs/dev.json", "--headed", "--headed"])).toThrow("--headed may be supplied only once");
    expect(() => parseCliArgs(["--config", "runs/dev.json", "--show-gui"])).toThrow("Unexpected argument");
  });

  it("constructs the native Gemini agent from the API key, catalog model, and performance settings", () => {
    const config = parseHarnessConfig({
      taskUrl: "https://vibe-9d6e5.web.app/tasks/visual-similarity",
      participantId: "001",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      performance: { settleDelayMs: 25 },
    });
    const agent: ComputerUseAgent = {
      provider: "gemini",
      model: "gemini-3.7-flash",
      next: async () => ({ status: "finished", actions: [], rawProviderOutput: { text: "finished" } }),
      reportActionResult: async () => ({ status: "finished", actions: [], rawProviderOutput: { text: "finished" } }),
      close: async () => undefined,
    };
    let construction: unknown;

    expect(createGeminiComputerUseAgent(config, { GEMINI_API_KEY: "gemini-test-key" }, (options) => {
      construction = options;
      return agent;
    })).toBe(agent);
    expect(construction).toEqual({
      apiKey: "gemini-test-key",
      model: "gemini-3.7-flash",
      performance: config.performance,
    });
    expect(() => createGeminiComputerUseAgent(config, {})).toThrow("GEMINI_API_KEY is required");
  });
});
