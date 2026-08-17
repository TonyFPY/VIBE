import { describe, expect, it } from "vitest";

import type { ActionResult, AgentObservation } from "../../src/actions/contract";
import { GeminiComputerUseAgent, normalizeGeminiCoordinate } from "../../src/providers/gemini-computer-use";
import type { GeminiTransport } from "../../src/providers/gemini-transport";

const viewport = { width: 1080, height: 675 } as const;
const observation: AgentObservation = {
  screenshot: Uint8Array.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg",
  publicInstruction: "Choose using only the visible screen.",
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

function interaction(steps: unknown[], id = "interaction-1", fields: Record<string, unknown> = {}): unknown {
  return { id, steps, status: "completed", ...fields };
}

function functionCall(name: string, arguments_: unknown, id = "call-1"): unknown {
  return { type: "function_call", id, name, arguments: arguments_ };
}

function fakeTransport(...responses: unknown[]): GeminiTransport & { readonly requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    async invoke(request) {
      requests.push(request);
      const response = responses.shift();
      if (!response) throw new Error("Fake transport received an unexpected request");
      return response;
    },
  };
}

function agent(transport: GeminiTransport): GeminiComputerUseAgent {
  return new GeminiComputerUseAgent({
    apiKey: "test-key",
    model: "google/gemini-3.7-flash",
    performance,
    transport,
    now: () => "2026-08-17T20:00:00.000Z",
    sleep: async () => undefined,
    random: () => 0,
  });
}

