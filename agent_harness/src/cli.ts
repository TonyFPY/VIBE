import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PlaywrightBrowserHost, type PlaywrightBrowserHostOptions } from "./browser/playwright-controller";
import { buildTaskUrlFromHost, parseHarnessConfig } from "./config/load-config";
import { resolveModelSpec } from "./config/model-catalog";
import type { HarnessConfig, HarnessRunMode, HarnessTask } from "./config/types";
import { RunLoop } from "./core/run-loop";
import { RunLogger } from "./logging/run-logger";
import { publicInstructionForTask } from "./prompts/public-instruction";
import { GeminiComputerUseAgent, type GeminiComputerUseAgentOptions } from "./providers/gemini-computer-use";
import type { ComputerUseAgent } from "./providers/computer-use-agent";

export type CliTask = HarnessTask;

export interface CliArgs {
  host: string;
  headed: boolean;
  participantId: string;
  task: CliTask;
  model: string;
  runMode: HarnessRunMode;
}

export type GeminiComputerUseAgentFactory = (
  options: GeminiComputerUseAgentOptions,
) => ComputerUseAgent;

export type PlaywrightBrowserHostFactory = (options: PlaywrightBrowserHostOptions) => PlaywrightBrowserHost;

export function createPlaywrightBrowserHost(
  config: HarnessConfig,
  headed: boolean,
  createHost: PlaywrightBrowserHostFactory = (options) => new PlaywrightBrowserHost(options),
): PlaywrightBrowserHost {
  return createHost({
    headless: !headed,
    settleDelayMs: config.performance.settleDelayMs,
    navigationTimeoutMs: config.performance.connectTimeoutMs,
    mouseMoveSteps: config.mouseMoveSteps,
    mouseMoveDelayMs: config.mouseMoveDelayMs,
  });
}

export function parseCliArgs(args: readonly string[]): CliArgs {
  let host: string | undefined;
  let headed = false;
  let participantId: string | undefined;
  let task: CliTask | undefined;
  let model: string | undefined;
  let runMode: HarnessRunMode | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--headed") {
      if (headed) throw new Error("--headed may be supplied only once");
      headed = true;
      continue;
    }
    if (argument === "--host") {
      if (host !== undefined) throw new Error("--host may be supplied only once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--host requires an HTTP URL");
      host = value.trim();
      index += 1;
      continue;
    }
    if (argument === "--pid") {
      if (participantId !== undefined) throw new Error("--pid may be supplied only once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--pid requires a participant ID");
      const trimmed = value.trim();
      if (!/^\d{1,12}$/.test(trimmed)) throw new Error("--pid must contain 1 to 12 digits");
      participantId = trimmed;
      index += 1;
      continue;
    }
    if (argument === "--task") {
      if (task !== undefined) throw new Error("--task may be supplied only once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--task requires a task name");
      const trimmed = value.trim();
      if (trimmed !== "visual-similarity" && trimmed !== "object-matching") {
        throw new Error("--task must be visual-similarity or object-matching");
      }
      task = trimmed;
      index += 1;
      continue;
    }
    if (argument === "--model") {
      if (model !== undefined) throw new Error("--model may be supplied only once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--model requires a model ID");
      model = value.trim();
      index += 1;
      continue;
    }
    if (argument === "--runMode") {
      if (runMode !== undefined) throw new Error("--runMode may be supplied only once");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--runMode requires dev or ops");
      const trimmed = value.trim();
      if (trimmed !== "dev" && trimmed !== "ops") throw new Error("--runMode must be dev or ops");
      runMode = trimmed;
      index += 1;
      continue;
    }
    if (argument !== "--config") throw new Error(`Unexpected argument: ${argument}`);
    throw new Error("--config is no longer supported; pass --host, --task, --model, --runMode, and --pid");
  }
  if (host === undefined) throw new Error("--host is required");
  if (task === undefined) throw new Error("--task is required");
  if (model === undefined) throw new Error("--model is required");
  if (runMode === undefined) throw new Error("--runMode is required");
  if (participantId === undefined) throw new Error("--pid is required");
  return { host, headed, participantId, task, model, runMode };
}

function secretEnvironmentValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => Boolean(value) && /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY/i.test(key))
    .map(([, value]) => value!);
}

export function createGeminiComputerUseAgent(
  config: HarnessConfig,
  environment: NodeJS.ProcessEnv,
  createAgent: GeminiComputerUseAgentFactory = (options) => new GeminiComputerUseAgent(options),
): ComputerUseAgent {
  const apiKey = environment.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const model = resolveModelSpec(config.model);
  return createAgent({ apiKey, model: model.apiModelId, performance: config.performance });
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { host, headed, participantId, task, model, runMode } = parseCliArgs(args);
  const config = parseHarnessConfig({
    taskUrl: buildTaskUrlFromHost({ host, task, participantId, model, runMode }),
    participantId,
    model,
    runMode,
  });
  const agent = createGeminiComputerUseAgent(config, environment);
  const runId = `agent-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runsRoot = resolve(environment.AGENT_RUNS_DIR?.trim() || "runs");
  const logger = await RunLogger.open({
    root: runsRoot,
    runId,
    sensitiveValues: secretEnvironmentValues(environment),
  });
  const browserHost = createPlaywrightBrowserHost(config, headed);
  try {
    const summary = await new RunLoop({ browserHost, agent, logger }).run(
      config,
      publicInstructionForTask(config.taskUrl),
    );
    process.stdout.write(`${JSON.stringify({ runId, ...summary })}\n`);
    if (summary.status === "completed") return 0;
    if (summary.status === "failed") return 1;
    return 2;
  } finally {
    try {
      await agent.close();
    } finally {
      await browserHost.close();
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  void runCli().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Unknown harness failure"}\n`);
      process.exitCode = 1;
    },
  );
}
