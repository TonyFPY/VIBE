import { describe, expect, it } from "vitest";

import type { ActionResult, AgentObservation, AgentTurn, ComputerAction } from "../../src/actions/contract";
import type { BackendEvent, BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import { parseHarnessConfig } from "../../src/config/load-config";
import { RunLoop } from "../../src/core/run-loop";
import type { RunLogEvent, RunLoggerPort } from "../../src/logging/run-logger";
import type { ComputerUseAgent } from "../../src/providers/computer-use-agent";

const baseConfig = parseHarnessConfig({
  taskUrl: "https://example.test/tasks/visual-similarity",
  participantId: "001",
  model: "google/gemini-3.7-flash",
  runMode: "dev",
  performance: { settleDelayMs: 0, requestTimeoutMs: 1000, totalRunTimeoutMs: 10_000 },
});

type ProviderCall =
  | { method: "next"; observation: AgentObservation }
  | { method: "reportActionResults"; observation: AgentObservation; results: readonly ActionResult[] };

function actionTurn(actions: readonly ComputerAction[], rawProviderOutput: unknown = { actions }): AgentTurn {
  return { status: "actions", actions, rawProviderOutput, providerIntent: "choose visible target" };
}

function finishedTurn(rawProviderOutput: unknown = { text: "finished" }): AgentTurn {
  return { status: "finished", actions: [], rawProviderOutput };
}

function blockedTurn(reason: string): AgentTurn {
  return { status: "blocked", actions: [], rawProviderOutput: { error: reason }, failureReason: reason };
}

function recoverableTurn(reason: string): AgentTurn {
  return { status: "recoverable", actions: [], rawProviderOutput: { error: reason }, failureReason: reason } as unknown as AgentTurn;
}

function setupBatch(x = 100, y = 100): AgentTurn {
  return actionTurn([{ type: "click", x, y }]);
}

function trialBatch(clickX = 756, clickY = 386): AgentTurn {
  return { ...actionTurn([
    ...Array.from({ length: 9 }, (_, index) => ({ type: "move" as const, x: 10 + index, y: 20 + index })),
    { type: "click", x: clickX, y: clickY },
  ]), actionBatchType: "trial" };
}

function navigationBatch(x = 200, y = 200): AgentTurn {
  return { ...actionTurn([{ type: "click", x, y }]), actionBatchType: "navigation" };
}

function waitBatch(): AgentTurn {
  return { ...actionTurn([{ type: "wait", milliseconds: 5000 }]), actionBatchType: "wait" as never };
}

function createFixture(
  turns: readonly AgentTurn[],
  options: {
    screenshots?: readonly Uint8Array[];
    nowMsValues?: readonly number[];
    onSession?: (session: BrowserSession & { emitBackendEvent(event: BackendEvent): void }) => void;
    screenshotError?: Error;
    hangProvider?: boolean;
    hangProviderCalls?: readonly number[];
    closeFailures?: ReadonlySet<string>;
    onReportActionResults?: (
      call: { observation: AgentObservation; results: readonly ActionResult[]; reportIndex: number },
      session: BrowserSession & { emitBackendEvent(event: BackendEvent): void },
    ) => void | Promise<void>;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const browserActions: Array<readonly [string, number, number]> = [];
  const providerCalls: ProviderCall[] = [];
  const events: RunLogEvent[] = [];
  const trace: string[] = [];
  const writtenScreenshots: Array<{ id: string; bytes: Uint8Array }> = [];
  const unsubscribes: string[] = [];
  const closeCalls: string[] = [];
  const sleeps: number[] = [];
  let resetCount = 0;
  let providerAttemptCount = 0;
  const screenshots = options.screenshots ?? [Uint8Array.from([1]), Uint8Array.from([2]), Uint8Array.from([3])];
  let screenshotCalls = 0;
  let turnIndex = 0;
  let reportIndex = 0;
  let listener: ((event: BackendEvent) => void) | undefined;

  const session: BrowserSession & { emitBackendEvent(event: BackendEvent): void } = {
    screenshot: async () => {
      if (options.screenshotError) throw options.screenshotError;
      const screenshot = screenshots[Math.min(screenshotCalls, screenshots.length - 1)];
      screenshotCalls += 1;
      trace.push(`screenshot-${screenshotCalls}`);
      return screenshot;
    },
    move: async (x, y) => {
      browserActions.push(["move", x, y]);
      trace.push(`move-${x}-${y}`);
    },
    click: async (x, y) => {
      browserActions.push(["click", x, y]);
      trace.push(`click-${x}-${y}`);
    },
    subscribeBackendEvents: (subscriber) => {
      listener = subscriber;
      return () => {
        unsubscribes.push("backend");
        if (options.closeFailures?.has("backend")) throw new Error("backend unsubscribe failed");
        if (listener === subscriber) listener = undefined;
      };
    },
    close: async () => {
      closeCalls.push("session");
      if (options.closeFailures?.has("session")) throw new Error("session close failed");
    },
    emitBackendEvent: (event) => { listener?.(event); },
  };
  options.onSession?.(session);

  const host: BrowserHost = {
    openSession: async () => session,
    close: async () => {
      closeCalls.push("host");
      if (options.closeFailures?.has("host")) throw new Error("host close failed");
    },
  };
  const agent: ComputerUseAgent = {
    provider: "fake-provider",
    model: "fake-model",
    next: async (observation) => {
      providerCalls.push({ method: "next", observation });
      providerAttemptCount += 1;
      if (options.hangProvider || options.hangProviderCalls?.includes(providerAttemptCount)) {
        return new Promise(() => undefined);
      }
      return turns[turnIndex++] ?? finishedTurn();
    },
    reportActionResults: async (observation, results) => {
      providerCalls.push({ method: "reportActionResults", observation, results });
      reportIndex += 1;
      providerAttemptCount += 1;
      await options.onReportActionResults?.({ observation, results, reportIndex }, session);
      if (options.hangProvider || options.hangProviderCalls?.includes(providerAttemptCount)) {
        return new Promise(() => undefined);
      }
      return turns[turnIndex++] ?? finishedTurn();
    },
    resetContext: async () => {
      resetCount += 1;
    },
    close: async () => {
      closeCalls.push("agent");
      if (options.closeFailures?.has("agent")) throw new Error("agent close failed");
    },
  };
  const logger: RunLoggerPort = {
    log: async (event) => { events.push(event); },
    writeScreenshot: async (id, bytes) => { writtenScreenshots.push({ id, bytes }); },
    close: async () => {
      closeCalls.push("logger");
      if (options.closeFailures?.has("logger")) throw new Error("logger close failed");
    },
  };
  let nowIndex = 0;
  const nowMs = () => {
    const values = options.nowMsValues ?? [0];
    return values[Math.min(nowIndex++, values.length - 1)];
  };
  const wait = options.wait ?? (async (milliseconds: number) => { sleeps.push(milliseconds); });

  return {
    loop: new RunLoop({ browserHost: host, agent, logger, nowMs, nowIso: () => "2026-08-17T12:00:00.000Z", sleep: wait }),
    browserActions, closeCalls, events, providerCalls, resetCount: () => resetCount, screenshotCalls: () => screenshotCalls, session, sleeps, trace, unsubscribes, writtenScreenshots,
  };
}

describe("trial-boundary computer-use run loop", () => {
  it("captures instructions before fixation, executes Start, and reports its complete result list with the first trial screenshot", async () => {
    const instructions = Uint8Array.from([1]);
    const trial = Uint8Array.from([2]);
    const run = createFixture([setupBatch(), finishedTurn()], { screenshots: [instructions, trial] });

    await expect(run.loop.run(baseConfig, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "incomplete", stepCount: 2, observationCount: 2, actionCount: 1,
    });
    expect(run.providerCalls[0]).toEqual({ method: "next", observation: expect.objectContaining({ screenshot: instructions }) });
    expect(run.providerCalls[1]).toMatchObject({
      method: "reportActionResults", observation: expect.objectContaining({ screenshot: trial }),
      results: [{ action: { type: "click", x: 100, y: 100 }, status: "executed" }],
    });
    expect(run.trace).toEqual(["screenshot-1", "click-100-100", "move-540-337.5", "click-540-337.5", "screenshot-2"]);
  });

  it("executes each 10-action trial batch before one continuation screenshot with no intermediate screenshots", async () => {
    const run = createFixture([setupBatch(), trialBatch(), finishedTurn()]);

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete", stepCount: 3, observationCount: 3, actionCount: 11, invalidActionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults", "next"]);
    expect(run.providerCalls[2]).toMatchObject({
      observation: expect.objectContaining({ screenshot: Uint8Array.from([3]) }),
    });
    expect(run.resetCount()).toBe(1);
    expect(run.screenshotCalls()).toBe(3);
    expect(run.trace).toEqual([
      "screenshot-1", "click-100-100", "move-540-337.5", "click-540-337.5", "screenshot-2",
      ...Array.from({ length: 9 }, (_, index) => `move-${10 + index}-${20 + index}`),
      "click-756-386", "move-540-337.5", "click-540-337.5", "screenshot-3",
    ]);
    expect(run.sleeps).toEqual([0, 0]);
  });

  it("starts a fresh provider interaction after a successful trial batch", async () => {
    const run = createFixture([setupBatch(), trialBatch(), trialBatch(700, 300)], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 700 && y === 300) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "completed", actionCount: 21, invalidActionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults", "next"]);
    expect(run.resetCount()).toBe(1);
  });

  it("stops after a successful final trial click before fixation or another provider request", async () => {
    const run = createFixture([setupBatch(), trialBatch()], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "completed", stepCount: 2, observationCount: 2, actionCount: 11, failureReason: undefined,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults"]);
    expect(run.browserActions.at(-1)).toEqual(["click", 756, 386]);
  });

  it("accepts a single navigation click for Continue after trial batches", async () => {
    const run = createFixture([setupBatch(), trialBatch(), navigationBatch(), trialBatch(700, 300)], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 700 && y === 300) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "completed", actionCount: 22, invalidActionCount: 0,
    });
    expect(run.browserActions).toContainEqual(["click", 200, 200]);
  });

  it("waits for a preparing screen and captures a fresh screenshot without an extra fixation click", async () => {
    const run = createFixture([setupBatch(), waitBatch(), trialBatch()], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "completed", actionCount: 12, observationCount: 3, invalidActionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults", "reportActionResults"]);
    expect(run.sleeps).toEqual([0, 5000, 0, 0]);
    expect(run.browserActions.filter(([type]) => type === "click")).toEqual([
      ["click", 100, 100],
      ["click", 540, 337.5],
      ["click", 756, 386],
    ]);
  });

  it("reports each action in a short trial batch as rejected without changing the screenshot and then retries", async () => {
    const run = createFixture([setupBatch(), actionTurn([{ type: "click", x: 300, y: 300 }]), trialBatch()], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "completed", actionCount: 11, invalidActionCount: 1, observationCount: 2,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults", "reportActionResults"]);
    expect(run.providerCalls[2]).toMatchObject({
      observation: run.providerCalls[1].observation,
      results: [{ action: { type: "click", x: 300, y: 300 }, status: "rejected", error: "Trial batch must contain at least 10 actions" }],
    });
    expect(run.browserActions).not.toContainEqual(["click", 300, 300]);
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "action", actionValid: false, batchIndex: 1, batchSize: 1, error: "Trial batch must contain at least 10 actions",
    }));
  });

  it("rejects an invalid setup batch without applying it and retries setup", async () => {
    const run = createFixture([actionTurn([{ type: "click", x: 1080, y: 100 }]), setupBatch(), finishedTurn()]);

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete", actionCount: 1, invalidActionCount: 1, observationCount: 2,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults", "reportActionResults"]);
    expect(run.providerCalls[1]).toMatchObject({
      observation: run.providerCalls[0].observation,
      results: [{ action: { type: "click", x: 1080, y: 100 }, status: "rejected", error: "Invalid batch action: click coordinates must be finite CSS pixels inside the viewport" }],
    });
    expect(run.browserActions).not.toContainEqual(["click", 1080, 100]);
  });

  it("stops a browser-failed trial batch without executing later actions", async () => {
    const run = createFixture([setupBatch(), trialBatch()], {
      onSession: (session) => {
        const originalMove = session.move;
        session.move = async (x, y) => {
          await originalMove(x, y);
          if (x === 10 && y === 20) throw new Error("browser input failed");
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "failed", failureReason: "browser input failed", actionCount: 1, observationCount: 2,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults"]);
    expect(run.browserActions).toContainEqual(["move", 10, 20]);
    expect(run.browserActions).not.toContainEqual(["move", 11, 21]);
    expect(run.events).toContainEqual(expect.objectContaining({ type: "action", batchIndex: 1, batchSize: 10, actionValid: false, error: "browser input failed" }));
  });

  it("preserves provider block, provider finished, timeout, and step-limit terminal semantics", async () => {
    const blockedRun = createFixture([blockedTurn("safety blocked")]);
    await expect(blockedRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({ status: "failed", failureReason: "safety blocked", actionCount: 0 });

    const finishedRun = createFixture([finishedTurn()]);
    await expect(finishedRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({ status: "incomplete", failureReason: "provider finished before result response", actionCount: 0 });

    const timeoutRun = createFixture([setupBatch()], { nowMsValues: [0, 0, 0, 0, 10_000] });
    await expect(timeoutRun.loop.run({ ...baseConfig, performance: { ...baseConfig.performance, totalRunTimeoutMs: 1000 } }, "Visible instruction")).resolves.toMatchObject({ status: "timeout", failureReason: "total run timeout reached" });

    const stepLimitRun = createFixture([setupBatch(), trialBatch()]);
    await expect(stepLimitRun.loop.run({ ...baseConfig, maxSteps: 1 }, "Visible instruction")).resolves.toMatchObject({ status: "step_limit", failureReason: "action turn limit reached", actionCount: 1 });
  });

  it("retries a recoverable provider output with the same screenshot and executes only the corrected batch", async () => {
    const run = createFixture([recoverableTurn("malformed action"), setupBatch(), finishedTurn()]);

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete", stepCount: 3, observationCount: 2, actionCount: 1, invalidActionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "next", "reportActionResults"]);
    expect(run.providerCalls[1]).toMatchObject({
      method: "next",
      observation: expect.objectContaining({
        screenshot: Uint8Array.from([1]),
        publicInstruction: expect.stringContaining("previous model output was rejected"),
      }),
    });
    expect(run.browserActions).toEqual([["click", 100, 100], ["move", 540, 337.5], ["click", 540, 337.5]]);
    expect(run.resetCount()).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "provider-output-recovery",
      attempt: 1,
      maxAttempts: 3,
      reason: "malformed action",
    }));
  });

  it("stops as incomplete after three unsuccessful output recoveries without executing an invalid action", async () => {
    const run = createFixture([
      recoverableTurn("bad-1"),
      recoverableTurn("bad-2"),
      recoverableTurn("bad-3"),
      recoverableTurn("bad-4"),
    ]);

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete",
      failureReason: "model output recovery exhausted after 3 attempts: bad-4",
      actionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "next", "next", "next"]);
    expect(run.resetCount()).toBe(3);
    expect(run.browserActions).toEqual([]);
    expect(run.events.filter((event) => event.type === "provider-output-recovery")).toHaveLength(3);
  });

  it("preserves invalid-batch-limit and result-request-failure terminal semantics", async () => {
    const invalidLimitRun = createFixture([actionTurn([]), actionTurn([])]);
    await expect(invalidLimitRun.loop.run({ ...baseConfig, maxInvalidActions: 1 }, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete", failureReason: "invalid action limit reached", invalidActionCount: 1, actionCount: 0,
    });
    expect(invalidLimitRun.providerCalls[1]).toMatchObject({
      results: [{ action: { type: "wait", milliseconds: 0 }, status: "rejected", error: "Batch must contain at least one action" }],
    });

    const requestFailureRun = createFixture([setupBatch(), trialBatch()], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-request-failed", error: "network down" });
        };
      },
    });
    await expect(requestFailureRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "failed", failureReason: "result request failed", actionCount: 11,
    });
  });

  it("fails on screenshot and provider request errors", async () => {
    const browserRun = createFixture([], { screenshotError: new Error("screenshot unavailable") });
    await expect(browserRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({ status: "failed", failureReason: "screenshot unavailable" });

    const timeoutRun = createFixture([], { hangProvider: true });
    await expect(timeoutRun.loop.run({ ...baseConfig, performance: { ...baseConfig.performance, requestTimeoutMs: 1 } }, "Visible instruction")).resolves.toMatchObject({ status: "failed", failureReason: "agent request timeout" });
  });

  it("recovers once from a provider timeout by resetting context and starting a fresh request", async () => {
    const run = createFixture([setupBatch(), trialBatch(700, 300)], {
      hangProviderCalls: [2],
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 700 && y === 300) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run({ ...baseConfig, performance: { ...baseConfig.performance, requestTimeoutMs: 1 } }, "Visible instruction")).resolves.toMatchObject({
      status: "completed", actionCount: 11, invalidActionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResults", "next"]);
    expect(run.resetCount()).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({ type: "provider-timeout-recovery", method: "reportActionResults" }));
  });

  it("fails after the fresh request also times out", async () => {
    const run = createFixture([], { hangProviderCalls: [1, 2] });

    await expect(run.loop.run({ ...baseConfig, performance: { ...baseConfig.performance, requestTimeoutMs: 1 } }, "Visible instruction")).resolves.toMatchObject({
      status: "failed", failureReason: "agent request timeout", actionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "next"]);
    expect(run.resetCount()).toBe(1);
  });

  it("fails after three unsuccessful trial result responses", async () => {
    const run = createFixture([setupBatch(), trialBatch(700, 300), trialBatch(701, 301), trialBatch(702, 302)], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x >= 700 && x <= 702) session.emitBackendEvent({ type: "results-response", status: 500, ok: false });
        };
      },
    });
    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({ status: "failed", failureReason: "result response failed 3 times", actionCount: 31 });
  });

  it("keeps backend completion completed when cleanup fails and closes each resource once", async () => {
    const run = createFixture([setupBatch(), trialBatch()], {
      closeFailures: new Set(["backend", "agent", "session", "host", "logger"]),
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 204, ok: true });
        };
      },
    });
    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({ status: "completed", failureReason: undefined });
    expect(run.closeCalls).toEqual(["agent", "session", "host", "logger"]);
    expect(run.unsubscribes).toEqual(["backend"]);
    expect(run.events).toContainEqual(expect.objectContaining({ type: "cleanup-error", phase: "agent", error: "agent close failed" }));
    expect(run.events.at(-1)).toMatchObject({ type: "terminal", summary: expect.objectContaining({ status: "completed" }) });
  });

  it("does not serialize observations or response bodies into logs", async () => {
    const screenshot = Uint8Array.from(Buffer.from("SECRET_ANSWER_CANARY"));
    const run = createFixture([setupBatch(101, 101), finishedTurn()], { screenshots: [screenshot, Uint8Array.from([2])] });

    await run.loop.run(baseConfig, "Visible instruction");

    const serializedLog = JSON.stringify(run.events);
    expect(serializedLog).not.toContain("SECRET_ANSWER_CANARY");
    expect(run.events.some((event) => event.type === "observation")).toBe(false);
    expect(serializedLog).not.toContain("publicInstruction");
    expect(serializedLog).not.toContain('"0":83');
  });
});
