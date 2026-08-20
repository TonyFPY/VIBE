import type { ActionResult, AgentActionBatchType, AgentObservation, AgentRecoveryKind, AgentTurn, ComputerAction } from "../actions/contract";
import { MAX_BATCH_ACTIONS, MAX_TRIAL_MOVES, MIN_TRIAL_MOVES } from "../actions/policy";
import type { PerformanceConfig, Viewport } from "../config/types";
import type { ComputerUseAgent } from "./computer-use-agent";
import { DefaultGeminiTransport, GeminiHttpError, type GeminiTransport, type GeminiTransportRequest } from "./gemini-transport";

const EXCLUDED_PREDEFINED_FUNCTIONS = [
  "click", "move", "double_click", "triple_click", "middle_click", "right_click", "mouse_down", "mouse_up",
  "type", "drag_and_drop", "press_key", "key_down", "key_up", "hotkey", "take_screenshot",
  "scroll", "go_back", "navigate", "go_forward", "wait",
] as const;

const COMPUTER_USE_TOOL = {
  type: "computer_use",
  environment: "browser",
  enable_prompt_injection_detection: true,
  excluded_predefined_functions: EXCLUDED_PREDEFINED_FUNCTIONS,
} as const;

const NORMALIZED_X_SCHEMA = {
  type: "integer",
  minimum: 0,
  maximum: 999,
  description: "Integer normalized x coordinate in [0,999], not CSS pixels.",
} as const;

const NORMALIZED_Y_SCHEMA = {
  type: "integer",
  minimum: 0,
  maximum: 999,
  description: "Integer normalized y coordinate in [0,999], not CSS pixels.",
} as const;

