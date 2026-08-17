export interface ModelSpec {
  modelId: string;
  apiModelId: string;
  provider: "gemini";
  supportsComputerUse: boolean;
}

export const MODEL_CATALOG: readonly ModelSpec[] = [
  {
    modelId: "google/gemini-3.7-flash",
    apiModelId: "gemini-3.7-flash",
    provider: "gemini",
    supportsComputerUse: true,
  },
] as const;

export function resolveModelSpec(modelId: string): ModelSpec {
  const model = MODEL_CATALOG.find((entry) => entry.modelId === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!model.supportsComputerUse) throw new Error(`Model ${modelId} does not support computer use`);
  return model;
}
