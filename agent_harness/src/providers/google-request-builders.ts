import type { AgentActionType } from "../actions/contract";
import type { ModelRequest } from "./model-adapter";

function actionSchema(action: AgentActionType): string {
  if (action === "CLICK") return '{"type":"CLICK","x":<number>,"y":<number>,"purpose":"navigation|fixation|response"}';
  if (action === "MOVE") return '{"type":"MOVE","x":<number>,"y":<number>}';
  return '{"type":"DONE"}';
}

export function buildPublicPrompt(request: ModelRequest): string {
  const schemas = request.allowedActions.map(actionSchema).join("\n");
  const feedback = request.validationFeedback ? `\nPrevious output validation error: ${request.validationFeedback}` : "";
  return [
    request.publicInstruction,
    "Use only the visible screenshot. Return exactly one JSON object and no other text.",
    "Allowed action shapes:",
    schemas,
    feedback,
  ].filter(Boolean).join("\n");
}

function base64Screenshot(request: ModelRequest): string {
  return Buffer.from(request.screenshot).toString("base64");
}

export function buildGoogleRequest(request: ModelRequest, model: string, maxOutputTokens: number) {
  return {
    model,
    contents: [{
      role: "user",
      parts: [
        { text: buildPublicPrompt(request) },
        { inlineData: { mimeType: request.mimeType, data: base64Screenshot(request) } },
      ],
    }],
    config: {
      maxOutputTokens,
      temperature: 0,
      responseMimeType: "application/json",
    },
  };
}

export function buildOpenAiCompatibleRequest(request: ModelRequest, model: string, maxOutputTokens: number) {
  return {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: buildPublicPrompt(request) },
        { type: "image_url", image_url: { url: `data:${request.mimeType};base64,${base64Screenshot(request)}` } },
      ],
    }],
    max_tokens: maxOutputTokens,
    temperature: 0,
    stream: false,
    response_format: { type: "json_object" },
  };
}

export function buildRawPredictRequest(request: ModelRequest, maxOutputTokens: number) {
  return {
    anthropic_version: "vertex-2023-10-16",
    max_tokens: maxOutputTokens,
    temperature: 0,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: buildPublicPrompt(request) },
        {
          type: "image",
          source: { type: "base64", media_type: request.mimeType, data: base64Screenshot(request) },
        },
      ],
    }],
  };
}
