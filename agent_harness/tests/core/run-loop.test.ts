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
  | { method: "reportActionResult"; observation: AgentObservation; result: ActionResult };

function actionTurn(actions: readonly ComputerAction[], rawProviderOutput: unknown = { action: actions[0] }): AgentTurn {
  return { status: "actions", actions, rawProviderOutput, providerIntent: "choose visible target" };
}

function finishedTurn(rawProviderOutput: unknown = { text: "finished" }): AgentTurn {
  return { status: "finished", actions: [], rawProviderOutput };
}

function blockedTurn(reason: string): AgentTurn {
  return { status: "blocked", actions: [], rawProviderOutput: { error: reason }, failureReason: reason };
}

function createFixture(
  turns: readonly AgentTurn[],
  options: {
    screenshots?: readonly Uint8Array[];
    nowMsValues?: readonly number[];
    onSession?: (session: BrowserSession & { emitBackendEvent(event: BackendEvent): void }) => void;
    screenshotError?: Error;
    hangProvider?: boolean;
    clickError?: Error;
    closeFailures?: ReadonlySet<string>;
    onReportActionResult?: (
      call: { observation: AgentObservation; result: ActionResult; reportIndex: number },
      session: BrowserSession & { emitBackendEvent(event: BackendEvent): void },
    ) => void | Promise<void>;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const browserActions: unknown[] = [];
  const providerCalls: ProviderCall[] = [];
  const events: RunLogEvent[] = [];
  const writtenScreenshots: Array<{ id: string; bytes: Uint8Array }> = [];
  const unsubscribes: string[] = [];
  const closeCalls: string[] = [];
  const sleeps: number[] = [];
  const screenshots = options.screenshots ?? [
    Uint8Array.from([1, 2, 3]),
    Uint8Array.from([4, 5, 6]),
    Uint8Array.from([7, 8, 9]),
    Uint8Array.from([10, 11, 12]),
  ];
  let screenshotCalls = 0;
  let turnIndex = 0;
  let reportIndex = 0;
  let listener: ((event: BackendEvent) => void) | undefined;

  const session: BrowserSession & { emitBackendEvent(event: BackendEvent): void } = {
    screenshot: async () => {
      if (options.screenshotError) throw options.screenshotError;
      const screenshot = screenshots[Math.min(screenshotCalls, screenshots.length - 1)];
      screenshotCalls += 1;
      return screenshot;
    },
    move: async (x, y) => { browserActions.push(["move", x, y]); },
    click: async (x, y) => {
      browserActions.push(["click", x, y]);
      if (options.clickError) throw options.clickError;
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
      if (options.hangProvider) return new Promise(() => undefined);
      return turns[turnIndex++] ?? finishedTurn();
    },
    reportActionResult: async (observation, result) => {
      providerCalls.push({ method: "reportActionResult", observation, result });
      reportIndex += 1;
      await options.onReportActionResult?.({ observation, result, reportIndex }, session);
      if (options.hangProvider) return new Promise(() => undefined);
      return turns[turnIndex++] ?? finishedTurn();
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
    browserActions,
    closeCalls,
    events,
    providerCalls,
    screenshotCalls: () => screenshotCalls,
    session,
    sleeps,
    unsubscribes,
    writtenScreenshots,
  };
}

describe("stateful computer-use run loop", () => {
  it("executes move, click, and wait one at a time and reports a fresh screenshot after each", async () => {
    const first = Uint8Array.from([1]);
    const second = Uint8Array.from([2]);
    const third = Uint8Array.from([3]);
    const fourth = Uint8Array.from([4]);
    const run = createFixture([
      actionTurn([{ type: "move", x: 540, y: 338 }]),
      actionTurn([{ type: "click", x: 756, y: 386 }]),
      actionTurn([{ type: "wait", milliseconds: 125 }]),
      finishedTurn(),
    ], { screenshots: [first, second, third, fourth] });

    await expect(run.loop.run(baseConfig, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "incomplete",
      stepCount: 4,
      observationCount: 4,
      actionCount: 3,
      invalidActionCount: 0,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual([
      "next",
      "reportActionResult",
      "reportActionResult",
      "reportActionResult",
    ]);
    expect(run.providerCalls[0].observation.screenshot).toBe(first);
    expect(run.providerCalls[1]).toMatchObject({ result: { status: "executed", action: { type: "move" } } });
    expect(run.providerCalls[1].observation.screenshot).toBe(second);
    expect(run.providerCalls[2]).toMatchObject({ result: { status: "executed", action: { type: "click" } } });
    expect(run.providerCalls[2].observation.screenshot).toBe(third);
    expect(run.providerCalls[3]).toMatchObject({ result: { status: "executed", action: { type: "wait" } } });
    expect(run.providerCalls[3].observation.screenshot).toBe(fourth);
    expect(run.browserActions).toEqual([
      ["move", 540, 337.5], ["click", 540, 337.5],
      ["move", 540, 338],
      ["click", 756, 386],
      ["move", 540, 337.5], ["click", 540, 337.5],
    ]);
    expect(run.sleeps).toEqual([0, 0, 125, 0]);
  });

  it("performs deterministic center fixation without reporting it as an agent action", async () => {
    const run = createFixture([
      actionTurn([{ type: "click", x: 756, y: 386 }]),
      finishedTurn(),
    ]);

    await run.loop.run(baseConfig, "Choose using only the visible screen.");

    expect(run.browserActions).toEqual([
      ["move", 540, 337.5], ["click", 540, 337.5],
      ["click", 756, 386],
      ["move", 540, 337.5], ["click", 540, 337.5],
    ]);
    expect(run.providerCalls).toHaveLength(2);
    expect(run.providerCalls[1]).toMatchObject({
      method: "reportActionResult",
      result: { action: { type: "click", x: 756, y: 386 }, status: "executed" },
    });
  });

  it("completes on a successful result response without asking the agent for another turn", async () => {
    const run = createFixture([
      actionTurn([{ type: "click", x: 756, y: 386 }]),
      finishedTurn(),
    ], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "completed",
      stepCount: 1,
      actionCount: 1,
      failureReason: undefined,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next"]);
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "backend-event",
      status: 201,
      ok: true,
    }));
  });

  it("keeps backend success completed when cleanup fails", async () => {
    const run = createFixture([
      actionTurn([{ type: "click", x: 756, y: 386 }]),
      finishedTurn(),
    ], {
      closeFailures: new Set(["backend", "agent", "session", "host", "logger"]),
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 201, ok: true });
        };
      },
    });

    await expect(run.loop.run(baseConfig, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "completed",
      failureReason: undefined,
    });
    expect(run.closeCalls).toEqual(["agent", "session", "host", "logger"]);
    expect(run.unsubscribes).toEqual(["backend"]);
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "cleanup-error",
      phase: "agent",
      error: "agent close failed",
    }));
    expect(run.events.at(-1)).toMatchObject({
      type: "terminal",
      summary: expect.objectContaining({ status: "completed", failureReason: undefined }),
    });
  });

  it("fails when the provider blocks and preserves the provider reason", async () => {
    const run = createFixture([blockedTurn("safety blocked")]);

    await expect(run.loop.run(baseConfig, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "failed",
      failureReason: "safety blocked",
      actionCount: 0,
    });
  });

  it("marks provider finished before backend success as incomplete", async () => {
    const run = createFixture([finishedTurn()]);

    await expect(run.loop.run(baseConfig, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "incomplete",
      failureReason: "provider finished before result response",
      actionCount: 0,
    });
  });

  it("returns timeout at the total deadline and step_limit at the action-turn cap", async () => {
    const timeoutRun = createFixture([actionTurn([{ type: "move", x: 1, y: 1 }])], {
      nowMsValues: [0, 0, 0, 0, 10_000],
    });
    const shortDeadline = {
      ...baseConfig,
      performance: { ...baseConfig.performance, totalRunTimeoutMs: 1000 },
    };
    await expect(timeoutRun.loop.run(shortDeadline, "Visible instruction")).resolves.toMatchObject({
      status: "timeout",
      failureReason: "total run timeout reached",
      actionCount: 0,
    });

    const stepLimitRun = createFixture([
      actionTurn([{ type: "move", x: 1, y: 1 }]),
      actionTurn([{ type: "move", x: 2, y: 2 }]),
    ]);
    await expect(stepLimitRun.loop.run({ ...baseConfig, maxSteps: 1 }, "Visible instruction")).resolves.toMatchObject({
      status: "step_limit",
      failureReason: "action turn limit reached",
      actionCount: 1,
    });
  });

  it("fails on browser errors and provider request timeouts", async () => {
    const browserRun = createFixture([actionTurn([{ type: "move", x: 1, y: 1 }])], {
      screenshotError: new Error("screenshot unavailable"),
    });
    await expect(browserRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "failed",
      failureReason: "screenshot unavailable",
    });

    const timeoutRun = createFixture([], { hangProvider: true });
    const fastProviderTimeout = {
      ...baseConfig,
      performance: { ...baseConfig.performance, requestTimeoutMs: 1 },
    };
    await expect(timeoutRun.loop.run(fastProviderTimeout, "Visible instruction")).resolves.toMatchObject({
      status: "failed",
      failureReason: "agent request timeout",
    });
  });

  it("logs rejected multi-action, invalid coordinate, and invalid wait turns without browser execution", async () => {
    const run = createFixture([
      actionTurn([{ type: "move", x: 1, y: 1 }, { type: "click", x: 2, y: 2 }]),
      actionTurn([{ type: "click", x: 1080, y: 1 }]),
      actionTurn([{ type: "wait", milliseconds: 5001 }]),
      actionTurn([{ type: "move", x: 2, y: 2 }]),
    ]);

    await expect(run.loop.run({ ...baseConfig, maxInvalidActions: 3 }, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete",
      failureReason: "invalid action limit reached",
      actionCount: 0,
      invalidActionCount: 3,
    });
    expect(run.browserActions).toEqual([
      ["move", 540, 337.5], ["click", 540, 337.5],
    ]);
    expect(run.providerCalls.map((call) => call.method)).toEqual([
      "next",
      "reportActionResult",
      "reportActionResult",
      "reportActionResult",
    ]);
    expect(run.providerCalls.slice(1)).toEqual([
      expect.objectContaining({ result: expect.objectContaining({ status: "rejected" }) }),
      expect.objectContaining({ result: expect.objectContaining({ status: "rejected" }) }),
      expect.objectContaining({ result: expect.objectContaining({
        status: "rejected",
        error: "wait milliseconds must be finite and between 0 and 5000",
      }) }),
    ]);
    expect(run.providerCalls[1].observation.screenshot).toBe(run.providerCalls[0].observation.screenshot);
    expect(run.providerCalls[2].observation.screenshot).toBe(run.providerCalls[0].observation.screenshot);
    expect(run.providerCalls[3].observation.screenshot).toBe(run.providerCalls[0].observation.screenshot);
    expect(run.events.filter((event) => event.type === "action")).toEqual([
      expect.objectContaining({ actionValid: false, error: "Provider returned 2 actions; exactly one action is required" }),
      expect.objectContaining({ actionValid: false, error: "click coordinates must be finite CSS pixels inside the viewport" }),
      expect.objectContaining({ actionValid: false, error: "wait milliseconds must be finite and between 0 and 5000" }),
    ]);
  });

  it("preserves backend completion while reporting the final invalid action", async () => {
    const run = createFixture([
      actionTurn([{ type: "click", x: 1080, y: 1 }]),
      finishedTurn(),
    ], {
      onReportActionResult: ({ result }, session) => {
        expect(result).toMatchObject({
          status: "rejected",
          error: "click coordinates must be finite CSS pixels inside the viewport",
        });
        session.emitBackendEvent({ type: "results-response", status: 204, ok: true });
      },
    });

    await expect(run.loop.run({ ...baseConfig, maxInvalidActions: 1 }, "Visible instruction")).resolves.toMatchObject({
      status: "completed",
      failureReason: undefined,
      actionCount: 0,
      invalidActionCount: 1,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResult"]);
    expect(run.providerCalls[1].observation.screenshot).toBe(run.providerCalls[0].observation.screenshot);
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "backend-event",
      status: 204,
      ok: true,
    }));
  });

  it("preserves provider finished state while reporting the final invalid action", async () => {
    const run = createFixture([
      actionTurn([{ type: "click", x: 1080, y: 1 }]),
      finishedTurn(),
    ]);

    await expect(run.loop.run({ ...baseConfig, maxInvalidActions: 1 }, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete",
      failureReason: "provider finished before result response",
      actionCount: 0,
      invalidActionCount: 1,
    });
    expect(run.providerCalls.map((call) => call.method)).toEqual(["next", "reportActionResult"]);
    expect(run.providerCalls[1].observation.screenshot).toBe(run.providerCalls[0].observation.screenshot);
    expect(run.providerCalls[1]).toEqual(expect.objectContaining({
      result: expect.objectContaining({
        status: "rejected",
        error: "click coordinates must be finite CSS pixels inside the viewport",
      }),
    }));
  });

  it("fails after three failed result attempts or a result request failure", async () => {
    const failedResponsesRun = createFixture([
      actionTurn([{ type: "click", x: 756, y: 386 }]),
      actionTurn([{ type: "click", x: 756, y: 386 }]),
      actionTurn([{ type: "click", x: 756, y: 386 }]),
    ], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-response", status: 500, ok: false });
        };
      },
    });
    await expect(failedResponsesRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "failed",
      failureReason: "result response failed 3 times",
    });

    const requestFailedRun = createFixture([actionTurn([{ type: "click", x: 756, y: 386 }])], {
      onSession: (session) => {
        const originalClick = session.click;
        session.click = async (x, y) => {
          await originalClick(x, y);
          if (x === 756 && y === 386) session.emitBackendEvent({ type: "results-request-failed", error: "network down" });
        };
      },
    });
    await expect(requestFailedRun.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "failed",
      failureReason: "result request failed",
    });
  });

  it("closes the agent, browser session, backend subscription, logger, and browser host exactly once", async () => {
    const run = createFixture([actionTurn([{ type: "click", x: 1, y: 1 }])], {
      clickError: new Error("browser input failed"),
    });

    await expect(run.loop.run(baseConfig, "Visible instruction")).resolves.toMatchObject({
      status: "failed",
      failureReason: "browser input failed",
    });
    expect(run.closeCalls).toEqual(["agent", "session", "host", "logger"]);
    expect(run.unsubscribes).toEqual(["backend"]);
    expect(run.events.at(-1)).toMatchObject({ type: "terminal" });
  });

  it("does not serialize observations or response bodies into logs", async () => {
    const screenshot = Uint8Array.from(Buffer.from("SECRET_ANSWER_CANARY"));
    const run = createFixture([
      actionTurn([{ type: "move", x: 1, y: 1 }], { body: "safe provider text" }),
      finishedTurn(),
    ], {
      screenshots: [screenshot, Uint8Array.from([2])],
      onSession: (session) => {
        const originalMove = session.move;
        session.move = async (x: number, y: number) => {
          await originalMove(x, y);
          if (x === 1 && y === 1) session.emitBackendEvent({ type: "results-response", status: 202, ok: false });
        };
      },
    });

    await run.loop.run(baseConfig, "Visible instruction");

    const serializedLog = JSON.stringify(run.events);
    expect(serializedLog).not.toContain("SECRET_ANSWER_CANARY");
    expect(run.events.some((event) => event.type === "observation")).toBe(false);
    expect(serializedLog).not.toContain("publicInstruction");
    expect(serializedLog).not.toContain('"0":83');
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "provider-turn",
      provider: "fake-provider",
      model: "fake-model",
      rawProviderOutput: { body: "[REDACTED]" },
    }));
    expect(run.events).toContainEqual(expect.objectContaining({
      type: "backend-event",
      status: 202,
      ok: false,
    }));
  });
});
