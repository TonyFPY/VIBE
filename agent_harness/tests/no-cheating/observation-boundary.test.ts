import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ActionResult, AgentObservation, AgentTurn } from "../../src/actions/contract";
import type { BackendEvent, BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import { parseHarnessConfig } from "../../src/config/load-config";
import type { RunLoggerPort } from "../../src/logging/run-logger";
import { RunLogger } from "../../src/logging/run-logger";
import type { ComputerUseAgent } from "../../src/providers/computer-use-agent";
import { GeminiComputerUseAgent } from "../../src/providers/gemini-computer-use";
import type { GeminiTransport, GeminiTransportRequest } from "../../src/providers/gemini-transport";
import { RunLoop } from "../../src/core/run-loop";

const canary = "SECRET_ANSWER_CANARY";
const publicInstruction = "Choose using only the visible screen.";
const screenshot = Uint8Array.from([0xff, 0xd8, 0xff]);

const performance = {
  outputTokens: 128,
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
  totalRunTimeoutMs: 30_000,
  settleDelayMs: 0,
  maxResponseBytes: 32_768,
  maxProviderRetries: 0,
};

const privateFixture = {
  privateTrial: { correctAnswer: canary, sourcePath: `/private/${canary}.jpg` },
  internalTaskRecord: { answerKey: canary, domText: `<button>${canary}</button>` },
  pageLikeObject: {
    url: () => `https://example.test/tasks/visual-similarity?answer=${canary}`,
    evaluate: () => canary,
    body: { text: canary },
  },
};

function interaction(steps: unknown[], id: string, fields: Record<string, unknown> = {}): unknown {
  return {
    id,
    status: "completed",
    steps,
    responseBody: { privateAnswer: canary },
    ...fields,
  };
}

function functionCall(name: string, arguments_: Record<string, unknown>, id: string): unknown {
  return { type: "function_call", id, name, arguments: arguments_ };
}

function assertBoundaryValue(label: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized, label).not.toContain(canary);
  expect(serialized, label).not.toContain("correctAnswer");
  expect(serialized, label).not.toContain("answerKey");
  expect(serialized, label).not.toContain("sourcePath");
  expect(serialized, label).not.toContain("domText");
  expect(serialized, label).not.toContain("responseBody");
  expect(serialized, label).not.toContain("requestBody");
  expect(serialized, label).not.toContain(`https://example.test/tasks/visual-similarity?answer=${canary}`);
  expect(serialized, label).not.toMatch(/\b(page|evaluate|DOM|html|body|url)\b/i);
}

class FakeGeminiTransport implements GeminiTransport {
  readonly requests: GeminiTransportRequest[] = [];
  private readonly responses = [
    interaction([
      functionCall("click", { x: 250, y: 250, intent: "choose visible candidate" }, "call-1"),
    ], "interaction-1"),
    interaction([
      functionCall("click", { x: 750, y: 500, intent: "submit visible choice" }, "call-2"),
    ], "interaction-2"),
  ];

  async invoke(request: GeminiTransportRequest): Promise<unknown> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected Gemini request");
    return response;
  }
}

class RecordingAgent implements ComputerUseAgent {
  readonly provider: string;
  readonly model: string;
  readonly observations: AgentObservation[] = [];
  readonly actionResults: ActionResult[] = [];

  constructor(private readonly delegate: ComputerUseAgent) {
    this.provider = delegate.provider;
    this.model = delegate.model;
  }

  async next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn> {
    this.observations.push(observation);
    return this.delegate.next(observation, signal);
  }

  async reportActionResult(
    observation: AgentObservation,
    result: ActionResult,
    signal: AbortSignal,
  ): Promise<AgentTurn> {
    this.observations.push(observation);
    this.actionResults.push(result);
    return this.delegate.reportActionResult(observation, result, signal);
  }

  async close(): Promise<void> {
    await this.delegate.close();
  }
}

