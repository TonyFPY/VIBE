import type { ActionResult, AgentActionBatchType, AgentObservation, AgentTurn, ComputerAction } from "../actions/contract";
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

const CUSTOM_POINTER_TOOLS = [
  {
    type: "function",
    name: "click_visible",
    description: "Click one visible setup or navigation target.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        intent: { type: "string" },
      },
      required: ["x", "y", "intent"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "submit_trial_actions",
    description: `Submit ${MIN_TRIAL_MOVES} through ${MAX_TRIAL_MOVES} visible pointer moves followed by one final visible click.`,
    parameters: {
      type: "object",
      properties: {
        moves: {
          type: "array",
          minItems: MIN_TRIAL_MOVES,
          maxItems: MAX_TRIAL_MOVES,
          items: {
            type: "object",
            properties: { x: { type: "integer" }, y: { type: "integer" } },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
        click: {
          type: "object",
          properties: { x: { type: "integer" }, y: { type: "integer" } },
          required: ["x", "y"],
          additionalProperties: false,
        },
      },
      required: ["moves", "click"],
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
  `On trial-response screens, use submit_trial_actions with at least ${MIN_TRIAL_MOVES} separate moves followed by one final click.`,
  "Use no native pointer controls, waits, or other excluded controls.",
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
} | undefined {
  if (call.name === "click_visible") {
    const action = normalizedPointerAction("click", call.arguments, true);
    return action
      ? { actions: [action], actionBatchType: "navigation", intent: call.arguments.intent as string }
      : undefined;
  }
  if (call.name !== "submit_trial_actions" || !hasOnlyKeys(call.arguments, ["moves", "click"])) return undefined;
  if (!Array.isArray(call.arguments.moves) || !isRecord(call.arguments.click)) return undefined;
  if (call.arguments.moves.length < MIN_TRIAL_MOVES || call.arguments.moves.length > MAX_TRIAL_MOVES) return undefined;
  const moves = call.arguments.moves.map((move) => (
    isRecord(move) ? normalizedPointerAction("move", move) : undefined
  ));
  const click = normalizedPointerAction("click", call.arguments.click);
  if (moves.some((move) => !move) || !click) return undefined;
  return { actions: [...moves as ComputerAction[], click], actionBatchType: "trial" };
}

function isTransientHttpFailure(error: unknown): boolean {
  if (error instanceof GeminiHttpError) return TRANSIENT_HTTP_STATUSES.has(error.status);
  return isRecord(error) && typeof error.status === "number" && TRANSIENT_HTTP_STATUSES.has(error.status);
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
    return this.invokeAndInterpret({
      model: this.apiModelId(),
      input: [
        { type: "text", text: `${observation.publicInstruction}\n\n${PUBLIC_INTERACTION_POLICY}` },
        { type: "image", data: toBase64(observation.screenshot), mime_type: observation.mimeType },
      ],
      tools: COMPUTER_USE_TOOLS,
    }, signal);
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
    let actionIndex = 0;
    return this.invokeAndInterpret({
      model: this.apiModelId(),
      previous_interaction_id: this.previousInteractionId,
      input: pendingCalls.map((pendingCall, index) => {
        const callResults = results.slice(actionIndex, actionIndex + pendingCall.actionCount);
        actionIndex += pendingCall.actionCount;
        return {
          type: "function_result",
          call_id: pendingCall.id,
          name: pendingCall.name,
          result: [
            { type: "text", text: JSON.stringify(callResults.map(({ status, error }) => ({ status, error }))) },
            ...(index === pendingCalls.length - 1
              ? [{ type: "image", data: toBase64(observation.screenshot), mime_type: observation.mimeType }]
              : []),
          ],
        };
      }),
      tools: COMPUTER_USE_TOOLS,
    }, signal);
  }

  async close(): Promise<void> {
    this.previousInteractionId = undefined;
    this.pendingCalls = [];
  }

  private apiModelId(): string {
    return this.model.startsWith("google/") ? this.model.slice("google/".length) : this.model;
  }

  private async invokeAndInterpret(request: GeminiTransportRequest, signal: AbortSignal): Promise<AgentTurn> {
    const startedAt = this.now();
    let response: unknown;
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw signal.reason ?? new Error("Gemini request aborted");
      try {
        response = await this.transport.invoke(request, signal);
        break;
      } catch (error) {
        if (!isTransientHttpFailure(error) || attempt >= this.options.performance.maxProviderRetries) throw error;
        const backoffMs = 100 * 2 ** attempt + Math.floor(this.random() * 50);
        await this.sleep(backoffMs);
      }
    }
    void startedAt;
    void this.now();
    const rawProviderOutput = safeRawProviderOutput(response);
    if (byteLength(response) > this.options.performance.maxResponseBytes) {
      throw new Error(`Model response exceeds ${this.options.performance.maxResponseBytes} bytes`);
    }
    return this.interpret(response, rawProviderOutput);
  }

  private interpret(response: unknown, rawProviderOutput: unknown): AgentTurn {
    if (hasProviderError(response)) {
      return blocked(rawProviderOutput, "Gemini interaction returned a provider error");
    }
    const interaction = interactionParts(response);
    if (!interaction) return blocked(rawProviderOutput, "Malformed Gemini interaction response");
    if (!interaction.status) return blocked(rawProviderOutput, "Gemini interaction did not include a status");
    if (interaction.status === "failed" || interaction.status === "cancelled" || interaction.status === "incomplete") {
      return blocked(rawProviderOutput, `Gemini interaction ${interaction.status}`);
    }
    if (interaction.steps.some(requiresSafetyConfirmation)) {
      return blocked(rawProviderOutput, "Gemini safety confirmation is required");
    }
    const functionCallSteps = interaction.steps.filter((step) => isRecord(step) && step.type === "function_call");
    if (functionCallSteps.length === 0) {
      if (interaction.status !== "completed") {
        return blocked(rawProviderOutput, `Gemini interaction ended without an action (${interaction.status})`);
      }
      this.previousInteractionId = interaction.id;
      return { status: "finished", actions: [], rawProviderOutput };
    }
    const calls: NativeFunctionCall[] = [];
    for (const step of functionCallSteps) {
      const call = nativeFunctionCall(step);
      if (!call) return blocked(rawProviderOutput, "Gemini returned a malformed function call");
      calls.push(call);
    }
    const parsed = calls.map(parseComputerAction);
    if (parsed.some((action) => !action)) {
      return blocked(rawProviderOutput, "Gemini returned an unsupported or malformed function call");
    }
    const parsedCalls = parsed as { actions: ComputerAction[]; actionBatchType: AgentActionBatchType; intent?: string }[];
    const actions = parsedCalls.flatMap(({ actions: callActions }) => callActions);
    if (actions.length > MAX_BATCH_ACTIONS) {
      return blocked(rawProviderOutput, `Gemini returned more than ${MAX_BATCH_ACTIONS} actions`);
    }
    this.previousInteractionId = interaction.id;
    this.pendingCalls = calls.map(({ id, name }, index) => ({ id, name, actionCount: parsedCalls[index].actions.length }));
    const actionBatchType = parsedCalls.every(({ actionBatchType }) => actionBatchType === "navigation")
      ? "navigation"
      : parsedCalls.every(({ actionBatchType }) => actionBatchType === "trial")
        ? "trial"
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
