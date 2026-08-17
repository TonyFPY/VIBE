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

interface PageLikeCanaryFixture {
  body: { text: string };
  evaluate(): string;
  url(): string;
}

interface PrivateBoundaryFixture {
  privateTrial: { correctAnswer: string; sourcePath: string };
  internalTaskRecord: { answerKey: string; domText: string };
  pageLikeObject: PageLikeCanaryFixture;
  backend: {
    url: string;
    requestBody: { privateAnswer: string };
    responseBody: { privateAnswer: string };
  };
  providerBodies: {
    requestBody: { privateAnswer: string };
    responseBody: { privateAnswer: string };
  };
}

function pageLikeCanaryFixture(): PageLikeCanaryFixture {
  const pageLikeObject = { body: { text: canary } } as PageLikeCanaryFixture;
  Object.defineProperties(pageLikeObject, {
    evaluate: { value: () => `document.body ${canary}`, enumerable: false },
    url: {
      value: () => `https://example.test/tasks/visual-similarity?answer=${canary}`,
      enumerable: false,
    },
  });
  return pageLikeObject;
}

const privateFixture = {
  privateTrial: { correctAnswer: canary, sourcePath: `/private/${canary}.jpg` },
  internalTaskRecord: { answerKey: canary, domText: `<button>${canary}</button>` },
  pageLikeObject: pageLikeCanaryFixture(),
  backend: {
    url: `https://example.test/api/experiments/sessions?answer=${canary}`,
    requestBody: { privateAnswer: canary },
    responseBody: { privateAnswer: canary },
  },
  providerBodies: {
    requestBody: { privateAnswer: canary },
    responseBody: { privateAnswer: canary },
  },
} satisfies PrivateBoundaryFixture;

