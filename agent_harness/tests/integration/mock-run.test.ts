import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightBrowserHost } from "../../src/browser/playwright-controller";
import { parseHarnessConfig } from "../../src/config/load-config";
import { RunLoop } from "../../src/core/run-loop";
import type { ModelAdapter } from "../../src/providers/model-adapter";

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
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/event") {
        receivedEvents.push(url.searchParams.get("type") ?? "unknown");
        response.statusCode = 204;
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
      model: "google/gemini-3.5-flash",
      location: "global",
      runMode: "dev",
      performance: { settleDelayMs: 30 },
    });
    const outputs = [
      '{"type":"MOVE","x":756,"y":386}',
      '{"type":"CLICK","x":756,"y":386,"purpose":"response"}',
      '{"type":"DONE"}',
    ];
    const model: ModelAdapter = {
      provider: "google-agent-platform",
      model: config.model,
      generateAction: async () => ({
        rawOutput: outputs.shift() ?? '{"type":"DONE"}',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    };
    const host = new PlaywrightBrowserHost({ launcher: undefined, settleDelayMs: 30, navigationTimeoutMs: 10_000 });
    const summary = await new RunLoop({
      browserHost: host,
      model,
      logger: { log: async () => undefined, writeScreenshot: async () => undefined, close: async () => undefined },
    }).run(config, "Complete the visible fixture.");
    await host.close();

    expect(summary.status).toBe("completed");
    expect(receivedEvents).toEqual(expect.arrayContaining(["fixation", "move", "response"]));
  });
});
