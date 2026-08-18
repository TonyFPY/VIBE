import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PlaywrightBrowserHost, type PlaywrightBrowserHostOptions } from "./browser/playwright-controller";
import { parseHarnessConfig } from "./config/load-config";
import { resolveModelSpec } from "./config/model-catalog";
import type { HarnessConfig } from "./config/types";
import { RunLoop } from "./core/run-loop";
import { RunLogger } from "./logging/run-logger";
import { publicInstructionForTask } from "./prompts/public-instruction";
import { GeminiComputerUseAgent, type GeminiComputerUseAgentOptions } from "./providers/gemini-computer-use";
import type { ComputerUseAgent } from "./providers/computer-use-agent";

export interface CliArgs {
  configPath: string;
  headed: boolean;
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
  });
}

export function parseCliArgs(args: readonly string[]): CliArgs {
  let configPath: string | undefined;
  let headed = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--headed") {
      if (headed) throw new Error("--headed may be supplied only once");
      headed = true;
      continue;
    }
    if (argument !== "--config") throw new Error(`Unexpected argument: ${argument}`);
    if (configPath) throw new Error("--config may be supplied only once");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--config requires a JSON file path");
    configPath = value;
    index += 1;
  }
  if (!configPath) throw new Error("--config is required");
  return { configPath, headed };
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
  const { configPath, headed } = parseCliArgs(args);
  const rawConfig = JSON.parse(await readFile(resolve(configPath), "utf8"));
  const config = parseHarnessConfig(rawConfig);
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
