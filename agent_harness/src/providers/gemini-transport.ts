import { GoogleGenAI } from "@google/genai";

export interface GeminiTransportRequest {
  model: string;
  input: unknown;
  tools: readonly unknown[];
  previous_interaction_id?: string;
}

export interface GeminiTransport {
  invoke(request: GeminiTransportRequest, signal: AbortSignal): Promise<unknown>;
}

export class GeminiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

export class DefaultGeminiTransport implements GeminiTransport {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async invoke(request: GeminiTransportRequest, signal: AbortSignal): Promise<unknown> {
    return this.ai.interactions.create(request as never, { abortSignal: signal } as never);
  }
}
