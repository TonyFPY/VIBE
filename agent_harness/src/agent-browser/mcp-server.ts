import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  MAX_TRAJECTORY_WAYPOINTS,
  MIN_TRAJECTORY_WAYPOINTS,
  validatePointerAction,
  validateTrajectoryAction,
  validateWaitAction,
} from "./action-policy";
import type { AgentBrowserConfig } from "./run-config";
import type { BrowserHost, BrowserSession } from "../browser/browser-types";
import type { RunLogEvent, RunLoggerPort } from "../logging/run-logger";

export interface VisualBrowserToolsetOptions {
  config: AgentBrowserConfig;
  browserHost: BrowserHost;
  logger: RunLoggerPort;
}

export type ToolActionResult = { ok: true } | { ok: false; message: string };
type PointerPoint = { x: number; y: number };
type PointerAction = PointerPoint & { type: "move" | "click" };
type PointerMoveAction = PointerPoint & { type: "move" };
type TrajectoryActionResult = { ok: true; end: PointerPoint } | { ok: false; message: string };

const pointerInputSchema = z.object({
  type: z.enum(["move", "click"]).describe("must match the MCP tool"),
  x: z.number().describe("visible CSS-pixel x coordinate"),
  y: z.number().describe("visible CSS-pixel y coordinate"),
}).passthrough();
const trajectoryInputSchema = z.object({
  waypoints: z.array(z.object({
    x: z.number().describe("visible CSS-pixel x coordinate"),
    y: z.number().describe("visible CSS-pixel y coordinate"),
  }).passthrough()).min(MIN_TRAJECTORY_WAYPOINTS).max(MAX_TRAJECTORY_WAYPOINTS),
}).passthrough();
const waitInputSchema = z.object({
  milliseconds: z.number().describe("wait duration from 0 through 5000 milliseconds"),
}).passthrough();

function now(): string {
  return new Date().toISOString();
}

