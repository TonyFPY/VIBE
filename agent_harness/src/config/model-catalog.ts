export interface ModelSpec {
  modelId: string;
  apiModelId: string;
  provider: "gemini";
  supportsComputerUse: boolean;
}

export const MODEL_CATALOG: readonly ModelSpec[] = [
  ...[
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
  ].map((apiModelId): ModelSpec => ({
    modelId: `google/${apiModelId}`,
    apiModelId,
    provider: "gemini",
    supportsComputerUse: true,
  })),
] as const;

export function resolveModelSpec(modelId: string): ModelSpec {
  const model = MODEL_CATALOG.find((entry) => entry.modelId === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!model.supportsComputerUse) throw new Error(`Model ${modelId} does not support computer use`);
  return model;
}
