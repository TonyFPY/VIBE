import { describe, expect, it } from "vitest";

import type { ActionResult, AgentObservation } from "../../src/actions/contract";
import { MAX_TRIAL_MOVES, MIN_TRIAL_MOVES } from "../../src/actions/policy";
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

function trialArguments(moves: unknown[]): unknown {
  return { moves, click: { x: 999, y: 999 } };
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

  it("advertises custom pointer tools while excluding native click and move", async () => {
    const transport = fakeTransport(interaction([
      functionCall("click_visible", { x: 700, y: 500, intent: "start the visible experiment" }),
    ]));

    await agent(transport).next(observation, new AbortController().signal);

    expect(transport.requests).toEqual([expect.objectContaining({
      model: "gemini-3.7-flash",
      input: [
        { type: "text", text: expect.stringContaining("Choose using only the visible screen.") },
        { type: "image", data: "/9j/", mime_type: "image/jpeg" },
      ],
      tools: expect.arrayContaining([
        expect.objectContaining({
          type: "computer_use",
          excluded_predefined_functions: expect.arrayContaining(["click", "move"]),
        }),
        expect.objectContaining({
          type: "function",
          name: "click_visible",
          parameters: expect.objectContaining({ required: ["x", "y", "intent"] }),
        }),
        expect.objectContaining({
          type: "function",
          name: "submit_trial_actions",
          parameters: expect.objectContaining({
            required: ["moves", "click"],
            properties: expect.objectContaining({
              moves: expect.objectContaining({ minItems: MIN_TRIAL_MOVES, maxItems: MAX_TRIAL_MOVES }),
            }),
          }),
        }),
      ]),
    })]);
  });

  it("serializes only the public observation and the complete restricted tool contract", async () => {
    const publicObservation: AgentObservation = {
      ...observation,
      publicInstruction: "PUBLIC_INSTRUCTION_CANARY: use only visible pixels.",
    };
    const transport = fakeTransport(interaction([
      functionCall("click_visible", { x: 700, y: 500, intent: "start" }),
    ]));

    await agent(transport).next(publicObservation, new AbortController().signal);

    const request = transport.requests[0] as {
      input: Array<Record<string, unknown>>;
      tools: Array<Record<string, unknown>>;
    };
    expect(Object.keys(request).sort()).toEqual(["input", "model", "tools"]);
    expect(request.input).toEqual([
      { type: "text", text: expect.stringContaining("PUBLIC_INSTRUCTION_CANARY") },
      { type: "image", data: "/9j/", mime_type: "image/jpeg" },
    ]);
    expect((request.input[0] as { text: string }).text).toContain("Start or Continue");
    expect(request.tools[0]).toEqual({
      type: "computer_use",
      environment: "browser",
      enable_prompt_injection_detection: true,
      excluded_predefined_functions: [
        "click", "move", "double_click", "triple_click", "middle_click", "right_click", "mouse_down", "mouse_up",
        "type", "drag_and_drop", "press_key", "key_down", "key_up", "hotkey", "take_screenshot",
        "scroll", "go_back", "navigate", "go_forward", "wait",
      ],
    });

    const serialized = JSON.stringify(request);
    expect(serialized).toContain("PUBLIC_INSTRUCTION_CANARY");
    for (const privilegedValue of [
      "SECRET_ANSWER_CANARY", "PRIVATE_TASK_METADATA_CANARY", "Playwright", "page", "url", "DOM", "accessibility", "filesystem",
      "click_at", "hover_at", "wait_5_seconds",
    ]) {
      expect(serialized).not.toContain(privilegedValue);
    }
  });

  it("parses click_visible into one normalized click", async () => {
    await expect(agent(fakeTransport(interaction([
      functionCall("click_visible", { x: 700, y: 500, intent: "choose the visible candidate" }),
    ]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "actions",
      actionBatchType: "navigation",
      actions: [{ type: "click", x: 756, y: 337 }],
      providerIntent: "choose the visible candidate",
    });
  });

  it("blocks a new observation until custom function results are reported", async () => {
    const transport = fakeTransport(interaction([
      functionCall("click_visible", { x: 500, y: 500, intent: "start" }),
    ]));
    const computerUseAgent = agent(transport);

    await expect(computerUseAgent.next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "actions",
      actions: [{ type: "click", x: 540, y: 337 }],
    });
    await expect(computerUseAgent.next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
    expect(transport.requests).toHaveLength(1);
  });

  it("flattens nine trial moves and the final click in order", async () => {
    const turn = await agent(fakeTransport(interaction([
      functionCall("submit_trial_actions", trialArguments([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 300, y: 300 },
        { x: 400, y: 400 },
        { x: 500, y: 500 },
        { x: 600, y: 600 },
        { x: 700, y: 700 },
        { x: 800, y: 800 },
      ]), "trial-1"),
    ]))).next(observation, new AbortController().signal);

    expect(turn).toMatchObject({
      status: "actions",
      actionBatchType: "trial",
      actions: [
        { type: "move", x: 0, y: 0 },
        { type: "move", x: 108, y: 67 },
        { type: "move", x: 216, y: 135 },
        { type: "move", x: 324, y: 202 },
        { type: "move", x: 432, y: 270 },
        { type: "move", x: 540, y: 337 },
        { type: "move", x: 648, y: 405 },
        { type: "move", x: 756, y: 472 },
        { type: "move", x: 864, y: 540 },
        { type: "click", x: 1078, y: 674 },
      ],
    });
  });

  it.each([
    ["eight moves", Array.from({ length: 8 }, (_, x) => ({ x, y: x }))],
    ["fifty moves", Array.from({ length: 50 }, (_, x) => ({ x, y: x }))],
  ])("rejects a trial with %s", async (_name, moves) => {
    await expect(agent(fakeTransport(interaction([
      functionCall("submit_trial_actions", trialArguments(moves)),
    ]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
  });

  it.each([
    ["a non-finite setup coordinate", functionCall("click_visible", { x: Number.NaN, y: 500, intent: "start" })],
    ["a fractional setup coordinate", functionCall("click_visible", { x: 700.5, y: 500, intent: "start" })],
    ["an out-of-range trial move", functionCall("submit_trial_actions", trialArguments([
      { x: 1000, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 },
      { x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }, { x: 8, y: 8 },
    ]))],
    ["a fractional trial coordinate", functionCall("submit_trial_actions", {
      moves: [{ x: 0.5, y: 0 }, ...Array.from({ length: 8 }, (_, x) => ({ x, y: x }))],
      click: { x: 500, y: 500 },
    })],
    ["a malformed final click", functionCall("submit_trial_actions", { moves: Array.from({ length: 9 }, () => ({ x: 1, y: 1 })), click: { x: 500 } })],
  ])("rejects %s", async (_name, call) => {
    await expect(agent(fakeTransport(interaction([call]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
  });

  it.each([
    ["an unsupported function", functionCall("navigate", { url: "https://example.test" })],
    ["missing function-call arguments", { type: "function_call", id: "call-1", name: "click_visible" }],
    ["unexpected setup arguments", functionCall("click_visible", { x: 500, y: 500, intent: "start", url: "https://example.test" })],
    ["a safety block", { type: "safety", decision: "requires_confirmation" }],
    ["a prompt block", { type: "prompt_blocked", decision: "blocked" }],
  ])("blocks %s without returning an executable action", async (_name, stepOrSteps) => {
    const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];
    const turn = await agent(fakeTransport(interaction(steps))).next(observation, new AbortController().signal);
    expect(turn.status).toBe("blocked");
    expect(turn.actions).toEqual([]);
  });

  it("finishes only for a completed text-only response", async () => {
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
  ])("blocks a %s no-action interaction instead of treating it as finished", async (_name, response, failureReason) => {
    const turn = await agent(fakeTransport(response)).next(observation, new AbortController().signal);
    expect(turn).toMatchObject({ status: "blocked", actions: [] });
    expect(turn.failureReason).toContain(failureReason);
  });

  it("reports the expanded trial results as one grouped custom function result", async () => {
    const transport = fakeTransport(
      interaction([
        functionCall("submit_trial_actions", trialArguments([
          { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }, { x: 400, y: 400 },
          { x: 500, y: 500 }, { x: 600, y: 600 }, { x: 700, y: 700 }, { x: 800, y: 800 },
        ]), "trial-1"),
      ]),
      interaction([{ type: "text", text: "Completed." }], "interaction-2"),
    );
    const computerUseAgent = agent(transport);
    const signal = new AbortController().signal;
    const firstTurn = await computerUseAgent.next(observation, signal);
    const results: readonly ActionResult[] = firstTurn.actions.map((action, index) => ({
      action,
      status: index === 4 ? "rejected" : "executed",
      ...(index === 4 ? { error: "outside viewport" } : {}),
    }));
    const nextObservation: AgentObservation = { ...observation, screenshot: Uint8Array.from([1, 2, 3]) };

    await expect(computerUseAgent.reportActionResults(nextObservation, results, signal)).resolves.toMatchObject({
      status: "finished",
      actions: [],
    });

    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]).toMatchObject({
      previous_interaction_id: "interaction-1",
      input: [{
        type: "function_result",
        call_id: "trial-1",
        name: "submit_trial_actions",
        result: [
          { type: "text", text: JSON.stringify(results.map(({ status, error }) => ({ status, error }))) },
          { type: "image", data: "AQID", mime_type: "image/jpeg" },
        ],
      }],
    });
  });

  it("attaches the fresh screenshot only to the final result across multiple custom calls", async () => {
    const transport = fakeTransport(
      interaction([
        functionCall("click_visible", { x: 500, y: 500, intent: "start" }, "setup-1"),
        functionCall("submit_trial_actions", trialArguments([
          { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }, { x: 400, y: 400 },
          { x: 500, y: 500 }, { x: 600, y: 600 }, { x: 700, y: 700 }, { x: 800, y: 800 },
        ]), "trial-1"),
      ]),
      interaction([{ type: "text", text: "Completed." }], "interaction-2"),
    );
    const computerUseAgent = agent(transport);
    const signal = new AbortController().signal;
    const firstTurn = await computerUseAgent.next(observation, signal);
    expect(firstTurn.actions).toHaveLength(11);
    const results: readonly ActionResult[] = firstTurn.actions.map((action) => ({ action, status: "executed" }));
    const nextObservation: AgentObservation = { ...observation, screenshot: Uint8Array.from([1, 2, 3]) };

    await expect(computerUseAgent.reportActionResults(nextObservation, results, signal)).resolves.toMatchObject({
      status: "finished",
      actions: [],
    });

    const continuation = transport.requests[1] as { input: Array<{ result: Array<{ type: string; data?: string }> }> };
    expect(continuation.input).toEqual([
      expect.objectContaining({
        call_id: "setup-1",
        name: "click_visible",
        result: [{ type: "text", text: JSON.stringify([{ status: "executed", error: undefined }]) }],
      }),
      expect.objectContaining({
        call_id: "trial-1",
        name: "submit_trial_actions",
        result: [
          { type: "text", text: JSON.stringify(Array.from({ length: 10 }, () => ({ status: "executed", error: undefined }))) },
          { type: "image", data: "AQID", mime_type: "image/jpeg" },
        ],
      }),
    ]);
    expect(continuation.input[0].result.some((part) => part.type === "image")).toBe(false);
    expect(continuation.input[1].result.filter((part) => part.type === "image")).toHaveLength(1);
  });

  it("blocks native pointer calls rather than accepting them as custom actions", async () => {
    await expect(agent(fakeTransport(interaction([
      functionCall("click", { x: 700, y: 500 }),
    ]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
  });

  it("blocks a continuation with no pending call or a mismatched result count", async () => {
    const signal = new AbortController().signal;
    const computerUseAgent = agent(fakeTransport(interaction([
      functionCall("click_visible", { x: 500, y: 500, intent: "start" }),
    ])));
    const results: readonly ActionResult[] = [
      { action: { type: "click", x: 540, y: 337 }, status: "executed" },
    ];

    await expect(computerUseAgent.reportActionResults(observation, results, signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
    await computerUseAgent.next(observation, signal);
    await expect(computerUseAgent.reportActionResults(observation, [], signal)).resolves.toMatchObject({
      status: "blocked",
      actions: [],
    });
  });
});
