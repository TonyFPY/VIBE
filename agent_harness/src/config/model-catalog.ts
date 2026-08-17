export type GoogleApiFamily = "google" | "openai-compatible" | "raw-predict";

export interface ModelSpec {
  modelId: string;
  publisher: string;
  apiFamily: GoogleApiFamily;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportedLocations: readonly string[];
}

export const MODEL_CATALOG: readonly ModelSpec[] = [
  {
    modelId: "google/gemini-3.5-flash",
    publisher: "google",
    apiFamily: "google",
    supportsVision: true,
    supportsStructuredOutput: true,
    supportedLocations: ["global"],
  },
  {
    modelId: "meta/llama-4-maverick-17b-128e-instruct-maas",
    publisher: "meta",
    apiFamily: "openai-compatible",
    supportsVision: true,
    supportsStructuredOutput: true,
    supportedLocations: ["global", "us-central1"],
  },
  {
    modelId: "anthropic/claude-sonnet-4-6",
    publisher: "anthropic",
    apiFamily: "raw-predict",
    supportsVision: true,
    supportsStructuredOutput: false,
    supportedLocations: ["global", "us", "eu"],
  },
  {
    modelId: "xai/grok-4-3",
    publisher: "xai",
    apiFamily: "raw-predict",
    supportsVision: false,
    supportsStructuredOutput: true,
    supportedLocations: ["global"],
  },
] as const;

export function resolveModelSpec(modelId: string, location?: string): ModelSpec {
  const model = MODEL_CATALOG.find((entry) => entry.modelId === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (location && !model.supportedLocations.includes(location)) {
    throw new Error(`Model ${modelId} is not available in location ${location}`);
  }
  return model;
}
