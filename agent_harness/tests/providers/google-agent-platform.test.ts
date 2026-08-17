import { describe, expect, it } from "vitest";

import { resolveModelSpec } from "../../src/config/model-catalog";
import { GoogleAgentPlatformAdapter, ProviderHttpError } from "../../src/providers/google-agent-platform";
import type { GoogleTransport } from "../../src/providers/google-agent-platform";
import type { ModelRequest } from "../../src/providers/model-adapter";

const request: ModelRequest = {
  screenshot: Uint8Array.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg",
  publicInstruction: "Choose from the visible screen.",
  allowedActions: ["CLICK", "MOVE", "DONE"],
};

const performance = {
  outputTokens: 128,
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
  totalRunTimeoutMs: 1_800_000,
  settleDelayMs: 100,
  maxResponseBytes: 32_768,
  maxProviderRetries: 2,
};

describe("GoogleAgentPlatformAdapter", () => {
  it("selects the catalog protocol and normalizes its raw action text", async () => {
    const calls: Array<{ family: string; apiModel: unknown }> = [];
    const transport: GoogleTransport = {
      async invoke(spec, body) {
        calls.push({ family: spec.apiFamily, apiModel: (body as { model?: unknown }).model });
        return {
          choices: [{ message: { content: '{"type":"DONE"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        };
      },
    };
    const adapter = new GoogleAgentPlatformAdapter({
      project: "test-project",
      location: "global",
      model: resolveModelSpec("meta/llama-4-maverick-17b-128e-instruct-maas"),
      performance,
      transport,
      now: () => "2026-08-16T20:00:00.000Z",
      sleep: async () => undefined,
    });

    await expect(adapter.generateAction(request, new AbortController().signal)).resolves.toMatchObject({
      rawOutput: '{"type":"DONE"}',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      startedAt: "2026-08-16T20:00:00.000Z",
      completedAt: "2026-08-16T20:00:00.000Z",
    });
    expect(calls).toEqual([{
      family: "openai-compatible",
      apiModel: "llama-4-maverick-17b-128e-instruct-maas",
    }]);
  });

  it("retries transient provider failures but not permanent failures", async () => {
    let attempts = 0;
    const transport: GoogleTransport = {
      async invoke() {
        attempts += 1;
        if (attempts < 3) throw new ProviderHttpError(503, "busy");
        return { text: '{"type":"DONE"}' };
      },
    };
    const adapter = new GoogleAgentPlatformAdapter({
      project: "test-project",
      location: "global",
      model: resolveModelSpec("google/gemini-3.5-flash"),
      performance,
      transport,
      now: () => "2026-08-16T20:00:00.000Z",
      sleep: async () => undefined,
    });
    await adapter.generateAction(request, new AbortController().signal);
    expect(attempts).toBe(3);

    const permanent = new GoogleAgentPlatformAdapter({
      project: "test-project",
      location: "global",
      model: resolveModelSpec("google/gemini-3.5-flash"),
      performance,
      transport: { invoke: async () => { throw new ProviderHttpError(400, "bad request"); } },
      now: () => "2026-08-16T20:00:00.000Z",
      sleep: async () => undefined,
    });
    await expect(permanent.generateAction(request, new AbortController().signal)).rejects.toThrow("bad request");
  });

  it("rejects raw model output larger than the configured byte limit", async () => {
    const adapter = new GoogleAgentPlatformAdapter({
      project: "test-project",
      location: "global",
      model: resolveModelSpec("google/gemini-3.5-flash"),
      performance: { ...performance, maxResponseBytes: 8 },
      transport: { invoke: async () => ({ text: '{"type":"DONE"}' }) },
      now: () => "2026-08-16T20:00:00.000Z",
      sleep: async () => undefined,
    });
    await expect(adapter.generateAction(request, new AbortController().signal)).rejects.toThrow("response exceeds 8 bytes");
  });
});
