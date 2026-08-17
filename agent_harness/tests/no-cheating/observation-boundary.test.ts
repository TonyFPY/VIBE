import { describe, expect, it } from "vitest";

import type { BrowserHost, BrowserSession } from "../../src/browser/browser-types";
import { parseHarnessConfig } from "../../src/config/load-config";
import { RunLoop } from "../../src/core/run-loop";
import { buildGoogleRequest } from "../../src/providers/google-request-builders";
import type { ModelAdapter, ModelRequest } from "../../src/providers/model-adapter";

const canary = "SECRET_ANSWER_CANARY";

describe("screenshot-only model boundary", () => {
  it("excludes private trial data from observations, URLs, prompts, and provider requests", async () => {
    const rawConfig = {
      taskUrl: "https://example.test/tasks/visual-similarity",
      participantId: "001",
      model: "google/gemini-3.5-flash",
      location: "global",
      runMode: "dev",
      privateTrial: { correctAnswer: canary, sourcePath: `/private/${canary}.jpg` },
    };
    const config = parseHarnessConfig(rawConfig);
    let openedUrl = "";
    const session: BrowserSession = {
      screenshot: async () => Uint8Array.from([0xff, 0xd8, 0xff]),
      move: async () => undefined,
      click: async () => undefined,
      close: async () => undefined,
    };
    const browserHost: BrowserHost = {
      openSession: async (url) => { openedUrl = url; return session; },
      close: async () => undefined,
    };
    let observedRequest: ModelRequest | undefined;
    const model: ModelAdapter = {
      provider: "google-agent-platform",
      model: config.model,
      generateAction: async (request) => {
        observedRequest = request;
        return {
          rawOutput: '{"type":"DONE"}',
          startedAt: "2026-08-16T20:00:00.000Z",
          completedAt: "2026-08-16T20:00:01.000Z",
        };
      },
    };
    const logged: unknown[] = [];
    await new RunLoop({
      browserHost,
      model,
      logger: {
        log: async (event) => { logged.push(event); },
        writeScreenshot: async () => undefined,
        close: async () => undefined,
      },
      sleep: async () => undefined,
    }).run(config, "Choose using only the visible screen.");

    expect(observedRequest).toBeDefined();
    const providerBody = buildGoogleRequest(observedRequest!, "gemini-3.5-flash", 128);
    const exposed = JSON.stringify({ openedUrl, observedRequest, providerBody, logged });
    expect(exposed).not.toContain(canary);
    expect(Object.keys(observedRequest!).sort()).toEqual([
      "allowedActions",
      "mimeType",
      "publicInstruction",
      "screenshot",
      "validationFeedback",
    ]);
  });
});