const CUSTOM_POINTER_TOOLS = [
  {
    type: "function",
    name: "click_visible",
    description: "Click one visible setup or navigation target.",
    parameters: {
      type: "object",
      properties: {
        x: NORMALIZED_X_SCHEMA,
        y: NORMALIZED_Y_SCHEMA,
        intent: { type: "string" },
      },
      required: ["x", "y", "intent"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "click_fixation_marker",
    description: "Move to and click the visible fixation marker as the fixation step. Use only when the fixation-marker screen is visibly present; the next screenshot will show the response grid.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "submit_trial_actions",
    description: `Submit a visible pointer trajectory with ${MIN_TRIAL_MOVES} through ${MAX_TRIAL_MOVES} points. The final trajectory point is the one response click.`,
    parameters: {
      type: "object",
      properties: {
        trajectory: {
          type: "array",
          minItems: MIN_TRIAL_MOVES,
          maxItems: MAX_TRIAL_MOVES,
          items: {
            type: "object",
            properties: { x: NORMALIZED_X_SCHEMA, y: NORMALIZED_Y_SCHEMA },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
      },
      required: ["trajectory"],
      additionalProperties: false,
    },
  },
] as const;

const COMPUTER_USE_TOOLS = [COMPUTER_USE_TOOL, ...CUSTOM_POINTER_TOOLS] as const;

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const VIEWPORT: Viewport = { width: 1080, height: 675 };
const PUBLIC_INTERACTION_POLICY = [
  "Public harness interaction policy:",
  "Use click_visible for one visible setup or navigation click, including Start or Continue.",
  "Use the native wait_5_seconds action only when the visible screen says it is preparing or loading; it is not a trial response.",
  "Do not submit trial actions while a preparing or loading message is visible; wait until the fixation marker is visibly present.",
  "After a successful trial response, the browser harness captures the next cross-only screenshot before requesting the next action.",
  "If a fixation-marker screen is presented to you after a loading wait, call click_fixation_marker exactly once; the next screenshot will show the response grid.",
  "Do not use click_visible for the fixation marker or submit trial actions from the fixation-marker screen.",
  "After the fixation screenshot shows the stimuli, use submit_trial_actions.",
  "The response grid's middle tile labeled reference is not a response target; the final click must land on one of the surrounding candidate tiles, not the middle tile.",
  `On trial-response screens, use submit_trial_actions with ${MIN_TRIAL_MOVES} through ${MAX_TRIAL_MOVES} visible trajectory points; the final point is your response click.`,
  "For every custom pointer coordinate, provide an integer normalized x/y value from 0 through 999; these are not CSS pixels.",
  "Use no native pointer controls or other excluded controls.",
  "The harness remains authoritative if you violate this policy.",
].join(" ");

interface NativeFunctionCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface PendingFunctionCall {
  id: string;
  name: string;
  actionCount: number;
  safetyAcknowledgement: boolean;
}

interface NativeInteraction {
  id: string;
  steps: unknown[];
  status?: string;
  error?: unknown;
  errors?: unknown;
}

export interface GeminiComputerUseAgentOptions {
  apiKey: string;
  model: string;
  performance: PerformanceConfig;
  transport?: GeminiTransport;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): record is Record<string, number> {
  return typeof record[key] === "number" && Number.isFinite(record[key]);
}

function hasFiniteInteger(record: Record<string, unknown>, key: string): record is Record<string, number> {
  return hasFiniteNumber(record, key) && Number.isInteger(record[key]);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

type SafetyDisposition = "allowed" | "acknowledge" | "blocked";

function safetyDisposition(arguments_: Record<string, unknown>): SafetyDisposition | undefined {
  const safetyDecision = arguments_.safety_decision;
  if (safetyDecision === undefined) return "allowed";
  if (!isRecord(safetyDecision) || !hasOnlyKeys(safetyDecision, ["decision", "explanation"])) return undefined;
  if (typeof safetyDecision.decision !== "string") return undefined;
  if (safetyDecision.explanation !== undefined && typeof safetyDecision.explanation !== "string") return undefined;
  const decision = safetyDecision.decision.toLowerCase();
  if (decision === "regular" || decision === "allowed") return "allowed";
  if (decision === "require_confirmation" || decision === "requires_confirmation") return "acknowledge";
  if (decision === "blocked") return "blocked";
  return undefined;
}

function actionArguments(arguments_: Record<string, unknown>): Record<string, unknown> {
  const { safety_decision: _safetyDecision, ...rest } = arguments_;
  return rest;
}

function toBase64(screenshot: Uint8Array): string {
  return Buffer.from(screenshot).toString("base64");
}

function safeRawProviderOutput(response: unknown): unknown {
  const serialized = JSON.stringify(response);
  return serialized === undefined ? String(response) : response;
}

function byteLength(response: unknown): number {
  const serialized = JSON.stringify(response);
  return Buffer.byteLength(serialized === undefined ? String(response) : serialized, "utf8");
}

function nativeFunctionCall(value: unknown): NativeFunctionCall | undefined {
  if (!isRecord(value) || value.type !== "function_call" || typeof value.id !== "string" || typeof value.name !== "string") {
    return undefined;
  }
  if (!isRecord(value.arguments)) return undefined;
  return { id: value.id, name: value.name, arguments: value.arguments };
}

function requiresSafetyConfirmation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.requires_confirmation === true || value.prompt_injection_detected === true) return true;
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const decision = typeof value.decision === "string" ? value.decision.toLowerCase() : "";
  return (type.includes("safety") || type.includes("prompt"))
    && (decision === "requires_confirmation" || decision === "blocked" || decision === "prompt_blocked" || !decision);
}

function interactionParts(response: unknown): NativeInteraction | undefined {
  if (!isRecord(response) || typeof response.id !== "string" || !Array.isArray(response.steps)) return undefined;
  return {
    id: response.id,
    steps: response.steps,
    status: typeof response.status === "string" ? response.status : undefined,
    error: response.error,
    errors: response.errors,
  };
}

function hasProviderError(response: unknown): boolean {
  return isRecord(response) && (response.error !== undefined || response.errors !== undefined);
}

function blocked(rawProviderOutput: unknown, failureReason: string): AgentTurn {
  return { status: "blocked", actions: [], rawProviderOutput, failureReason };
}

function recoverable(
  rawProviderOutput: unknown,
  failureReason: string,
  recoveryKind: AgentRecoveryKind = "model-output",
): AgentTurn {
  return { status: "recoverable", actions: [], rawProviderOutput, failureReason, recoveryKind };
}

export function normalizeGeminiCoordinate(value: number, axis: "x" | "y", viewport: Viewport): number {
  if (!Number.isFinite(value) || value < 0 || value > 999) {
    throw new Error("Gemini coordinates must be finite normalized values from 0 through 999");
  }
  return Math.floor(value / 1000 * (axis === "x" ? viewport.width : viewport.height));
}

function normalizedPointerAction(
  type: "click" | "move",
  arguments_: Record<string, unknown>,
  requiresIntent = false,
): ComputerAction | undefined {
  const allowedKeys = requiresIntent ? ["x", "y", "intent"] : ["x", "y"];
  if (!hasOnlyKeys(arguments_, allowedKeys)) return undefined;
  if (!hasFiniteInteger(arguments_, "x") || !hasFiniteInteger(arguments_, "y")) return undefined;
  if (requiresIntent && typeof arguments_.intent !== "string") return undefined;
  try {
    return {
      type,
      x: normalizeGeminiCoordinate(arguments_.x, "x", VIEWPORT),
      y: normalizeGeminiCoordinate(arguments_.y, "y", VIEWPORT),
    };
  } catch {
    return undefined;
  }
}

function parseComputerAction(call: NativeFunctionCall): {
  actions: ComputerAction[];
  actionBatchType: AgentActionBatchType;
  intent?: string;
  safetyAcknowledgement: boolean;
} | undefined {
  const disposition = safetyDisposition(call.arguments);
  if (disposition === undefined || disposition === "blocked") return undefined;
  const safetyAcknowledgement = call.arguments.safety_decision !== undefined;
  const arguments_ = actionArguments(call.arguments);
  if (call.name === "wait_5_seconds") {
    return hasOnlyKeys(arguments_, [])
      ? { actions: [{ type: "wait", milliseconds: 5000 }], actionBatchType: "wait", safetyAcknowledgement }
      : undefined;
  }
  if (call.name === "click_visible") {
    const action = normalizedPointerAction("click", arguments_, true);
    return action
      ? { actions: [action], actionBatchType: "navigation", intent: arguments_.intent as string, safetyAcknowledgement }
      : undefined;
  }
  if (call.name === "click_fixation_marker") {
    return hasOnlyKeys(arguments_, [])
      ? {
          actions: [
            { type: "move", x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 },
            { type: "click", x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 },
          ],
          actionBatchType: "fixation",
          safetyAcknowledgement,
        }
      : undefined;
  }
  if (call.name !== "submit_trial_actions" || !hasOnlyKeys(arguments_, ["trajectory"])) return undefined;
  if (!Array.isArray(arguments_.trajectory)) return undefined;
  if (arguments_.trajectory.length < MIN_TRIAL_MOVES || arguments_.trajectory.length > MAX_TRIAL_MOVES) return undefined;
  const trajectory = arguments_.trajectory.map((point) => (
    isRecord(point) ? normalizedPointerAction("move", point) : undefined
  ));
  if (trajectory.some((point) => !point)) return undefined;
  const moves = trajectory as ComputerAction[];
  const finalMove = moves[moves.length - 1];
  if (finalMove.type !== "move") return undefined;
  return {
    actions: [...moves, { type: "click", x: finalMove.x, y: finalMove.y }],
    actionBatchType: "trial",
    safetyAcknowledgement,
  };
}

function isTransientHttpFailure(error: unknown): boolean {
  const status = httpStatus(error);
  return status !== undefined && TRANSIENT_HTTP_STATUSES.has(status);
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof GeminiHttpError) return error.status;
  if (!isRecord(error)) return undefined;
  if (typeof error.status === "number") return error.status;
  if (typeof error.statusCode === "number") return error.statusCode;
  const response = error.response;
  return isRecord(response) && typeof response.status === "number" ? response.status : undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return String(error);
}

function isProviderActionPolicyFailure(error: unknown): boolean {
  const message = errorText(error);
  const knownActionPolicyMessage = /unsupported action/i.test(message)
    || /test harness specific action/i.test(message)
    || (/cross-only screenshot/i.test(message) && /submit_trial_actions/i.test(message));
  return httpStatus(error) === 400
    && /input blocked/i.test(message)
    && knownActionPolicyMessage;
}

export class GeminiComputerUseAgent implements ComputerUseAgent {
  readonly provider = "gemini";
  readonly model: string;
  private readonly transport: GeminiTransport;
  private readonly now: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private previousInteractionId: string | undefined;
  private pendingCalls: PendingFunctionCall[] = [];
  private contextEpoch = 0;

  constructor(private readonly options: GeminiComputerUseAgentOptions) {
    this.model = options.model;
    this.transport = options.transport ?? new DefaultGeminiTransport(options.apiKey);
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn> {
    if (this.pendingCalls.length > 0) {
      return blocked(undefined, "Gemini function call result must be reported before the next observation");
    }
    const contextEpoch = this.contextEpoch;
    return this.invokeAndInterpret({
      model: this.apiModelId(),
      input: [
        { type: "text", text: `${observation.publicInstruction}\n\n${PUBLIC_INTERACTION_POLICY}` },
        { type: "image", data: toBase64(observation.screenshot), mime_type: observation.mimeType },
      ],
      tools: COMPUTER_USE_TOOLS,
    }, signal, contextEpoch);
  }

  async reportActionResults(
    observation: AgentObservation,
    results: readonly ActionResult[],
    signal: AbortSignal,
  ): Promise<AgentTurn> {
    if (this.pendingCalls.length === 0 || !this.previousInteractionId) {
      return blocked(undefined, "No Gemini function call is awaiting a result");
    }
    const pendingActionCount = this.pendingCalls.reduce((total, pendingCall) => total + pendingCall.actionCount, 0);
    if (results.length !== pendingActionCount) {
      return blocked(undefined, "Gemini function call result count does not match the pending batch");
    }
    const pendingCalls = this.pendingCalls;
    this.pendingCalls = [];
    const contextEpoch = this.contextEpoch;
    let actionIndex = 0;
    return this.invokeAndInterpret({
      model: this.apiModelId(),
      previous_interaction_id: this.previousInteractionId,
      input: pendingCalls.map((pendingCall, index) => {
        const callResults = results.slice(actionIndex, actionIndex + pendingCall.actionCount);
        actionIndex += pendingCall.actionCount;
        const serializedActionResults = callResults.map(({ status, error }) => ({ status, error }));
        // Gemini reads this acknowledgement from the JSON action result in the text part,
        // not from the outer function_result envelope.
        const resultStatus = callResults.every(({ status }) => status === "executed")
          ? "executed"
          : callResults.some(({ status }) => status === "failed")
            ? "failed"
            : "rejected";
        const firstError = callResults.find(({ error }) => error !== undefined)?.error;
        const resultPayload = pendingCall.safetyAcknowledgement
          ? {
              status: resultStatus,
              ...(firstError === undefined ? {} : { error: firstError }),
              safety_acknowledgement: true,
              ...(serializedActionResults.length > 1 ? { action_results: serializedActionResults } : {}),
            }
          : serializedActionResults;
        const resultText = JSON.stringify(resultPayload);
        return {
          type: "function_result",
          call_id: pendingCall.id,
          name: pendingCall.name,
          result: [
            { type: "text", text: resultText },
            ...(index === pendingCalls.length - 1
              ? [{ type: "image", data: toBase64(observation.screenshot), mime_type: observation.mimeType }]
              : []),
          ],
        };
      }),
      tools: COMPUTER_USE_TOOLS,
    }, signal, contextEpoch);
  }

  async resetContext(): Promise<void> {
    this.contextEpoch += 1;
    this.previousInteractionId = undefined;
    this.pendingCalls = [];
  }

  async close(): Promise<void> {
    this.contextEpoch += 1;
    this.previousInteractionId = undefined;
    this.pendingCalls = [];
  }

  private apiModelId(): string {
    return this.model.startsWith("google/") ? this.model.slice("google/".length) : this.model;
  }

  private async invokeAndInterpret(
    request: GeminiTransportRequest,
    signal: AbortSignal,
    contextEpoch: number,
  ): Promise<AgentTurn> {
    const startedAt = this.now();
    let response: unknown;
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw signal.reason ?? new Error("Gemini request aborted");
      try {
        response = await this.transport.invoke(request, signal);
        break;
      } catch (error) {
        if (isProviderActionPolicyFailure(error)) {
          const message = errorText(error);
          return recoverable(
            { error: message, status: httpStatus(error) },
            `Gemini provider request rejected with an unsupported action: ${message}`,
            "provider-request",
          );
        }
        if (!isTransientHttpFailure(error) || attempt >= this.options.performance.maxProviderRetries) throw error;
        const backoffMs = 100 * 2 ** attempt + Math.floor(this.random() * 50);
        await this.sleep(backoffMs);
      }
    }
    void startedAt;
    void this.now();
    const rawProviderOutput = safeRawProviderOutput(response);
    if (byteLength(response) > this.options.performance.maxResponseBytes) {
      return recoverable(
        undefined,
        `Model response exceeds ${this.options.performance.maxResponseBytes} bytes`,
      );
    }
    if (contextEpoch !== this.contextEpoch) {
      return blocked(rawProviderOutput, "Gemini interaction was invalidated by a context reset");
    }
    return this.interpret(response, rawProviderOutput);
  }

  private interpret(response: unknown, rawProviderOutput: unknown): AgentTurn {
    if (hasProviderError(response)) {
      return blocked(rawProviderOutput, "Gemini interaction returned a provider error");
    }
    const interaction = interactionParts(response);
    if (!interaction) return recoverable(rawProviderOutput, "Malformed Gemini interaction response");
    if (!interaction.status) return recoverable(rawProviderOutput, "Gemini interaction did not include a status");
    if (interaction.status === "failed" || interaction.status === "cancelled" || interaction.status === "incomplete") {
      return blocked(rawProviderOutput, `Gemini interaction ${interaction.status}`);
    }
    if (interaction.steps.some(requiresSafetyConfirmation)) {
      return blocked(rawProviderOutput, "Gemini safety confirmation is required");
    }
    const functionCallSteps = interaction.steps.filter((step) => isRecord(step) && step.type === "function_call");
    if (functionCallSteps.length === 0) {
      if (interaction.status !== "completed") {
        return recoverable(rawProviderOutput, `Gemini interaction ended without an action (${interaction.status})`);
      }
      this.previousInteractionId = interaction.id;
      return { status: "finished", actions: [], rawProviderOutput };
    }
    const calls: NativeFunctionCall[] = [];
    for (const step of functionCallSteps) {
      const call = nativeFunctionCall(step);
      if (!call) return recoverable(rawProviderOutput, "Gemini returned a malformed function call");
      calls.push(call);
    }
    const safetyDispositions = calls.map(({ arguments: arguments_ }) => safetyDisposition(arguments_));
    if (safetyDispositions.some((disposition) => disposition === "blocked")) {
      return blocked(rawProviderOutput, "Gemini safety decision blocked the action");
    }
    if (safetyDispositions.some((disposition) => disposition === undefined)) {
      return recoverable(rawProviderOutput, "Gemini returned a malformed safety decision");
    }
    const parsed = calls.map(parseComputerAction);
    if (parsed.some((action) => !action)) {
      return recoverable(rawProviderOutput, "Gemini returned an unsupported or malformed function call");
    }
    const parsedCalls = parsed as {
      actions: ComputerAction[];
      actionBatchType: AgentActionBatchType;
      intent?: string;
      safetyAcknowledgement: boolean;
    }[];
    const actions = parsedCalls.flatMap(({ actions: callActions }) => callActions);
    if (actions.length > MAX_BATCH_ACTIONS) {
      return recoverable(rawProviderOutput, `Gemini returned more than ${MAX_BATCH_ACTIONS} actions`);
    }
    this.previousInteractionId = interaction.id;
    this.pendingCalls = calls.map(({ id, name }, index) => ({
      id,
      name,
      actionCount: parsedCalls[index].actions.length,
      safetyAcknowledgement: parsedCalls[index].safetyAcknowledgement,
    }));
    const actionBatchType = parsedCalls.every(({ actionBatchType }) => actionBatchType === "navigation")
      ? "navigation"
      : parsedCalls.every(({ actionBatchType }) => actionBatchType === "fixation")
        ? "fixation"
        : parsedCalls.every(({ actionBatchType }) => actionBatchType === "trial")
          ? "trial"
          : parsedCalls.every(({ actionBatchType }) => actionBatchType === "wait")
            ? "wait"
            : undefined;
    return {
      status: "actions",
      actions,
      rawProviderOutput,
      ...(actionBatchType ? { actionBatchType } : {}),
      providerIntent: parsedCalls[0].intent,
    };
  }
}
