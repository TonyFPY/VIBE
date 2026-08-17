import { executeComputerAction } from "../actions/executor";
import { validateComputerAction } from "../actions/policy";
import type { ActionResult, AgentObservation, AgentTurn, ComputerAction } from "../actions/contract";
import type { BackendEvent, BrowserHost, BrowserSession } from "../browser/browser-types";
import { buildTaskUrl } from "../config/load-config";
import type { HarnessConfig } from "../config/types";
import type { RunLoggerPort } from "../logging/run-logger";
import { TimingHistogram } from "../metrics/timing";
import type { ComputerUseAgent } from "../providers/computer-use-agent";
import type { RunSummary, RunTimingSummary } from "./run-state";

export interface RunLoopDependencies {
  browserHost: BrowserHost;
  agent: ComputerUseAgent;
  logger: RunLoggerPort;
  nowMs?: () => number;
  nowIso?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface BackendState {
  completed: boolean;
  failed: boolean;
  failedResultCount: number;
  failureReason?: string;
}

type ProviderMethod = "next" | "reportActionResult";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown harness failure";
}

function rejectedActionFor(actions: readonly ComputerAction[]): ComputerAction {
  return actions.length === 1 ? actions[0] : { type: "wait", milliseconds: 0 };
}

function rawProviderOutputWithoutResponseBodies(rawProviderOutput: unknown): unknown {
  if (typeof rawProviderOutput !== "object" || rawProviderOutput === null) return rawProviderOutput;
  if (Array.isArray(rawProviderOutput)) return rawProviderOutput.map(rawProviderOutputWithoutResponseBodies);
  return Object.fromEntries(Object.entries(rawProviderOutput).map(([key, value]) => [
    key,
    /response.?body|body/i.test(key) ? "[REDACTED]" : rawProviderOutputWithoutResponseBodies(value),
  ]));
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
    let summary: RunSummary = {
      status: "failed",
      stepCount: 0,
      observationCount: 0,
      actionCount: 0,
      invalidActionCount: 0,
      timings: timingSummary(),
      failureReason: "run did not start",
    };
    const backendState: BackendState = { completed: false, failed: false, failedResultCount: 0 };
    const backendLogPromises: Array<Promise<void>> = [];
    let session: BrowserSession | undefined;
    let unsubscribeBackendEvents: (() => void) | undefined;

    const setTerminalFromBackend = (): boolean => {
      if (backendState.completed) {
        summary = { ...summary, status: "completed", failureReason: undefined };
        return true;
      }
      if (backendState.failed) {
        summary = { ...summary, status: "failed", failureReason: backendState.failureReason };
        return true;
      }
      return false;
    };

    const setTimeoutIfExpired = (): boolean => {
      if (this.nowMs() - startedAtMs < config.performance.totalRunTimeoutMs) return false;
      summary = { ...summary, status: "timeout", failureReason: "total run timeout reached" };
      return true;
    };

    const setStepLimitIfReached = (): boolean => {
      if (summary.stepCount < config.maxSteps) return false;
      summary = { ...summary, status: "step_limit", failureReason: "action turn limit reached" };
      return true;
    };

    try {
      const url = buildTaskUrl(config);
      const navigationStartedAt = this.nowMs();
      session = await this.dependencies.browserHost.openSession(url, config.viewport);
      timing.navigation.observe(this.nowMs() - navigationStartedAt);
      unsubscribeBackendEvents = session.subscribeBackendEvents((event) => {
        this.handleBackendEvent(event, backendState);
        backendLogPromises.push(this.dependencies.logger.log({
          type: "backend-event",
          at: this.nowIso(),
          ...(event.type === "results-response"
            ? { status: event.status, ok: event.ok }
            : { ok: false, error: event.error }),
        }));
      });

      await this.beginFixation(session, config, summary, timing.actionAndLog);
      let observation = await this.captureObservation(session, config, publicInstruction, summary, timing.screenshotAndLog);
      summary = { ...summary, status: "incomplete", failureReason: "provider finished before result response" };
      let turn = await this.callProvider(
        "next",
        observation,
        undefined,
        config,
        timing.provider,
        summary,
        setTerminalFromBackend,
        setTimeoutIfExpired,
        setStepLimitIfReached,
      );

      while (turn) {
        if (setTerminalFromBackend() || setTimeoutIfExpired()) break;
        if (turn.status === "blocked") {
          summary = { ...summary, status: "failed", failureReason: turn.failureReason ?? "provider blocked" };
          break;
        }
        if (turn.status === "finished") {
          summary = { ...summary, status: "incomplete", failureReason: "provider finished before result response" };
          break;
        }

        const validationStartedAt = this.nowMs();
        const actionValidation = this.validateSingleAction(turn.actions, config);
        timing.parseAndValidate.observe(this.nowMs() - validationStartedAt);
        if (!actionValidation.valid) {
          summary.invalidActionCount += 1;
          const rejectedResult: ActionResult = {
            action: rejectedActionFor(turn.actions),
            status: "rejected",
            error: actionValidation.error,
          };
          await this.logAction(summary.stepCount, rejectedResult.action, false, actionValidation.error);
          if (summary.invalidActionCount >= config.maxInvalidActions) {
            summary = { ...summary, status: "incomplete", failureReason: "invalid action limit reached" };
            break;
          }
          turn = await this.callProvider(
            "reportActionResult",
            observation,
            rejectedResult,
            config,
            timing.provider,
            summary,
            setTerminalFromBackend,
            setTimeoutIfExpired,
            setStepLimitIfReached,
          );
          continue;
        }

        const action = actionValidation.action;
        const actionStartedAt = this.nowMs();
        const result = await executeComputerAction(session, action, this.sleep);
        await this.logAction(summary.stepCount, action, result.status === "executed", result.error);
        timing.actionAndLog.observe(this.nowMs() - actionStartedAt);
        if (result.status === "failed") {
          summary = { ...summary, status: "failed", failureReason: result.error };
          break;
        }
        summary.actionCount += 1;
        if (setTerminalFromBackend() || setTimeoutIfExpired()) break;
        const settleStartedAt = this.nowMs();
        await this.sleep(config.performance.settleDelayMs);
        timing.settle.observe(this.nowMs() - settleStartedAt);
        if (action.type === "click") {
          await this.beginFixation(session, config, summary, timing.actionAndLog);
        }
        if (setTerminalFromBackend() || setTimeoutIfExpired()) break;
        observation = await this.captureObservation(session, config, publicInstruction, summary, timing.screenshotAndLog);
        if (setTerminalFromBackend() || setTimeoutIfExpired() || setStepLimitIfReached()) break;
        turn = await this.callProvider(
          "reportActionResult",
          observation,
          result,
          config,
          timing.provider,
          summary,
          setTerminalFromBackend,
          setTimeoutIfExpired,
          setStepLimitIfReached,
        );
      }
    } catch (error) {
      if (summary.status !== "completed") {
        summary = { ...summary, status: "failed", failureReason: errorMessage(error) };
      }
    } finally {
      await Promise.allSettled(backendLogPromises);
      if (unsubscribeBackendEvents) {
        try {
          unsubscribeBackendEvents();
        } catch (error) {
          if (summary.status !== "failed") summary = { ...summary, status: "failed", failureReason: errorMessage(error) };
        }
      }
      for (const close of [
        () => this.dependencies.agent.close(),
        () => session?.close(),
        () => this.dependencies.browserHost.close(),
      ]) {
        try {
          await close();
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
    publicInstruction: string,
    summary: RunSummary,
    timing: TimingHistogram,
  ): Promise<AgentObservation> {
    const startedAt = this.nowMs();
    const screenshot = await session.screenshot(config.screenshotQuality);
    summary.observationCount += 1;
    const screenshotId = `screenshot-${String(summary.observationCount).padStart(4, "0")}`;
    await this.dependencies.logger.writeScreenshot(screenshotId, screenshot);
    await this.dependencies.logger.log({
      type: "screenshot",
      at: this.nowIso(),
      screenshotId,
      index: summary.observationCount,
      viewport: config.viewport,
      screenshotQuality: config.screenshotQuality,
    });
    timing.observe(this.nowMs() - startedAt);
    return { screenshot, mimeType: "image/jpeg", publicInstruction };
  }

  private async beginFixation(
    session: BrowserSession,
    config: HarnessConfig,
    summary: RunSummary,
    timing: TimingHistogram,
  ): Promise<void> {
    const startedAt = this.nowMs();
    const x = config.viewport.width / 2;
    const y = config.viewport.height / 2;
    await session.move(x, y);
    await session.click(x, y);
    await this.dependencies.logger.log({
      type: "fixation",
      at: this.nowIso(),
      step: summary.stepCount,
      x,
      y,
      purpose: "fixation",
      actionValid: true,
    });
    timing.observe(this.nowMs() - startedAt);
  }

  private validateSingleAction(
    actions: readonly ComputerAction[],
    config: HarnessConfig,
  ): { valid: true; action: ComputerAction } | { valid: false; error: string } {
    if (actions.length !== 1) {
      return { valid: false, error: `Provider returned ${actions.length} actions; exactly one action is required` };
    }
    const validation = validateComputerAction(actions[0], config.viewport);
    if (!validation.valid) return validation;
    return { valid: true, action: actions[0] };
  }

  private async logAction(
    step: number,
    action: ComputerAction,
    actionValid: boolean,
    error?: string,
  ): Promise<void> {
    await this.dependencies.logger.log({
      type: "action",
      at: this.nowIso(),
      step,
      parsedAction: action,
      actionValid,
      ...(error ? { error } : {}),
    });
  }

  private handleBackendEvent(event: BackendEvent, state: BackendState): void {
    if (event.type === "results-request-failed") {
      state.failed = true;
      state.failureReason = "result request failed";
      return;
    }
    if (event.ok && event.status >= 200 && event.status < 300) {
      state.completed = true;
      state.failureReason = undefined;
      return;
    }
    state.failedResultCount += 1;
    if (state.failedResultCount >= 3) {
      state.failed = true;
      state.failureReason = "result response failed 3 times";
    }
  }

  private async callProvider(
    method: ProviderMethod,
    observation: AgentObservation,
    result: ActionResult | undefined,
    config: HarnessConfig,
    timing: TimingHistogram,
    summary: RunSummary,
    setTerminalFromBackend: () => boolean,
    setTimeoutIfExpired: () => boolean,
    setStepLimitIfReached: () => boolean,
  ): Promise<AgentTurn | undefined> {
    if (setTerminalFromBackend() || setTimeoutIfExpired() || setStepLimitIfReached()) return undefined;
    summary.stepCount += 1;
    const providerStartedAtMs = this.nowMs();
    const providerStartedAt = this.nowIso();
    const turn = await this.requestWithTimeout(
      method === "next"
        ? (signal) => this.dependencies.agent.next(observation, signal)
        : (signal) => this.dependencies.agent.reportActionResult(observation, result!, signal),
      config.performance.requestTimeoutMs,
    );
    const providerCompletedAt = this.nowIso();
    timing.observe(this.nowMs() - providerStartedAtMs);
    await this.dependencies.logger.log({
      type: "provider-turn",
      at: providerCompletedAt,
      step: summary.stepCount,
      provider: this.dependencies.agent.provider,
      model: this.dependencies.agent.model,
      method,
      status: turn.status,
      providerIntent: turn.providerIntent,
      rawProviderOutput: rawProviderOutputWithoutResponseBodies(turn.rawProviderOutput),
      modelRequestStartedAt: providerStartedAt,
      modelResponseCompletedAt: providerCompletedAt,
    });
    return turn;
  }

  private async requestWithTimeout(
    request: (signal: AbortSignal) => Promise<AgentTurn>,
    timeoutMs: number,
  ): Promise<AgentTurn> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error("agent request timeout");
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([request(controller.signal), timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
