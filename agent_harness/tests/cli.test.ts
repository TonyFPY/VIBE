import { describe, expect, it } from "vitest";

import { buildTaskUrlFromHost, parseHarnessConfig } from "../src/config/load-config";
import type { ComputerUseAgent } from "../src/providers/computer-use-agent";
import {
  createGeminiComputerUseAgent,
  createPlaywrightBrowserHost,
  parseCliArgs,
} from "../src/cli";

const baseCliArgs = [
  "--host", "https://vibe-9d6e5.web.app",
  "--task", "visual-similarity",
  "--model", "google/gemini-3.7-flash",
  "--runMode", "dev",
  "--pid", "1",
];

describe("agent harness CLI arguments", () => {
  it("requires host, task, model, run mode, and participant ID", () => {
    expect(parseCliArgs(baseCliArgs)).toEqual({
      host: "https://vibe-9d6e5.web.app",
      task: "visual-similarity",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      participantId: "1",
      headed: false,
    });
    expect(() => parseCliArgs([])).toThrow("--host");
    expect(() => parseCliArgs(baseCliArgs.slice(2))).toThrow("--host");
    expect(() => parseCliArgs(["--host", "https://vibe-9d6e5.web.app", "--model", "google/gemini-3.7-flash", "--runMode", "dev", "--pid", "1"]))
      .toThrow("--task");
    expect(() => parseCliArgs(["--host", "https://vibe-9d6e5.web.app", "--task", "visual-similarity", "--runMode", "dev", "--pid", "1"]))
      .toThrow("--model");
    expect(() => parseCliArgs(["--host", "https://vibe-9d6e5.web.app", "--task", "visual-similarity", "--model", "google/gemini-3.7-flash", "--pid", "1"]))
      .toThrow("--runMode");
    expect(() => parseCliArgs(["--host", "https://vibe-9d6e5.web.app", "--task", "visual-similarity", "--model", "google/gemini-3.7-flash", "--runMode", "dev"]))
      .toThrow("--pid");
  });

  it("accepts headed mode exactly once", () => {
    expect(parseCliArgs([...baseCliArgs, "--headed"])).toEqual({
      host: "https://vibe-9d6e5.web.app",
      task: "visual-similarity",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      participantId: "1",
      headed: true,
    });
    expect(() => parseCliArgs([...baseCliArgs, "--headed", "--headed"])).toThrow("--headed may be supplied only once");
    expect(() => parseCliArgs([...baseCliArgs, "--show-gui"])).toThrow("Unexpected argument");
  });

  it("accepts a one-to-twelve digit participant ID with --pid", () => {
    expect(parseCliArgs([...baseCliArgs.slice(0, -2), "--pid", "007"])).toEqual({
      host: "https://vibe-9d6e5.web.app",
      task: "visual-similarity",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      participantId: "007",
      headed: false,
    });
    expect(() => parseCliArgs([...baseCliArgs.slice(0, -2), "--pid"])).toThrow("--pid requires a participant ID");
    expect(() => parseCliArgs([...baseCliArgs.slice(0, -2), "--pid", "abc"])).toThrow("--pid must contain 1 to 12 digits");
    expect(() => parseCliArgs([...baseCliArgs.slice(0, -2), "--pid", "1234567890123"])).toThrow("--pid must contain 1 to 12 digits");
    expect(() => parseCliArgs([...baseCliArgs, "--pid", "2"])).toThrow("--pid may be supplied only once");
  });

  it("accepts task, model, and run-mode values", () => {
    expect(parseCliArgs([
      "--host", "https://example.test",
      "--task", "object-matching",
      "--model", "google/gemini-3.5-flash",
      "--runMode", "ops",
      "--pid", "7",
    ])).toEqual({
      host: "https://example.test",
      headed: false,
      task: "object-matching",
      model: "google/gemini-3.5-flash",
      runMode: "ops",
      participantId: "7",
    });
    expect(() => parseCliArgs([...baseCliArgs, "--task", "object-matching"]))
      .toThrow("--task may be supplied only once");
    expect(() => parseCliArgs([...baseCliArgs.slice(0, 2), "--task", "other-task", "--model", "google/gemini-3.7-flash", "--runMode", "dev", "--pid", "1"]))
      .toThrow("--task must be visual-similarity or object-matching");
    expect(() => parseCliArgs([...baseCliArgs.slice(0, 2), "--task", "visual-similarity", "--model"]))
      .toThrow("--model requires a model ID");
    expect(() => parseCliArgs([...baseCliArgs.slice(0, 6), "--runMode", "preview", "--pid", "1"]))
      .toThrow("--runMode must be dev or ops");
  });

  it("builds a complete config from the host and CLI values", () => {
    const taskUrl = buildTaskUrlFromHost({
      host: "https://example.test/",
      task: "object-matching",
      participantId: "1",
      model: "google/gemini-3.7-flash",
      runMode: "ops",
    });
    expect(parseHarnessConfig({
      taskUrl,
      participantId: "1",
      model: "google/gemini-3.7-flash",
      runMode: "ops",
    })).toMatchObject({
      taskUrl: "https://example.test/tasks/object-matching?participant_id=A1&model=google%2Fgemini-3.7-flash&run=ops",
      participantId: "1",
      model: "google/gemini-3.7-flash",
      runMode: "ops",
    });
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
      reportActionResults: async () => ({ status: "finished", actions: [], rawProviderOutput: { text: "finished" } }),
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

  it("forwards configured mouse movement steps to the browser host", () => {
    const config = parseHarnessConfig({
      taskUrl: "https://vibe-9d6e5.web.app/tasks/visual-similarity",
      participantId: "001",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      mouseMoveSteps: 23,
      mouseMoveDelayMs: 31,
    });
    let options: unknown;
    createPlaywrightBrowserHost(config, false, (hostOptions) => {
      options = hostOptions;
      return {} as never;
    });
    expect(options).toMatchObject({
      headless: true,
      mouseMoveSteps: 23,
      mouseMoveDelayMs: 31,
    });
  });
});
