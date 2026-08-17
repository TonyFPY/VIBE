import type { AgentActionType } from "../actions/contract";
import type { ModelRequest } from "./model-adapter";

function actionSchema(action: AgentActionType): string {
  if (action === "CLICK") return '{"type":"CLICK","x":<number>,"y":<number>,"purpose":"navigation|response"}';
  if (action === "MOVE") return '{"type":"MOVE","x":<number>,"y":<number>}';
  return '{"type":"DONE"}';
}

export function buildPublicPrompt(request: ModelRequest): string {
  const schemas = request.allowedActions.map(actionSchema).join("\n");
  const feedback = request.validationFeedback ? `\nPrevious output validation error: ${request.validationFeedback}` : "";
  return [
    request.publicInstruction,
    "Use only the visible screenshot. Reason privately, then emit exactly one complete JSON action object and no other text, prefix, markdown, or partial JSON.",
    "Coordinates are screenshot pixels in the original 1080 x 675 screenshot: origin (0,0) is top-left, x increases right, and y increases down. If an action causes no visible change, choose a different coordinate.",
    "After the center cross is clicked and the stimulus appears, choose one visible candidate. For purpose=response, click inside the visible candidate image or frame, never its label or surrounding whitespace.",
    "Allowed action shapes:",
    schemas,
    feedback,
  ].filter(Boolean).join("\n");
}

function base64Screenshot(request: ModelRequest): string {
  return Buffer.from(request.screenshot).toString("base64");
}

function actionResponseJsonSchema(): Record<string, unknown> {
  return {
    anyOf: [
      {
        type: "object",
        properties: { type: { type: "string", enum: ["DONE"] } },
        required: ["type"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["MOVE"] },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["type", "x", "y"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["CLICK"] },
          x: { type: "number" },
          y: { type: "number" },
          purpose: { type: "string", enum: ["navigation", "response"] },
        },
        required: ["type", "x", "y", "purpose"],
        additionalProperties: false,
      },
    ],
  };
}

function thinkingConfigFor(model: string): Record<string, string | number | boolean> {
  return model.startsWith("gemini-3")
    ? { thinkingLevel: "medium", includeThoughts: false }
    : { thinkingBudget: 0 };
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
      responseJsonSchema: actionResponseJsonSchema(),
      thinkingConfig: thinkingConfigFor(model),
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
