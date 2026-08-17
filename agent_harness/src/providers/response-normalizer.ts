import type { GoogleApiFamily } from "../config/model-catalog";
import type { ModelUsage } from "./model-adapter";

export interface NormalizedProviderResponse {
  rawOutput: string;
  usage?: ModelUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeProviderResponse(
  apiFamily: GoogleApiFamily,
  response: unknown,
): NormalizedProviderResponse {
  if (!isRecord(response)) throw new Error("Provider response must be an object");

  if (apiFamily === "google") {
    const rawOutput = typeof response.text === "string" ? response.text : undefined;
    if (!rawOutput) throw new Error("Google response did not contain text");
    const usage = isRecord(response.usageMetadata) ? response.usageMetadata : {};
    return {
      rawOutput,
      usage: {
        inputTokens: numeric(usage.promptTokenCount),
        outputTokens: numeric(usage.candidatesTokenCount),
        totalTokens: numeric(usage.totalTokenCount),
      },
    };
  }

  if (apiFamily === "openai-compatible") {
    const firstChoice = Array.isArray(response.choices) && isRecord(response.choices[0]) ? response.choices[0] : undefined;
    const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : undefined;
    const rawOutput = message && typeof message.content === "string" ? message.content : undefined;
    if (!rawOutput) throw new Error("Chat Completions response did not contain message content");
    const usage = isRecord(response.usage) ? response.usage : {};
    return {
      rawOutput,
      usage: {
        inputTokens: numeric(usage.prompt_tokens),
        outputTokens: numeric(usage.completion_tokens),
        totalTokens: numeric(usage.total_tokens),
      },
    };
  }

  const firstContent = Array.isArray(response.content) && isRecord(response.content[0]) ? response.content[0] : undefined;
  const rawOutput = firstContent && typeof firstContent.text === "string" ? firstContent.text : undefined;
  if (!rawOutput) throw new Error("rawPredict response did not contain text content");
  const usage = isRecord(response.usage) ? response.usage : {};
  return {
    rawOutput,
    usage: {
      inputTokens: numeric(usage.input_tokens),
      outputTokens: numeric(usage.output_tokens),
      totalTokens: numeric(usage.input_tokens) !== undefined && numeric(usage.output_tokens) !== undefined
        ? numeric(usage.input_tokens)! + numeric(usage.output_tokens)!
        : undefined,
    },
  };
}
