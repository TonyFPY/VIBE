import { describe, expect, it } from "vitest";

import {
  buildGoogleRequest,
  buildOpenAiCompatibleRequest,
  buildRawPredictRequest,
} from "../../src/providers/google-request-builders";
import type { ModelRequest } from "../../src/providers/model-adapter";

const request: ModelRequest = {
  screenshot: Uint8Array.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg",
  publicInstruction: "Choose using only the visible screen.",
  allowedActions: ["CLICK", "MOVE", "DONE"],
};

describe("Google Agent Platform request builders", () => {
  it("builds a Google multimodal JSON request with bounded output", () => {
    const body = buildGoogleRequest(request, "gemini-3.5-flash", 128);
    expect(body).toMatchObject({
      model: "gemini-3.5-flash",
      config: {
        maxOutputTokens: 128,
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "medium", includeThoughts: false },
        responseJsonSchema: expect.objectContaining({
          anyOf: expect.arrayContaining([
            expect.objectContaining({ required: ["type", "x", "y", "purpose"] }),
          ]),
        }),
      },
    });
    expect(JSON.stringify(body)).toContain('"mimeType":"image/jpeg","data":"/9j/"');
    expect(JSON.stringify(body)).toContain("Choose using only the visible screen.");
    expect(JSON.stringify(body)).toContain("1080 x 675 screenshot");
  });

  it("builds an OpenAI-compatible multimodal request without a local path", () => {
    const body = buildOpenAiCompatibleRequest(request, "meta/llama-4-maverick-17b-128e-instruct-maas", 128);
    expect(body).toMatchObject({
      model: "meta/llama-4-maverick-17b-128e-instruct-maas",
      max_tokens: 128,
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(body)).toContain("data:image/jpeg;base64,/9j/");
    expect(JSON.stringify(body)).not.toContain("/tmp/");
  });

  it("builds an Anthropic rawPredict image request", () => {
    const body = buildRawPredictRequest(request, 128);
    expect(body).toMatchObject({
      anthropic_version: "vertex-2023-10-16",
      max_tokens: 128,
      temperature: 0,
    });
    expect(JSON.stringify(body)).toContain('"media_type":"image/jpeg","data":"/9j/"');
  });
});
