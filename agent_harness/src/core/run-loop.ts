import { parseAgentAction } from "../actions/contract";
import { executeAgentAction } from "../actions/executor";
import { validateActionBounds } from "../actions/policy";
import type { BrowserHost, BrowserSession } from "../browser/browser-types";
import { buildTaskUrl } from "../config/load-config";
import type { HarnessConfig } from "../config/types";
import type { RunLoggerPort } from "../logging/run-logger";
import { TimingHistogram } from "../metrics/timing";
import type { ModelAdapter, ModelRequest, ModelResponse } from "../providers/model-adapter";
import type { RunSummary, RunTimingSummary } from "./run-state";

export interface RunLoopDependencies {
  browserHost: BrowserHost;
  model: ModelAdapter;
  logger: RunLoggerPort;
  nowMs?: () => number;
  nowIso?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
}

const allowedActions = ["CLICK", "MOVE", "DONE"] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown harness failure";
}

function parseRawAction(rawOutput: string): ReturnType<typeof parseAgentAction> {
  let raw: unknown;
  try {
    raw = JSON.parse(rawOutput);
  } catch {
    return { valid: false, error: "Model output must be valid JSON" };
  }
  return parseAgentAction(raw);
}

export class RunLoop {
  private readonly nowMs: () => number;
  private readonly nowIso: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly dependencies: RunLoopDependencies) {
    this.nowMs = dependencies.nowMs ?? Date.now;
    this.nowIso = dependencies.nowIso ?? (() => new Date().toISOString());
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async run(config: HarnessConfig, publicInstruction: string): Promise<RunSummary> {
    const startedAtMs = this.nowMs();
    const timing = {
      navigation: new TimingHistogram(),
      screenshotAndLog: new TimingHistogram(),
      provider: new TimingHistogram(),
      parseAndValidate: new TimingHistogram(),
      actionAndLog: new TimingHistogram(),
      settle: new TimingHistogram(),
    };
    const timingSummary = (): RunTimingSummary => ({
      navigation: timing.navigation.summary(),
      screenshotAndLog: timing.screenshotAndLog.summary(),
      provider: timing.provider.summary(),
      parseAndValidate: timing.parseAndValidate.summary(),
      actionAndLog: timing.actionAndLog.summary(),
      settle: timing.settle.summary(),
    });
    let session: BrowserSession | undefined;
    let summary: RunSummary = {
      status: "failed",
      stepCount: 0,
      observationCount: 0,
      actionCount: 0,
      invalidActionCount: 0,
      timings: timingSummary(),
      failureReason: "run did not start",
    };

    try {
      const url = buildTaskUrl(config);
      const navigationStartedAt = this.nowMs();
      session = await this.dependencies.browserHost.openSession(url, config.viewport);
      timing.navigation.observe(this.nowMs() - navigationStartedAt);
      let screenshot = await this.captureObservation(session, config, summary, timing.screenshotAndLog);
      let validationFeedback: string | undefined;
      summary = { ...summary, status: "incomplete", failureReason: "step limit reached" };
      const rejectAction = async (error: string): Promise<boolean> => {
        validationFeedback = error;
        summary.invalidActionCount += 1;
        await this.dependencies.logger.log({
          type: "invalid-action",
          at: this.nowIso(),
          step: summary.stepCount,
          error,
        });
        if (summary.invalidActionCount < config.maxInvalidActions) return false;
        summary = { ...summary, status: "incomplete", failureReason: "invalid action limit reached" };
        return true;
      };

      while (summary.stepCount < config.maxSteps) {
        if (this.nowMs() - startedAtMs >= config.performance.totalRunTimeoutMs) {
          summary = { ...summary, status: "incomplete", failureReason: "total run timeout reached" };
          break;
        }
        summary.stepCount += 1;
        const modelRequest: ModelRequest = {
          screenshot,
          mimeType: "image/jpeg",
          publicInstruction,
          allowedActions,
          validationFeedback,
        };
        const providerStartedAt = this.nowMs();
        const modelResponse = await this.requestWithTimeout(modelRequest, config.performance.requestTimeoutMs);
        timing.provider.observe(this.nowMs() - providerStartedAt);
        await this.dependencies.logger.log({
          type: "model-response",
          at: this.nowIso(),
          step: summary.stepCount,
          provider: this.dependencies.model.provider,
          model: this.dependencies.model.model,
          rawOutput: modelResponse.rawOutput,
          usage: modelResponse.usage,
          modelRequestStartedAt: modelResponse.startedAt,
          modelResponseCompletedAt: modelResponse.completedAt,
        });

        const parseStartedAt = this.nowMs();
        const parsed = parseRawAction(modelResponse.rawOutput);
        if (!parsed.valid) {
          timing.parseAndValidate.observe(this.nowMs() - parseStartedAt);
          if (await rejectAction(parsed.error)) break;
          continue;
        }
        const policy = validateActionBounds(parsed.action, config.viewport);
        timing.parseAndValidate.observe(this.nowMs() - parseStartedAt);
        if (!policy.valid) {
          if (await rejectAction(policy.error)) break;
          continue;
        }

        validationFeedback = undefined;
        const actionStartedAt = this.nowMs();
        const execution = await executeAgentAction(session, parsed.action);
        await this.dependencies.logger.log({
          type: "action",
          at: this.nowIso(),
          step: summary.stepCount,
          parsedAction: parsed.action,
          actionValid: true,
        });
        timing.actionAndLog.observe(this.nowMs() - actionStartedAt);
        if (execution === "done") {
          summary = { ...summary, status: "completed", failureReason: undefined };
          break;
        }
        summary.actionCount += 1;
        const settleStartedAt = this.nowMs();
        await this.sleep(config.performance.settleDelayMs);
        timing.settle.observe(this.nowMs() - settleStartedAt);
        screenshot = await this.captureObservation(session, config, summary, timing.screenshotAndLog);
      }
    } catch (error) {
      summary = { ...summary, status: "failed", failureReason: errorMessage(error) };
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (error) {
          if (summary.status !== "failed") summary = { ...summary, status: "failed", failureReason: errorMessage(error) };
        }
      }
      summary = { ...summary, timings: timingSummary() };
      try {
        await this.dependencies.logger.log({ type: "terminal", at: this.nowIso(), summary });
      } finally {
        await this.dependencies.logger.close();
      }
    }
    return summary;
  }

  private async captureObservation(
    session: BrowserSession,
    config: HarnessConfig,
    summary: RunSummary,
    timing: TimingHistogram,
  ): Promise<Uint8Array> {
    const startedAt = this.nowMs();
    const screenshot = await session.screenshot(config.screenshotQuality);
    summary.observationCount += 1;
    const screenshotId = `screenshot-${String(summary.observationCount).padStart(4, "0")}`;
    await this.dependencies.logger.writeScreenshot(screenshotId, screenshot);
    await this.dependencies.logger.log({
      type: "observation",
      at: this.nowIso(),
      screenshotId,
      observation: summary.observationCount,
      viewport: config.viewport,
      screenshotQuality: config.screenshotQuality,
    });
    timing.observe(this.nowMs() - startedAt);
    return screenshot;
  }

  private async requestWithTimeout(request: ModelRequest, timeoutMs: number): Promise<ModelResponse> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error("model request timeout"));
        reject(new Error("model request timeout"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        this.dependencies.model.generateAction(request, controller.signal),
        timeoutPromise,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