describe("GeminiComputerUseAgent", () => {
  it("maps Gemini normalized coordinates without clamping", () => {
    expect(normalizeGeminiCoordinate(0, "x", viewport)).toBe(0);
    expect(normalizeGeminiCoordinate(999, "x", viewport)).toBe(1078);
    expect(normalizeGeminiCoordinate(999, "y", viewport)).toBe(674);
    expect(() => normalizeGeminiCoordinate(1000, "x", viewport)).toThrow();
  });

  it("returns one click and sends only the public screenshot observation with the modern browser policy", async () => {
    const transport = fakeTransport(interaction([
      functionCall("click", { x: 700, y: 500, intent: "choose the visible candidate" }),
    ]));

    await expect(agent(transport).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "actions",
      actions: [{ type: "click", x: 756, y: 337 }],
      providerIntent: "choose the visible candidate",
    });

    expect(transport.requests).toEqual([expect.objectContaining({
      model: "gemini-3.7-flash",
      input: [
        { type: "text", text: "Choose using only the visible screen." },
        { type: "image", data: "/9j/", mime_type: "image/jpeg" },
      ],
      tools: [expect.objectContaining({
        type: "computer_use",
        environment: "browser",
        enable_prompt_injection_detection: true,
        excluded_predefined_functions: expect.arrayContaining([
          "double_click", "triple_click", "middle_click", "right_click", "mouse_down", "mouse_up",
          "type", "drag_and_drop", "press_key", "key_down", "key_up", "hotkey", "take_screenshot",
          "scroll", "go_back", "navigate", "go_forward",
        ]),
      })],
    })]);
    const serialized = JSON.stringify(transport.requests);
    expect(serialized).not.toContain("click_at");
    expect(serialized).not.toContain("hover_at");
    expect(serialized).not.toContain("wait_5_seconds");
    expect(serialized).not.toContain("Playwright");
    expect(serialized).not.toContain("page");
    expect(serialized).not.toContain("url");
    expect(serialized).not.toContain("DOM");
  });

  it("maps one move and blocks a new observation until its result is reported", async () => {
    const transport = fakeTransport(
      interaction([functionCall("move", { x: 999, y: 0 })]),
      interaction([functionCall("wait", { seconds: 12 })], "interaction-2"),
    );
    const computerUseAgent = agent(transport);

    await expect(computerUseAgent.next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "actions",
      actions: [{ type: "move", x: 1078, y: 0 }],
    });
    await expect(computerUseAgent.next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
    expect(transport.requests).toHaveLength(1);
  });

  it("maps one bounded wait function call", async () => {
    await expect(agent(fakeTransport(interaction([functionCall("wait", { seconds: 12 })]))).next(
      observation,
      new AbortController().signal,
    )).resolves.toMatchObject({
      status: "actions",
      actions: [{ type: "wait", milliseconds: 5000 }],
    });
  });

  it.each([
    ["unsupported function", functionCall("navigate", { url: "https://example.test" })],
    ["out-of-range coordinates", functionCall("click", { x: 1000, y: 500 })],
    ["missing function arguments", functionCall("click", { x: 500 })],
    ["missing function-call arguments", { type: "function_call", id: "call-1", name: "click" }],
    ["unexpected function arguments", functionCall("click", { x: 500, y: 500, url: "https://example.test" })],
    ["multiple function calls", [functionCall("click", { x: 500, y: 500 }), functionCall("move", { x: 200, y: 200 }, "call-2")]],
    ["safety block", { type: "safety", decision: "requires_confirmation" }],
    ["prompt block", { type: "prompt_blocked", decision: "blocked" }],
  ])("blocks %s without returning an executable action", async (_name, stepOrSteps) => {
    const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];
    const turn = await agent(fakeTransport(interaction(steps))).next(observation, new AbortController().signal);
    expect(turn.status).toBe("blocked");
    expect(turn.actions).toEqual([]);
  });

  it("finishes only for a completed text-only native response", async () => {
    await expect(agent(fakeTransport(interaction([{ type: "text", text: "I am finished." }]))).next(
      observation,
      new AbortController().signal,
    )).resolves.toMatchObject({ status: "finished", actions: [] });
  });

  it.each([
    ["missing status", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: undefined }), "status"],
    ["failed", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: "failed" }), "failed"],
    ["cancelled", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: "cancelled" }), "cancelled"],
    ["incomplete", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: "incomplete" }), "incomplete"],
    ["top-level error", { error: { message: "provider error" } }, "provider error"],
    [
      "interaction error",
      interaction([{ type: "text", text: "terminal" }], "interaction-1", { error: { message: "provider error" } }),
      "provider error",
    ],
    [
      "interaction errors",
      interaction([{ type: "text", text: "terminal" }], "interaction-1", { errors: [{ message: "provider error" }] }),
      "provider error",
    ],
  ])("blocks a %s no-action interaction instead of treating it as finished", async (_name, response, failureReason) => {
    const turn = await agent(fakeTransport(response)).next(
      observation,
      new AbortController().signal,
    );
    expect(turn).toMatchObject({ status: "blocked", actions: [] });
    expect(turn.failureReason).toContain(failureReason);
  });

  it.each([
    ["click_at", { x: 700, y: 500 }, { type: "click", x: 756, y: 337 }],
    ["hover_at", { x: 999, y: 0 }, { type: "move", x: 1078, y: 0 }],
    ["wait_5_seconds", {}, { type: "wait", milliseconds: 5000 }],
  ])("parses the legacy %s call without advertising it", async (name, arguments_, expected) => {
    await expect(agent(fakeTransport(interaction([functionCall(name, arguments_)]))).next(
      observation,
      new AbortController().signal,
    )).resolves.toMatchObject({ status: "actions", actions: [expected] });
  });

  it("continues with the matching function result and a fresh screenshot", async () => {
    const transport = fakeTransport(
      interaction([functionCall("click", { x: 700, y: 500 })]),
      interaction([{ type: "text", text: "Completed." }], "interaction-2"),
    );
    const computerUseAgent = agent(transport);
    const signal = new AbortController().signal;
    const firstTurn = await computerUseAgent.next(observation, signal);
    const result: ActionResult = {
      action: { type: "click", x: 756, y: 337 },
      status: "executed",
    };
    const nextObservation: AgentObservation = { ...observation, screenshot: Uint8Array.from([1, 2, 3]) };

    await expect(computerUseAgent.reportActionResult(nextObservation, result, signal)).resolves.toMatchObject({
      status: "finished",
      actions: [],
    });
    expect(firstTurn.actions).toEqual([{ type: "click", x: 756, y: 337 }]);
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]).toMatchObject({
      model: "gemini-3.7-flash",
      previous_interaction_id: "interaction-1",
      input: [{
        type: "function_result",
        call_id: "call-1",
        name: "click",
        result: [
          { type: "text", text: JSON.stringify({ status: "executed", error: undefined }) },
          { type: "image", data: "AQID", mime_type: "image/jpeg" },
        ],
      }],
    });
    expect(JSON.stringify(transport.requests)).not.toContain("Playwright");
    expect(JSON.stringify(transport.requests)).not.toContain("page");
  });
});
