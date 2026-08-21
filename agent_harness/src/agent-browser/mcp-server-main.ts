import { pathToFileURL } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { VisualBrowserToolset, createVisualBrowserMcpServer } from "./mcp-server";
import { parseAgentBrowserConfig, type AgentBrowserConfig } from "./run-config";
import { PlaywrightBrowserHost, type PlaywrightBrowserHostOptions } from "../browser/playwright-controller";
import type { BrowserHost } from "../browser/browser-types";
import { RunLogger, type RunLoggerOptions, type RunLoggerPort } from "../logging/run-logger";

export interface AgentBrowserToolsetFactories {
  createBrowserHost(options: PlaywrightBrowserHostOptions): BrowserHost;
  openLogger(options: RunLoggerOptions): Promise<RunLoggerPort>;
}

export interface AgentBrowserMcpFactories extends AgentBrowserToolsetFactories {
  createTransport(): Transport;
}

export interface AgentBrowserMcpHandle {
  readonly config: AgentBrowserConfig;
  readonly server: ReturnType<typeof createVisualBrowserMcpServer>;
  readonly toolset: VisualBrowserToolset;
  close(): Promise<void>;
}

const defaultToolsetFactories: AgentBrowserToolsetFactories = {
  createBrowserHost: (options) => new PlaywrightBrowserHost(options),
  openLogger: (options) => RunLogger.open(options),
};

const defaultFactories: AgentBrowserMcpFactories = {
  ...defaultToolsetFactories,
  createTransport: () => new StdioServerTransport(),
};

export async function createAgentBrowserToolset(
  environment: NodeJS.ProcessEnv = process.env,
  factories: AgentBrowserToolsetFactories = defaultToolsetFactories,
): Promise<Pick<AgentBrowserMcpHandle, "config" | "toolset">> {
  const config = parseAgentBrowserConfig(environment);
  const browserHost = factories.createBrowserHost({
    headless: config.headless,
    settleDelayMs: config.settleDelayMs,
    navigationTimeoutMs: config.navigationTimeoutMs,
    mouseMoveSteps: config.mouseMoveSteps,
    mouseMoveDelayMs: config.mouseMoveDelayMs,
  });
  const logger = await factories.openLogger({
    root: config.runsRoot,
    runId: config.runId,
  });
  return {
    config,
    toolset: new VisualBrowserToolset({ config, browserHost, logger }),
  };
}

export async function startAgentBrowserMcp(
  environment: NodeJS.ProcessEnv = process.env,
  factories: AgentBrowserMcpFactories = defaultFactories,
): Promise<AgentBrowserMcpHandle> {
  const { config, toolset } = await createAgentBrowserToolset(environment, factories);
  const server = createVisualBrowserMcpServer(toolset);

  try {
    await server.connect(factories.createTransport());
  } catch (error) {
    await toolset.close();
    throw error;
  }

  let closed = false;
  return {
    config,
    server,
    toolset,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await server.close();
      } finally {
        await toolset.close();
      }
    },
  };
}

export async function runAgentBrowserMcp(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const handle = await startAgentBrowserMcp(environment);
  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void handle.close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("beforeExit", shutdown);
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  void runAgentBrowserMcp().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown browser MCP failure";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  });
}
