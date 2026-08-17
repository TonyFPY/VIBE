import type { ActionResult, AgentObservation, AgentTurn, ComputerAction } from "../actions/contract";
import type { PerformanceConfig, Viewport } from "../config/types";
import type { ComputerUseAgent } from "./computer-use-agent";
import { DefaultGeminiTransport, GeminiHttpError, type GeminiTransport, type GeminiTransportRequest } from "./gemini-transport";

const EXCLUDED_PREDEFINED_FUNCTIONS = [
  "double_click", "triple_click", "middle_click", "right_click", "mouse_down", "mouse_up",
  "type", "drag_and_drop", "press_key", "key_down", "key_up", "hotkey", "take_screenshot",
  "scroll", "go_back", "navigate", "go_forward",
] as const;

const COMPUTER_USE_TOOLS = [{
  type: "computer_use",
  environment: "browser",
  enable_prompt_injection_detection: true,
  excluded_predefined_functions: EXCLUDED_PREDEFINED_FUNCTIONS,
}] as const;

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const VIEWPORT: Viewport = { width: 1080, height: 675 };

interface NativeFunctionCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface PendingFunctionCall {
  id: string;
  name: string;
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
): ComputerAction | undefined {
  if (!hasOnlyKeys(arguments_, ["x", "y", "intent"])) return undefined;
  if (!hasFiniteNumber(arguments_, "x") || !hasFiniteNumber(arguments_, "y")) return undefined;
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

function waitAction(arguments_: Record<string, unknown>, fallbackSeconds?: number): ComputerAction | undefined {
  if (!hasOnlyKeys(arguments_, fallbackSeconds === undefined ? ["seconds", "intent"] : ["intent"])) return undefined;
  const seconds = fallbackSeconds ?? (hasFiniteNumber(arguments_, "seconds") ? arguments_.seconds : undefined);
  if (seconds === undefined || seconds < 0) return undefined;
  return { type: "wait", milliseconds: Math.min(5_000, Math.floor(seconds * 1_000)) };
}

function parseComputerAction(call: NativeFunctionCall): { action: ComputerAction; intent?: string } | undefined {
  const intent = typeof call.arguments.intent === "string" ? call.arguments.intent : undefined;
  if (call.name === "click" || call.name === "click_at") {
    const action = normalizedPointerAction("click", call.arguments);
    return action ? { action, intent } : undefined;
  }
  if (call.name === "move" || call.name === "hover_at") {
    const action = normalizedPointerAction("move", call.arguments);
    return action ? { action, intent } : undefined;
  }
  if (call.name === "wait") {
    const action = waitAction(call.arguments);
    return action ? { action, intent } : undefined;
  }
  if (call.name === "wait_5_seconds") {
    const action = waitAction(call.arguments, 5);
    return action ? { action, intent } : undefined;
  }
  return undefined;
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
  private pendingCall: PendingFunctionCall | undefined;

  constructor(private readonly options: GeminiComputerUseAgentOptions) {
    this.model = options.model;
    this.transport = options.transport ?? new DefaultGeminiTransport(options.apiKey);
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn> {
    if (this.pendingCall) {
      return blocked(undefined, "Gemini function call result must be reported before the next observation");
    }
    return this.invokeAndInterpret({
      model: this.apiModelId(),
      input: [
        { type: "text", text: observation.publicInstruction },
        { type: "image", data: toBase64(observation.screenshot), mime_type: observation.mimeType },
      ],
      tools: COMPUTER_USE_TOOLS,
    }, signal);
  }

  async reportActionResult(observation: AgentObservation, result: ActionResult, signal: AbortSignal): Promise<AgentTurn> {
    if (!this.pendingCall || !this.previousInteractionId) {
      return blocked(undefined, "No Gemini function call is awaiting a result");
    }
    const pendingCall = this.pendingCall;
    this.pendingCall = undefined;
    return this.invokeAndInterpret({
      model: this.apiModelId(),
      previous_interaction_id: this.previousInteractionId,
      input: [{
        type: "function_result",
        call_id: pendingCall.id,
        name: pendingCall.name,
        result: [
          { type: "text", text: JSON.stringify({ status: result.status, error: result.error }) },
          { type: "image", data: toBase64(observation.screenshot), mime_type: observation.mimeType },
        ],
      }],
      tools: COMPUTER_USE_TOOLS,
    }, signal);
  }

  async close(): Promise<void> {
    this.previousInteractionId = undefined;
    this.pendingCall = undefined;
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
    if (functionCallSteps.length !== 1) return blocked(rawProviderOutput, "Gemini returned multiple function calls");
    const call = nativeFunctionCall(functionCallSteps[0]);
    if (!call) return blocked(rawProviderOutput, "Gemini returned a malformed function call");
    const parsed = parseComputerAction(call);
    if (!parsed) return blocked(rawProviderOutput, "Gemini returned an unsupported or malformed function call");
    this.previousInteractionId = interaction.id;
    this.pendingCall = { id: call.id, name: call.name };
    return {
      status: "actions",
      actions: [parsed.action],
      rawProviderOutput,
      providerIntent: parsed.intent,
    };
  }
}
