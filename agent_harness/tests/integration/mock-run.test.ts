import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightBrowserHost } from "../../src/browser/playwright-controller";
import type { ActionResult } from "../../src/actions/contract";
import { parseHarnessConfig } from "../../src/config/load-config";
import { RunLoop } from "../../src/core/run-loop";
import { GeminiComputerUseAgent } from "../../src/providers/gemini-computer-use";
import type { GeminiTransport, GeminiTransportRequest } from "../../src/providers/gemini-transport";

const integrationIt = process.env.RUN_PLAYWRIGHT_INTEGRATION === "1" ? it : it.skip;
const servers: ReturnType<typeof createServer>[] = [];
const performance = {
  outputTokens: 128,
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
  totalRunTimeoutMs: 30_000,
  settleDelayMs: 30,
  maxResponseBytes: 32_768,
  maxProviderRetries: 0,
};

function interaction(steps: unknown[], id: string): unknown {
  return { id, status: "completed", steps };
}

function functionCall(name: string, arguments_: Record<string, unknown>, id: string): unknown {
  return { type: "function_call", id, name, arguments: arguments_ };
}

class FakeGeminiTransport implements GeminiTransport {
  readonly requests: GeminiTransportRequest[] = [];
  private readonly responses = [
    interaction([
      functionCall("click_visible", { x: 500, y: 500, intent: "start the visible task" }, "setup-click"),
    ], "interaction-1"),
    interaction([
      functionCall("submit_trial_actions", {
        moves: [
          { x: 648, y: 518 },
          { x: 649, y: 519 },
          { x: 650, y: 520 },
          { x: 651, y: 521 },
          { x: 652, y: 522 },
          { x: 653, y: 523 },
          { x: 654, y: 524 },
          { x: 655, y: 525 },
          { x: 656, y: 526 },
        ],
        click: { x: 700, y: 572 },
      }, "trial-batch"),
    ], "interaction-2"),
  ];

  async invoke(request: GeminiTransportRequest): Promise<unknown> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("Fake Gemini transport received an unexpected request");
    return response;
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("deterministic Playwright run", () => {
  integrationIt("delivers public pointer actions through a real Chromium page", async () => {
    const html = (await readFile(fileURLToPath(new URL("../fixtures/public-task.html", import.meta.url)), "utf8"))
      .replace(
        "const report = (type) => fetch(`/event?type=${encodeURIComponent(type)}`).catch(() => undefined);",
        "const report = (type, event) => fetch(`/event?type=${encodeURIComponent(event ? type + ':' + event.clientX + ',' + event.clientY : type)}`).catch(() => undefined);",
      )
      .replace(
        'document.body.addEventListener("pointermove", () => report("move"), { once: true });',
        `let taskStarted = false;
      let skipFixationMove = false;
      document.body.addEventListener("pointermove", (event) => {
        if (!taskStarted) return;
        if (skipFixationMove) {
          skipFixationMove = false;
          return;
        }
        report("move", event);
      });`,
      )
      .replace(
        'document.getElementById("cross").addEventListener("click", () => {\n        report("fixation");',
        'document.getElementById("cross").addEventListener("click", () => {\n        report("fixation");\n        taskStarted = true;\n        skipFixationMove = true;',
      )
      .replace(
        'document.getElementById("candidate").addEventListener("click", () => {\n        report("response");',
        'document.getElementById("candidate").addEventListener("click", (event) => {\n        report("response", event);',
      );
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
    const reportedResults: ActionResult[][] = [];
    const transport = new FakeGeminiTransport();
    const geminiAgent = new GeminiComputerUseAgent({
      apiKey: "test-key",
      model: config.model,
      performance,
      transport,
      now: () => "2026-08-17T20:00:00.000Z",
      sleep: async () => undefined,
      random: () => 0,
    });
    const agent = {
      ...geminiAgent,
      provider: geminiAgent.provider,
      model: geminiAgent.model,
      next: geminiAgent.next.bind(geminiAgent),
      reportActionResults: async (observation: Parameters<typeof geminiAgent.reportActionResults>[0], results: readonly ActionResult[], signal: AbortSignal) => {
        reportedResults.push([...results]);
        return geminiAgent.reportActionResults(observation, results, signal);
      },
      close: geminiAgent.close.bind(geminiAgent),
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
    expect(receivedEvents).toEqual([
      "fixation",
      "move:540,337.5",
      "move:699,349",
      "move:700,350",
      "move:702,351",
      "move:703,351",
      "move:704,352",
      "move:705,353",
      "move:706,353",
      "move:707,354",
      "move:708,355",
      "move:756,386",
      "response:756,386",
    ]);
    expect(resultMethods).toEqual(["POST"]);
    expect(reportedResults).toEqual([[{ action: { type: "click", x: 540, y: 337 }, status: "executed" }]]);
    const serializedInitialTools = JSON.stringify(transport.requests[0].tools);
    expect(serializedInitialTools).toContain('"name":"click_visible"');
    expect(serializedInitialTools).toContain('"name":"submit_trial_actions"');
    expect(serializedInitialTools).not.toContain('"name":"click"');
    expect(serializedInitialTools).not.toContain('"name":"move"');
    const serializedContinuationTools = JSON.stringify(transport.requests[1].tools);
    expect(serializedContinuationTools).toContain('"name":"click_visible"');
    expect(serializedContinuationTools).toContain('"name":"submit_trial_actions"');
    expect(serializedContinuationTools).not.toContain('"name":"click"');
    expect(serializedContinuationTools).not.toContain('"name":"move"');
  });
});
