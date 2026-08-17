import type { AgentActionType } from "../actions/contract";

export interface ModelRequest {
  screenshot: Uint8Array;
  mimeType: "image/jpeg";
  publicInstruction: string;
  allowedActions: readonly AgentActionType[];
  validationFeedback?: string;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  rawOutput: string;
  usage?: ModelUsage;
  startedAt: string;
  completedAt: string;
}

export interface ModelAdapter {
  readonly provider: "google-agent-platform";
  readonly model: string;
  generateAction(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