function textResult(text: string, isError = false): { content: [{ type: "text"; text: string }]; isError?: true } {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function imageResult(bytes: Uint8Array): {
  content: [{ type: "image"; data: string; mimeType: "image/jpeg" }];
} {
  return {
    content: [{
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: "image/jpeg",
    }],
  };
}

export class VisualBrowserToolset {
  private sessionPromise?: Promise<BrowserSession>;
  private session?: BrowserSession;
  private unsubscribeBackendEvents?: () => void;
  private observationCount = 0;
  private hasObserved = false;
  private requiresObservation = true;
  private pendingMoves: PointerMoveAction[] = [];
  private lastPointerPosition?: PointerPoint;
  private lastPointerSequenceSignature?: string;
  private repeatedPointerSequenceCount = 0;
  private abortedReason?: string;
  private operationQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: VisualBrowserToolsetOptions) {}

  beginMcpSession(): void {
    this.hasObserved = false;
    this.requiresObservation = true;
    this.pendingMoves = [];
    this.lastPointerSequenceSignature = undefined;
    this.repeatedPointerSequenceCount = 0;
    this.abortedReason = undefined;
  }

  async observe(): Promise<Uint8Array> {
    return this.runExclusive(() => this.captureObservation());
  }

  private async captureObservation(): Promise<Uint8Array> {
    const session = await this.ensureSession();
    const bytes = await session.screenshot(this.options.config.screenshotQuality);
    const screenshotId = "observation-" + String(this.observationCount + 1).padStart(6, "0");
    await this.options.logger.writeScreenshot(screenshotId, bytes);
    this.observationCount += 1;
    this.hasObserved = true;
    this.requiresObservation = false;
    await this.log({
      type: "observation",
      screenshotId,
      byteLength: bytes.byteLength,
    });
    return bytes;
  }

  async move(input: unknown): Promise<ToolActionResult> {
    return this.runExclusive(() => this.pointerAction("move", input));
  }

  async moveTrajectory(input: unknown): Promise<TrajectoryActionResult> {
    return this.runExclusive(() => this.trajectoryAction(input));
  }

  async click(input: unknown): Promise<ToolActionResult> {
    return this.runExclusive(() => this.pointerAction("click", input));
  }

  async wait(milliseconds: unknown): Promise<{ ok: true; screenshot: Uint8Array } | { ok: false; message: string }> {
    return this.runExclusive(async () => {
      const validation = validateWaitAction(milliseconds);
      if (!validation.valid) {
        await this.log({
          type: "action-rejected",
          actionType: "wait",
          error: validation.error,
        });
        return { ok: false, message: "Invalid wait action" };
      }
      if (this.abortedReason) {
        await this.log({ type: "action-rejected", actionType: "wait", error: "Run stopped after abnormal pointer behavior" });
        return { ok: false, message: "Run stopped after abnormal pointer behavior" };
      }
      try {
        const waitMilliseconds = (milliseconds as { milliseconds: number }).milliseconds;
        await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
        await this.log({ type: "wait", milliseconds: waitMilliseconds });
        return { ok: true, screenshot: await this.captureObservation() };
      } catch {
        await this.log({ type: "action-failed", actionType: "wait" });
        return { ok: false, message: "Browser action failed" };
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const session = this.sessionPromise
      ? this.session ?? await this.sessionPromise.catch(() => undefined)
      : this.session;
    if (this.unsubscribeBackendEvents) {
      this.unsubscribeBackendEvents();
      this.unsubscribeBackendEvents = undefined;
    }
    try {
      if (session) await session.close();
    } catch {
      // The browser may already have closed during MCP process shutdown.
    }
    try {
      await this.options.browserHost.close();
    } catch {
      // Cleanup is best effort once the model transport is closing.
    }
    try {
      await this.options.logger.close();
    } catch {
      // Cleanup is best effort once the model transport is closing.
    }
  }

  private async pointerAction(
    actionType: "move" | "click",
    input: unknown,
  ): Promise<ToolActionResult> {
    const validation = validatePointerAction(input, this.options.config.viewport);
    if (!validation.valid) {
      await this.log({
        type: "action-rejected",
        actionType,
        error: validation.error,
      });
      return { ok: false, message: "Invalid pointer action" };
    }
    if (this.abortedReason) {
      await this.log({ type: "action-rejected", actionType, error: "Run stopped after abnormal pointer behavior" });
      return { ok: false, message: "Run stopped after abnormal pointer behavior" };
    }
    if (!this.hasObserved || this.requiresObservation) {
      await this.log({
        type: "action-rejected",
        actionType,
        error: "Fresh visible observation required before pointer input",
      });
      return { ok: false, message: "Fresh visible observation required before pointer input" };
    }
    const action = input as PointerAction;
    if (action.type !== actionType) {
      await this.log({ type: "action-rejected", actionType, error: "Action type does not match tool" });
      return { ok: false, message: "Invalid pointer action" };
    }
    if (actionType === "click") {
      const sequence = [...this.pendingMoves, action];
      const signature = this.pointerSequenceSignature(sequence);
      const nextRepeatCount = signature === this.lastPointerSequenceSignature
        ? this.repeatedPointerSequenceCount + 1
        : 1;
      if (this.pendingMoves.length > 0 && nextRepeatCount >= this.options.config.repeatedSequenceLimit) {
        await this.log({
          type: "abnormal-sequence-detected",
          repeatCount: nextRepeatCount,
          actionCount: sequence.length,
        });
        this.abortedReason = "repeated-pointer-sequence";
        await this.log({ type: "run-aborted", reason: this.abortedReason });
        return { ok: false, message: "Run stopped: repeated pointer sequence detected" };
      }
      if (this.pendingMoves.length > 0) {
        this.lastPointerSequenceSignature = signature;
        this.repeatedPointerSequenceCount = nextRepeatCount;
      }
    }
    try {
      const session = await this.ensureSession();
      if (actionType === "move") {
        await session.move(action.x, action.y);
        this.pendingMoves.push(action as PointerMoveAction);
        this.lastPointerPosition = { x: action.x, y: action.y };
      } else {
        await session.click(action.x, action.y);
        this.pendingMoves = [];
        this.lastPointerPosition = { x: action.x, y: action.y };
        this.requiresObservation = true;
      }
      await this.log({
        type: "action-executed",
        actionType,
        x: action.x,
        y: action.y,
      });
      return { ok: true };
    } catch {
      await this.log({ type: "action-failed", actionType });
      return { ok: false, message: "Browser action failed" };
    }
  }

  private async trajectoryAction(input: unknown): Promise<TrajectoryActionResult> {
    const validation = validateTrajectoryAction(input, this.options.config.viewport);
    if (!validation.valid) {
      await this.log({
        type: "action-rejected",
        actionType: "move_trajectory",
        error: validation.error,
      });
      return { ok: false, message: "Invalid pointer trajectory" };
    }
    if (this.abortedReason) {
      await this.log({
        type: "action-rejected",
        actionType: "move_trajectory",
        error: "Run stopped after abnormal pointer behavior",
      });
      return { ok: false, message: "Run stopped after abnormal pointer behavior" };
    }
    if (!this.hasObserved || this.requiresObservation) {
      await this.log({
        type: "action-rejected",
        actionType: "move_trajectory",
        error: "Fresh visible observation required before pointer input",
      });
      return { ok: false, message: "Fresh visible observation required before pointer input" };
    }
    if (!this.lastPointerPosition) {
      const error = "Trajectory requires a current pointer position from the fixation click";
      await this.log({ type: "action-rejected", actionType: "move_trajectory", error });
      return { ok: false, message: error };
    }

    const waypoints = (input as { waypoints: PointerPoint[] }).waypoints;
    const start = this.lastPointerPosition;
    let executedWaypointCount = 0;
    try {
      const session = await this.ensureSession();
      for (const waypoint of waypoints) {
        // These moves are deliberately sequential inside one MCP request. The
        // model pays one tool round trip while the browser still sees the
        // complete ordered trajectory.
        await session.move(waypoint.x, waypoint.y);
        this.pendingMoves.push({ type: "move", x: waypoint.x, y: waypoint.y });
        this.lastPointerPosition = { x: waypoint.x, y: waypoint.y };
        executedWaypointCount += 1;
      }
      const end = waypoints[waypoints.length - 1];
      await this.log({
        type: "trajectory-executed",
        start,
        waypoints,
        end,
      });
      const clickResult = await this.pointerAction("click", {
        type: "click",
        x: end.x,
        y: end.y,
      });
      if (!clickResult.ok) return clickResult;
      return { ok: true, end };
    } catch {
      await this.log({
        type: "action-failed",
        actionType: "move_trajectory",
        executedWaypointCount,
      });
      return { ok: false, message: "Browser action failed" };
    }
  }

  private pointerSequenceSignature(actions: readonly PointerAction[]): string {
    return JSON.stringify(actions.map(({ type, x, y }) => ({ type, x, y })));
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async ensureSession(): Promise<BrowserSession> {
    if (this.closed) throw new Error("Browser toolset is closed");
    this.sessionPromise ??= this.openSession();
    return this.sessionPromise;
  }

  private async openSession(): Promise<BrowserSession> {
    const session = await this.options.browserHost.openSession(
      this.options.config.url,
      this.options.config.viewport,
    );
    this.session = session;
    this.unsubscribeBackendEvents = session.subscribeBackendEvents((event) => {
      if (event.type === "results-response") {
        void this.log({ type: "backend-event", status: event.status, ok: event.ok });
      } else {
        void this.log({ type: "backend-event", error: "result request failed" });
      }
    });
    await this.log({
      type: "browser-session-opened",
      headless: this.options.config.headless,
      viewport: this.options.config.viewport,
    });
    return session;
  }

  private async log(fields: { type: string; [key: string]: unknown }): Promise<void> {
    const event: RunLogEvent = { ...fields, at: now() };
    await this.options.logger.log(event);
  }
}

export function createVisualBrowserMcpServer(toolset: VisualBrowserToolset): McpServer {
  const server = new McpServer(
    { name: "visual-agent-browser", version: "1.0.0" },
    {
      instructions: [
        "This server exposes only the visible experiment screen and pointer actions.",
        "Use observe to see the screen. Use click for fixation and response clicks, and move_trajectory for one ordered visible path through intermediate CSS-pixel waypoints.",
        "Use wait for loading states. Do not expect DOM, source, network, filesystem, or hidden task information.",
        "After every click, call observe or wait and receive a fresh screenshot before any further pointer input.",
        "For a response path, call move_trajectory once after the fixation screenshot; it executes the path and clicks the final waypoint before returning.",
        "Do not pre-plan or replay multiple trials. Choose each response from its newest screenshot.",
        "If the server reports repeated pointer behavior or a stopped run, stop and report the run as incomplete.",
      ].join(" "),
    },
  );

  server.registerTool("observe", {
    description: "Capture the current rendered experiment screen as a JPEG image.",
  }, async () => {
    try {
      return imageResult(await toolset.observe());
    } catch {
      return textResult("Browser observation failed", true);
    }
  });

  server.registerTool("move", {
    description: "Move the visible pointer to CSS-pixel coordinates in the 1080x675 viewport.",
    inputSchema: pointerInputSchema,
  }, async (input) => {
    const result = await toolset.move(input);
    return result.ok ? textResult("Pointer moved") : textResult(result.message, true);
  });

  server.registerTool("move_trajectory", {
    description: "Move from the current pointer position through 5 to 25 ordered visible CSS-pixel waypoints, then click the final point before returning. Use intermediate points for the response trajectory and make the final point the chosen response.",
    inputSchema: trajectoryInputSchema,
  }, async (input) => {
    const result = await toolset.moveTrajectory(input);
    return result.ok
      ? textResult(`Pointer trajectory and response click completed at (${result.end.x}, ${result.end.y})`)
      : textResult(result.message, true);
  });

  server.registerTool("click", {
    description: "Click the visible page at CSS-pixel coordinates in the 1080x675 viewport.",
    inputSchema: pointerInputSchema,
  }, async (input) => {
    const result = await toolset.click(input);
    return result.ok ? textResult("Pointer clicked") : textResult(result.message, true);
  });

  server.registerTool("wait", {
    description: "Wait 0 to 5000 milliseconds, then return a fresh visible screenshot.",
    inputSchema: waitInputSchema,
  }, async (input) => {
    const result = await toolset.wait(input);
    return result.ok ? imageResult(result.screenshot) : textResult(result.message, true);
  });

  return server;
}