function interaction(steps: unknown[], id: string, fields: Record<string, unknown> = {}): unknown {
  return {
    id,
    status: "completed",
    steps,
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

function assertNoStructuralBoundaryLeak(label: string, value: unknown): void {
  const violations: string[] = [];
  const seen = new WeakSet<object>();
  const prohibitedKey = /^(page|evaluate|dom|html|url|body|requestBody|responseBody|correctAnswer|answerKey|sourcePath)$/i;
  const visit = (entry: unknown, path: string): void => {
    if (typeof entry === "string") {
      if (entry.includes(canary) || entry.includes("document.body")) violations.push(`${path} string`);
      return;
    }
    if (typeof entry === "function") {
      violations.push(`${path} function`);
      return;
    }
    if (typeof entry !== "object" || entry === null) return;
    if (seen.has(entry)) return;
    seen.add(entry);
    for (const key of Reflect.ownKeys(entry)) {
      const keyText = String(key);
      const childPath = `${path}.${keyText}`;
      if (prohibitedKey.test(keyText)) violations.push(`${childPath} key`);
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor) continue;
      if ("value" in descriptor) visit(descriptor.value, childPath);
      else {
        if (descriptor.get) violations.push(`${childPath} getter`);
        if (descriptor.set) violations.push(`${childPath} setter`);
      }
    }
  };
  visit(value, label);
  expect(violations, label).toEqual([]);
}

function assertObservationShape(observation: AgentObservation): void {
  expect(Object.keys(observation).sort()).toEqual(["mimeType", "publicInstruction", "screenshot"]);
  expect(observation.screenshot).toBeInstanceOf(Uint8Array);
  expect(observation.mimeType).toBe("image/jpeg");
  expect(observation.publicInstruction).toBe(publicInstruction);
}

class FakeGeminiTransport implements GeminiTransport {
  readonly requests: GeminiTransportRequest[] = [];
  private readonly responses: unknown[];

  constructor() {
    this.responses = [
      interaction([
        functionCall("click", { x: 250, y: 250, intent: "choose visible candidate" }, "call-1"),
      ], "interaction-1"),
      interaction([
        functionCall("click", { x: 750, y: 500, intent: "submit visible choice" }, "call-2"),
      ], "interaction-2"),
    ];
  }

  async invoke(request: GeminiTransportRequest): Promise<unknown> {
    assertNoStructuralBoundaryLeak("transport received request", request);
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
    assertObservationShape(observation);
    assertNoStructuralBoundaryLeak("agent received observation", observation);
    this.observations.push(observation);
    return this.delegate.next(observation, signal);
  }

  async reportActionResult(
    observation: AgentObservation,
    result: ActionResult,
    signal: AbortSignal,
  ): Promise<AgentTurn> {
    assertObservationShape(observation);
    assertNoStructuralBoundaryLeak("agent received continuation observation", observation);
    assertNoStructuralBoundaryLeak("agent received action result", result);
    this.observations.push(observation);
    this.actionResults.push(result);
    return this.delegate.reportActionResult(observation, result, signal);
  }

  async close(): Promise<void> {
    await this.delegate.close();
  }
}

class FakeEvaluatorSessionState implements BrowserHost {
  readonly evaluatorValues: unknown[] = [];
  private readonly backendListeners = new Set<(event: BackendEvent) => void>();
  private clickCount = 0;

  constructor(
    private readonly fixture: PrivateBoundaryFixture,
    private readonly recordDeliveredEvent: (event: BackendEvent) => void,
  ) {}

  async openSession(url: string, _viewport: { width: 1080; height: 675 }): Promise<BrowserSession> {
    this.evaluatorValues.push(this.evaluatePrivateRenderState(url));
    return {
      screenshot: async () => {
        return this.renderPublicScreenshot(url);
      },
      move: async () => undefined,
      click: async () => {
        this.clickCount += 1;
        if (this.clickCount === 2) {
          this.emitPublicBackendEvent(this.evaluatePrivateBackendResponse());
        }
        if (this.clickCount === 4) {
          this.emitPublicBackendEvent(this.evaluatePrivateBackendFailure());
        }
      },
      subscribeBackendEvents: (listener) => {
        this.backendListeners.add(listener);
        return () => this.backendListeners.delete(listener);
      },
      close: async () => undefined,
    };
  }

  async close(): Promise<void> {}

  private evaluatePrivateRenderState(url: string): unknown {
    return {
      url,
      privateTrial: this.fixture.privateTrial,
      internalTaskRecord: this.fixture.internalTaskRecord,
      pageLikeObject: this.fixture.pageLikeObject,
    };
  }

  private renderPublicScreenshot(url: string): Uint8Array {
    const rawRenderState = {
      ...this.evaluatePrivateRenderState(url),
      pageUrl: this.fixture.pageLikeObject.url(),
      pageText: this.fixture.pageLikeObject.evaluate(),
    };
    this.evaluatorValues.push(rawRenderState);
    return Uint8Array.from(screenshot);
  }

  private evaluatePrivateBackendResponse(): unknown {
    const rawResponse = {
      page: this.fixture.pageLikeObject,
      url: this.fixture.backend.url,
      requestBody: this.fixture.backend.requestBody,
      responseBody: this.fixture.backend.responseBody,
      status: 202,
      ok: false,
    };
    this.evaluatorValues.push(rawResponse);
    this.evaluatePrivateBackendFailure();
    return rawResponse;
  }

  private evaluatePrivateBackendFailure(): unknown {
    const rawFailure = {
      page: this.fixture.pageLikeObject,
      url: this.fixture.backend.url,
      requestBody: this.fixture.backend.requestBody,
      responseBody: this.fixture.backend.responseBody,
      error: `backend request failed ${this.fixture.privateTrial.correctAnswer}`,
    };
    this.evaluatorValues.push(rawFailure);
    return rawFailure;
  }

  private emitPublicBackendEvent(rawBackendResult: any): void {
    const event: BackendEvent = "status" in rawBackendResult
      ? { type: "results-response", status: rawBackendResult.status, ok: rawBackendResult.ok }
      : { type: "results-request-failed", error: "backend request failed" };
    this.emit(event);
  }

  private emit(event: BackendEvent): void {
    this.recordDeliveredEvent(event);
    for (const listener of this.backendListeners) listener(event);
  }
}

class RecordingRunLogger implements RunLoggerPort {
  readonly events: unknown[] = [];

  constructor(private readonly delegate: RunLoggerPort) {}

  async log(event: Parameters<RunLoggerPort["log"]>[0]): Promise<void> {
    assertNoStructuralBoundaryLeak("logger event before delegation", event);
    this.events.push(event);
    await this.delegate.log(event);
  }

  async writeScreenshot(screenshotId: string, bytes: Uint8Array): Promise<void> {
    await this.delegate.writeScreenshot(screenshotId, bytes);
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
    const realLogger: RunLoggerPort = await RunLogger.open({
      root: logRoot,
      runId: "boundary-run",
      sensitiveValues: [canary],
    });
    const logger = new RecordingRunLogger(realLogger);
    const deliveredBackendEvents: BackendEvent[] = [];
    let openedUrl = "";
    const evaluator = new FakeEvaluatorSessionState(privateFixture, (event) => {
      deliveredBackendEvents.push(event);
    });
    const browserHost: BrowserHost = {
      openSession: async (url, viewport) => {
        openedUrl = url;
        return evaluator.openSession(url, viewport);
      },
      close: () => evaluator.close(),
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

    expect(JSON.stringify(evaluator.evaluatorValues)).toContain(canary);
    expect(evaluator.evaluatorValues.length).toBeGreaterThanOrEqual(2);
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
    assertNoStructuralBoundaryLeak("observations", agent.observations);
    assertBoundaryValue("initial request", transport.requests[0]);
    assertNoStructuralBoundaryLeak("initial request", transport.requests[0]);
    assertBoundaryValue("continuation request", transport.requests[1]);
    assertNoStructuralBoundaryLeak("continuation request", transport.requests[1]);
    assertBoundaryValue("provider requests", transport.requests);
    assertNoStructuralBoundaryLeak("provider requests", transport.requests);
    assertBoundaryValue("action results", agent.actionResults);
    assertNoStructuralBoundaryLeak("action results", agent.actionResults);
    assertBoundaryValue("backend events", deliveredBackendEvents);
    assertNoStructuralBoundaryLeak("backend events", deliveredBackendEvents);
    assertBoundaryValue("persisted logs", persistedLog);
    assertBoundaryValue("recorded logger events", logger.events);
    assertNoStructuralBoundaryLeak("recorded logger events", logger.events);
    for (const event of persistedLog.trim().split("\n").map((line) => JSON.parse(line))) {
      assertNoStructuralBoundaryLeak("persisted log event", event);
    }
    expect(JSON.parse(JSON.stringify(agent.observations[0]))).toEqual({
      screenshot: { "0": 255, "1": 216, "2": 255 },
      mimeType: "image/jpeg",
      publicInstruction,
    });
    expect(persistedLog).toContain("screenshot-0001");
    expect(persistedLog).toContain("rawProviderOutput");
  });
});
