import { pathToFileURL } from "node:url";

import { startAgentBrowserHttpServer } from "./http-server";
import { type AgentBrowserHttpFactories } from "./http-server";
import { type AgentBrowserToolsetFactories } from "./mcp-server-main";
import { PlaywrightBrowserHost } from "../browser/playwright-controller";
import { RunLogger } from "../logging/run-logger";

const defaultFactories: AgentBrowserHttpFactories = {
  createBrowserHost: (options) => new PlaywrightBrowserHost(options),
  openLogger: (options) => RunLogger.open(options),
} satisfies AgentBrowserToolsetFactories;

export async function runAgentBrowserHttpServer(
  environment: NodeJS.ProcessEnv = process.env,
  factories: AgentBrowserHttpFactories = defaultFactories,
): Promise<void> {
  const handle = await startAgentBrowserHttpServer(environment, factories);
  process.stdout.write(handle.url + "\n");
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
  void runAgentBrowserHttpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown browser MCP HTTP failure";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  });
}
