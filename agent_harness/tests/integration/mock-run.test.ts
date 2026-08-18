import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightBrowserHost } from "../../src/browser/playwright-controller";
import type { ActionResult } from "../../src/actions/contract";
import { parseHarnessConfig } from "../../src/config/load-config";
import { RunLoop } from "../../src/core/run-loop";
import type { ComputerUseAgent } from "../../src/providers/computer-use-agent";

const integrationIt = process.env.RUN_PLAYWRIGHT_INTEGRATION === "1" ? it : it.skip;
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("deterministic Playwright run", () => {
  integrationIt("delivers public pointer actions through a real Chromium page", async () => {
    const html = await readFile(fileURLToPath(new URL("../fixtures/public-task.html", import.meta.url)), "utf8");
    const receivedEvents: string[] = [];
    const resultMethods: string[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/event") {
        receivedEvents.push(url.searchParams.get("type") ?? "unknown");
        response.statusCode = 204;
        response.end();
        return;
      }
      if (url.pathname === "/api/experiments/sessions") {
        resultMethods.push(request.method ?? "unknown");
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        response.statusCode = 200;
        response.end();
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not expose a TCP port");

    const config = parseHarnessConfig({
      taskUrl: `http://127.0.0.1:${address.port}/tasks/visual-similarity`,
      participantId: "001",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      performance: { settleDelayMs: 30 },
    });
    const setupActions = [{ type: "click" as const, x: 540, y: 338 }];
    const trialActions = [
      ...Array.from({ length: 9 }, (_, index) => ({ type: "move" as const, x: 700 + index, y: 350 + index })),
      { type: "click" as const, x: 756, y: 386 },
    ];
    const reportedResults: ActionResult[][] = [];
    const agent: ComputerUseAgent = {
      provider: "gemini",
      model: config.model,
      next: async () => ({
        status: "actions",
        actions: setupActions,
        rawProviderOutput: { actions: setupActions },
      }),
      reportActionResults: async (_observation, results) => {
        reportedResults.push([...results]);
        return {
          status: "actions",
          actions: trialActions,
          rawProviderOutput: { actions: trialActions },
        };
      },
      close: async () => undefined,
    };
    const host = new PlaywrightBrowserHost({ launcher: undefined, settleDelayMs: 30, navigationTimeoutMs: 10_000 });
    const summary = await new RunLoop({
      browserHost: host,
      agent,
      logger: { log: async () => undefined, writeScreenshot: async () => undefined, close: async () => undefined },
    }).run(config, "Complete the visible fixture.");
    await host.close();

    expect(summary.status).toBe("completed");
    expect(summary).toMatchObject({ actionCount: 11, observationCount: 2 });
    expect(receivedEvents).toEqual(expect.arrayContaining(["fixation", "move", "response"]));
    expect(resultMethods).toEqual(["POST"]);
    expect(reportedResults).toEqual([[
      { action: { type: "click", x: 540, y: 338 }, status: "executed" },
    ]]);
  });
});
