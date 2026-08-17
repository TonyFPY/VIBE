import { GoogleGenAI } from "@google/genai";
import { GoogleAuth } from "google-auth-library";

import type { ModelSpec } from "../config/model-catalog";
import type { PerformanceConfig } from "../config/types";
import {
  buildGoogleRequest,
  buildOpenAiCompatibleRequest,
  buildRawPredictRequest,
} from "./google-request-builders";
import type { ModelAdapter, ModelRequest, ModelResponse } from "./model-adapter";
import { normalizeProviderResponse } from "./response-normalizer";

export class ProviderHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export interface GoogleTransport {
  invoke(spec: ModelSpec, body: unknown, signal: AbortSignal): Promise<unknown>;
}

function serviceEndpoint(location: string): string {
  if (location === "global") return "aiplatform.googleapis.com";
  if (location === "us" || location === "eu") return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}

export class DefaultGoogleTransport implements GoogleTransport {
  private readonly genai: GoogleGenAI;
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

  constructor(private readonly project: string, private readonly location: string) {
    this.genai = new GoogleGenAI({ enterprise: true, project, location });
  }

  async invoke(spec: ModelSpec, body: unknown, signal: AbortSignal): Promise<unknown> {
    if (spec.apiFamily === "google") {
      const request = body as {
        model: string;
        contents: unknown;
        config: Record<string, unknown>;
      };
      return this.genai.models.generateContent({
        ...request,
        contents: request.contents as never,
        config: { ...request.config, abortSignal: signal },
      });
    }

    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("Unable to acquire Google Cloud access token");
    const endpoint = serviceEndpoint(this.location);
    const encodedProject = encodeURIComponent(this.project);
    const encodedLocation = encodeURIComponent(this.location);
    const url = spec.apiFamily === "openai-compatible"
      ? `https://${endpoint}/v1/projects/${encodedProject}/locations/${encodedLocation}/endpoints/openapi/chat/completions`
      : `https://${endpoint}/v1/projects/${encodedProject}/locations/${encodedLocation}/publishers/${encodeURIComponent(spec.publisher)}/models/${encodeURIComponent(spec.apiModelId)}:rawPredict`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 2048) || `Google Agent Platform returned HTTP ${response.status}`;
      throw new ProviderHttpError(response.status, message);
    }
    return response.json();
  }
}

export interface GoogleAgentPlatformAdapterOptions {
  project: string;
  location: string;
  model: ModelSpec;
  performance: PerformanceConfig;
  transport?: GoogleTransport;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const transientStatuses = new Set([429, 500, 502, 503, 504]);

export class GoogleAgentPlatformAdapter implements ModelAdapter {
  readonly provider = "google-agent-platform" as const;
  readonly model: string;
  private readonly transport: GoogleTransport;
  private readonly now: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: GoogleAgentPlatformAdapterOptions) {
    this.model = options.model.modelId;
    this.transport = options.transport ?? new DefaultGoogleTransport(options.project, options.location);
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async generateAction(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const startedAt = this.now();
    const body = this.buildRequest(request);
    let response: unknown;
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw signal.reason ?? new Error("Model request aborted");
      try {
        response = await this.transport.invoke(this.options.model, body, signal);
        break;
      } catch (error) {
        const retryable = error instanceof ProviderHttpError && transientStatuses.has(error.status);
        if (!retryable || attempt >= this.options.performance.maxProviderRetries) throw error;
        const backoffMs = 100 * 2 ** attempt + Math.floor(this.random() * 50);
        await this.sleep(backoffMs);
      }
    }
    const normalized = normalizeProviderResponse(this.options.model.apiFamily, response);
    const responseBytes = Buffer.byteLength(normalized.rawOutput, "utf8");
    if (responseBytes > this.options.performance.maxResponseBytes) {
      throw new Error(`Model response exceeds ${this.options.performance.maxResponseBytes} bytes`);
    }
    return { ...normalized, startedAt, completedAt: this.now() };
  }

  private buildRequest(request: ModelRequest): unknown {
    const tokens = this.options.performance.outputTokens;
    if (this.options.model.apiFamily === "google") {
      return buildGoogleRequest(request, this.options.model.apiModelId, tokens);
    }
    if (this.options.model.apiFamily === "openai-compatible") {
      return buildOpenAiCompatibleRequest(request, this.options.model.apiModelId, tokens);
    }
    return buildRawPredictRequest(request, tokens);
  }
}
