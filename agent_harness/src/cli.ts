import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PlaywrightBrowserHost } from "./browser/playwright-controller";
import { parseHarnessConfig } from "./config/load-config";
import { resolveModelSpec } from "./config/model-catalog";
import { RunLoop } from "./core/run-loop";
import { RunLogger } from "./logging/run-logger";
import { publicInstructionForTask } from "./prompts/public-instruction";
import { GoogleAgentPlatformAdapter } from "./providers/google-agent-platform";

export interface CliArgs {
  configPath: string;
}

export function parseCliArgs(args: readonly string[]): CliArgs {
  let configPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--config") throw new Error(`Unexpected argument: ${argument}`);
    if (configPath) throw new Error("--config may be supplied only once");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--config requires a JSON file path");
    configPath = value;
    index += 1;
  }
  if (!configPath) throw new Error("--config is required");
  return { configPath };
}

function secretEnvironmentValues(environment: NodeJS.ProcessEnv): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => Boolean(value) && /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY/i.test(key))
    .map(([, value]) => value!);
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { configPath } = parseCliArgs(args);
  const rawConfig = JSON.parse(await readFile(resolve(configPath), "utf8"));
  const config = parseHarnessConfig(rawConfig);
  const project = environment.GOOGLE_CLOUD_PROJECT?.trim();
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is required");
  const runId = `agent-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runsRoot = resolve(environment.AGENT_RUNS_DIR?.trim() || "runs");
  const logger = await RunLogger.open({
    root: runsRoot,
    runId,
    sensitiveValues: secretEnvironmentValues(environment),
  });
  const browserHost = new PlaywrightBrowserHost({
    settleDelayMs: config.performance.settleDelayMs,
    navigationTimeoutMs: config.performance.connectTimeoutMs,
  });
  const model = new GoogleAgentPlatformAdapter({
    project,
    location: config.location,
    model: resolveModelSpec(config.model, config.location),
    performance: config.performance,
  });
  try {
    const summary = await new RunLoop({ browserHost, model, logger }).run(
      config,
      publicInstructionForTask(config.taskUrl),
    );
    process.stdout.write(`${JSON.stringify({ runId, ...summary })}\n`);
    return summary.status === "completed" ? 0 : summary.status === "incomplete" ? 2 : 1;
  } finally {
    await browserHost.close();
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