describe("screenshot-only observation boundary", () => {
  let logRoot: string | undefined;

  afterEach(async () => {
    if (logRoot) await rm(logRoot, { recursive: true, force: true });
    logRoot = undefined;
  });

  it("keeps private task data, page state, URLs, and bodies out of Gemini requests and persisted logs", async () => {
    void privateFixture;
    logRoot = await mkdtemp(join(tmpdir(), "agent-harness-boundary-"));
    const transport = new FakeGeminiTransport();
    const agent = new RecordingAgent(new GeminiComputerUseAgent({
      apiKey: "test-key",
      model: "google/gemini-3.7-flash",
      performance,
      transport,
      now: () => "2026-08-17T20:00:00.000Z",
      sleep: async () => undefined,
      random: () => 0,
    }));
    const logger: RunLoggerPort = await RunLogger.open({
      root: logRoot,
      runId: "boundary-run",
      sensitiveValues: [canary],
    });
    const deliveredBackendEvents: BackendEvent[] = [];
    let openedUrl = "";
    let clickCount = 0;
    let backendListener: ((event: BackendEvent) => void) | undefined;
    const session: BrowserSession = {
      screenshot: async () => screenshot,
      move: async () => undefined,
      click: async () => {
        clickCount += 1;
        if (clickCount === 2) {
          const event = { type: "results-response", status: 202, ok: false, body: canary } as const;
          deliveredBackendEvents.push({ type: event.type, status: event.status, ok: event.ok });
          backendListener?.(event);
        }
        if (clickCount === 4) {
          const event = { type: "results-request-failed", error: "backend request failed" } as const;
          deliveredBackendEvents.push({ type: event.type, error: event.error });
          backendListener?.(event);
        }
      },
      subscribeBackendEvents: (listener) => {
        backendListener = listener;
        return () => { backendListener = undefined; };
      },
      close: async () => undefined,
    };
    const browserHost: BrowserHost = {
      openSession: async (url) => {
        openedUrl = url;
        return session;
      },
      close: async () => undefined,
    };
    const config = parseHarnessConfig({
      taskUrl: `https://example.test/tasks/visual-similarity?answer=${canary}`,
      participantId: "001",
      model: "google/gemini-3.7-flash",
      runMode: "dev",
      maxSteps: 4,
      performance,
    });

    await new RunLoop({
      browserHost,
      agent,
      logger,
      nowMs: (() => {
        let value = 0;
        return () => { value += 1; return value; };
      })(),
      nowIso: () => "2026-08-17T20:00:00.000Z",
      sleep: async () => undefined,
    }).run(config, publicInstruction);

    const persistedLog = await readFile(join(logRoot, "boundary-run", "events.jsonl"), "utf8");
    const providerRequests = transport.requests.map((request) => JSON.parse(JSON.stringify(request)));

    expect(agent.observations).toHaveLength(2);
    expect(providerRequests).toHaveLength(2);
    expect(providerRequests[0]).toMatchObject({
      input: [
        { type: "text", text: publicInstruction },
        { type: "image", data: "/9j/", mime_type: "image/jpeg" },
      ],
    });
    expect(providerRequests[1]).toMatchObject({
      previous_interaction_id: "interaction-1",
      input: [{
        type: "function_result",
        call_id: "call-1",
        name: "click",
        result: [
          { type: "text", text: JSON.stringify({ status: "executed", error: undefined }) },
          { type: "image", data: "/9j/", mime_type: "image/jpeg" },
        ],
      }],
    });
    expect(openedUrl).toBe("https://example.test/tasks/visual-similarity?participant_id=A001&model=google%2Fgemini-3.7-flash&run=dev");

    assertBoundaryValue("observations", agent.observations);
    assertBoundaryValue("provider requests", providerRequests);
    assertBoundaryValue("action results", agent.actionResults);
    assertBoundaryValue("backend events", deliveredBackendEvents);
    assertBoundaryValue("persisted logs", persistedLog);
    expect(JSON.parse(JSON.stringify(agent.observations[0]))).toEqual({
      screenshot: { "0": 255, "1": 216, "2": 255 },
      mimeType: "image/jpeg",
      publicInstruction,
    });
    expect(persistedLog).toContain("screenshot-0001");
    expect(persistedLog).toContain("rawProviderOutput");
  });
});
