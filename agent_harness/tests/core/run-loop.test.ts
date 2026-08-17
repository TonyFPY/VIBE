import { describe, expect, it } from "vitest";

import type { BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import { parseHarnessConfig } from "../../src/config/load-config";
import { RunLoop } from "../../src/core/run-loop";
import type { RunLogEvent, RunLoggerPort } from "../../src/logging/run-logger";
import type { ModelAdapter, ModelRequest } from "../../src/providers/model-adapter";

const config = parseHarnessConfig({
  taskUrl: "https://example.test/tasks/visual-similarity",
  participantId: "001",
  model: "google/gemini-3.5-flash",
  location: "global",
  runMode: "dev",
  performance: { settleDelayMs: 0 },
});

function fixture(rawOutputs: string[]) {
  const browserActions: unknown[] = [];
  const screenshots = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6]), Uint8Array.from([7, 8, 9])];
  let screenshotCalls = 0;
  const session: BrowserSession = {
    screenshot: async () => screenshots[Math.min(screenshotCalls++, screenshots.length - 1)],
    move: async (x, y) => { browserActions.push(["MOVE", x, y]); },
    click: async (x, y) => { browserActions.push(["CLICK", x, y]); },
    close: async () => { browserActions.push(["CLOSE"]); },
  };
  const host: BrowserHost = {
    openSession: async () => session,
    close: async () => undefined,
  };
  const requests: ModelRequest[] = [];
  let outputIndex = 0;
  const model: ModelAdapter = {
    provider: "google-agent-platform",
    model: "google/gemini-3.5-flash",
    generateAction: async (request) => {
      requests.push(request);
      return {
        rawOutput: rawOutputs[outputIndex++] ?? '{"type":"DONE"}',
        startedAt: "2026-08-16T20:00:00.000Z",
        completedAt: "2026-08-16T20:00:01.000Z",
      };
    },
  };
  const events: RunLogEvent[] = [];
  const writtenScreenshots: Uint8Array[] = [];
  const logger: RunLoggerPort = {
    log: async (event) => { events.push(event); },
    writeScreenshot: async (_id, bytes) => { writtenScreenshots.push(bytes); },
    close: async () => undefined,
  };
  return {
    loop: new RunLoop({ browserHost: host, model, logger, sleep: async () => undefined }),
    browserActions,
    requests,
    events,
    writtenScreenshots,
    screenshotCalls: () => screenshotCalls,
  };
}

describe("serialized agent run loop", () => {
  it("executes one validated pointer action at a time until DONE", async () => {
    const run = fixture([
      '{"type":"MOVE","x":540,"y":338}',
      '{"type":"CLICK","x":756,"y":386,"purpose":"response"}',
      '{"type":"DONE"}',
    ]);

    await expect(run.loop.run(config, "Choose using only the visible screen.")).resolves.toMatchObject({
      status: "completed",
      stepCount: 3,
      observationCount: 3,
      actionCount: 2,
      invalidActionCount: 0,
    });
    expect(run.browserActions).toEqual([["MOVE", 540, 338], ["CLICK", 756, 386], ["CLOSE"]]);
    expect(run.writtenScreenshots).toHaveLength(3);
  });

  it("reuses unchanged JPEG bytes after invalid output and reports schema feedback", async () => {
    const run = fixture([
      "not-json",
      '{"type":"MOVE","x":1080,"y":675}',
      '{"type":"DONE"}',
    ]);

    const summary = await run.loop.run(config, "Choose using only the visible screen.");
    expect(summary).toMatchObject({ status: "completed", invalidActionCount: 2, observationCount: 1 });
    expect(run.screenshotCalls()).toBe(1);
    expect(run.requests[1].screenshot).toBe(run.requests[0].screenshot);
    expect(run.requests[1].validationFeedback).toContain("valid JSON");
    expect(run.requests[2].validationFeedback).toBe("coordinates outside viewport");
  });

  it("terminates incomplete at the invalid-action limit without executing input", async () => {
    const run = fixture(["bad", "bad"]);
    const limited = { ...config, maxInvalidActions: 2 };
    await expect(run.loop.run(limited, "Visible instruction")).resolves.toMatchObject({
      status: "incomplete",
      stepCount: 2,
      actionCount: 0,
      invalidActionCount: 2,
      failureReason: "invalid action limit reached",
    });
    expect(run.browserActions).toEqual([["CLOSE"]]);
  });
});
