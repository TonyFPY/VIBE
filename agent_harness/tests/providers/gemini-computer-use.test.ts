import { describe, expect, it } from "vitest";

import type { ActionResult, AgentObservation } from "../../src/actions/contract";
import { MAX_TRIAL_MOVES, MIN_TRIAL_MOVES } from "../../src/actions/policy";
import { GeminiComputerUseAgent, normalizeGeminiCoordinate } from "../../src/providers/gemini-computer-use";
import { GeminiHttpError, type GeminiTransport } from "../../src/providers/gemini-transport";

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

function trialArguments(trajectory: unknown[]): unknown {
  return { trajectory };
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
          name: "click_fixation_marker",
          parameters: expect.objectContaining({ required: [] }),
        }),
        expect.objectContaining({
          type: "function",
          name: "submit_trial_actions",
          parameters: expect.objectContaining({
            required: ["trajectory"],
            properties: expect.objectContaining({
              trajectory: expect.objectContaining({ minItems: MIN_TRIAL_MOVES, maxItems: MAX_TRIAL_MOVES }),
            }),
          }),
        }),
      ]),
    })]);
    const customTools = (transport.requests[0] as { tools: Array<Record<string, any>> }).tools
      .filter((tool) => tool.type === "function");
    for (const customTool of customTools) {
      expect(customTool.parameters.properties).not.toHaveProperty("safety_decision");
    }
  });

  it("classifies an oversized provider response as recoverable", async () => {
    const transport = fakeTransport({
      id: "oversized-interaction",
      steps: [],
      status: "completed",
      padding: "x".repeat(performance.maxResponseBytes + 1),
    });

    await expect(agent(transport).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "recoverable",
      actions: [],
      failureReason: `Model response exceeds ${performance.maxResponseBytes} bytes`,
    });
  });

  it("turns an unsupported-action 400 into a provider-request recovery turn", async () => {
    const requests: unknown[] = [];
    const transport: GeminiTransport & { readonly requests: unknown[] } = {
      requests,
      async invoke(request) {
        requests.push(request);
        throw new GeminiHttpError(
          400,
          "400 Input blocked: I cannot perform this action because it is an unsupported action. "
            + "I can only use `click_visible`, `wait_5_seconds`, and `click_fixation_marker`.",
        );
      },
    };

    await expect(agent(transport).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "recoverable",
      recoveryKind: "provider-request",
      actions: [],
      failureReason: expect.stringContaining("unsupported action"),
    });
    expect(requests).toHaveLength(1);
  });

  it("turns a test-harness-specific-action 400 into a provider-request recovery turn", async () => {
    const transport: GeminiTransport = {
      async invoke() {
        throw new GeminiHttpError(
          400,
          "400 Input blocked: I cannot take this action because it appears to be a test harness specific action "
            + "that is not meant for real-world browsing.",
        );
      },
    };

    await expect(agent(transport).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "recoverable",
      recoveryKind: "provider-request",
      actions: [],
      failureReason: expect.stringContaining("test harness specific action"),
    });
  });

  it("turns a cross-only tool-policy 400 into a provider-request recovery turn", async () => {
    const transport: GeminiTransport = {
      async invoke() {
        throw new GeminiHttpError(
          400,
          "400 Input blocked: I cannot perform this action because the task explicitly states that I should not use "
            + "`submit_trial_actions` when a cross-only screenshot is presented.",
        );
      },
    };

    await expect(agent(transport).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "recoverable",
      recoveryKind: "provider-request",
      actions: [],
      failureReason: expect.stringContaining("cross-only screenshot"),
    });
  });

  it("classifies an unsupported-action 400 during continuation without replaying the result", async () => {
    const requests: unknown[] = [];
    let invocationCount = 0;
    const transport: GeminiTransport & { readonly requests: unknown[] } = {
      requests,
      async invoke(request) {
        requests.push(request);
        invocationCount += 1;
        if (invocationCount === 1) {
          return interaction([functionCall("click_visible", { x: 500, y: 500, intent: "start" })]);
        }
        throw new GeminiHttpError(400, "400 Input blocked: unsupported action");
      },
    };
    const computerUseAgent = agent(transport);
    const signal = new AbortController().signal;
    const firstTurn = await computerUseAgent.next(observation, signal);
    const results: readonly ActionResult[] = firstTurn.actions.map((action) => ({ action, status: "executed" }));

    await expect(computerUseAgent.reportActionResults(observation, results, signal)).resolves.toMatchObject({
      status: "recoverable",
      recoveryKind: "provider-request",
      actions: [],
    });
    expect(requests[1]).toMatchObject({ previous_interaction_id: "interaction-1" });
  });

  it("advertises integer normalized coordinate bounds and descriptions for every custom coordinate", async () => {
    const transport = fakeTransport(interaction([
      functionCall("click_visible", { x: 700, y: 500, intent: "start" }),
    ]));

    await agent(transport).next(observation, new AbortController().signal);

    const request = transport.requests[0] as { tools: Array<Record<string, any>> };
    const clickSchema = request.tools.find((tool) => tool.name === "click_visible")!.parameters;
    const trialSchema = request.tools.find((tool) => tool.name === "submit_trial_actions")!.parameters;
    const coordinateSchemas = [
      clickSchema.properties.x,
      clickSchema.properties.y,
      trialSchema.properties.trajectory.items.properties.x,
      trialSchema.properties.trajectory.items.properties.y,
    ];

    for (const schema of coordinateSchemas) {
      expect(schema).toMatchObject({
        type: "integer",
        minimum: 0,
        maximum: 999,
        description: expect.stringContaining("normalized"),
      });
    }
  });

  it("resets pending calls and interaction context before a fresh observation", async () => {
    const transport = fakeTransport(
      interaction([
        functionCall("click_visible", { x: 500, y: 500, intent: "start" }),
      ], "old-interaction"),
      interaction([{ type: "text", text: "Fresh interaction." }], "new-interaction"),
    );
    const computerUseAgent = agent(transport);
    const signal = new AbortController().signal;

    await computerUseAgent.next(observation, signal);
    await computerUseAgent.resetContext();

    await expect(computerUseAgent.next(observation, signal)).resolves.toMatchObject({
      status: "finished",
      actions: [],
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]).not.toHaveProperty("previous_interaction_id");
  });

  it("ignores a next response that resolves after its context was reset", async () => {
    let resolveStaleResponse!: (response: unknown) => void;
    const staleResponse = new Promise<unknown>((resolve) => {
      resolveStaleResponse = resolve;
    });
    const transport: GeminiTransport & { readonly requests: unknown[] } = {
      requests: [],
      async invoke(request) {
        this.requests.push(request);
        return this.requests.length === 1
          ? staleResponse
          : interaction([{ type: "text", text: "Fresh interaction." }], "fresh-interaction");
      },
    };
    const computerUseAgent = agent(transport);
    const signal = new AbortController().signal;

    const staleRequest = computerUseAgent.next(observation, signal);
    await computerUseAgent.resetContext();
    resolveStaleResponse(interaction([
      functionCall("click_visible", { x: 500, y: 500, intent: "stale" }),
    ], "stale-interaction"));
    await staleRequest;

    await expect(computerUseAgent.next(observation, signal)).resolves.toMatchObject({
      status: "finished",
      actions: [],
    });
    expect(transport.requests).toHaveLength(2);
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
    expect((request.input[0] as { text: string }).text).toContain("fixation marker is visibly present");
    expect((request.input[0] as { text: string }).text).toContain("click_fixation_marker");
    expect((request.input[0] as { text: string }).text).toContain("stimuli");
    expect((request.input[0] as { text: string }).text).toContain("wait_5_seconds");
    expect((request.input[0] as { text: string }).text).toContain("middle tile labeled reference is not a response target");
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
    expect((request.input[0] as { text: string }).text).toContain("integer normalized x/y value from 0 through 999");
    expect((request.input[0] as { text: string }).text).toContain("not CSS pixels");

    const serialized = JSON.stringify(request);
    expect(serialized).toContain("PUBLIC_INSTRUCTION_CANARY");
    for (const privilegedValue of [
      "SECRET_ANSWER_CANARY", "PRIVATE_TASK_METADATA_CANARY", "Playwright", "page", "url", "DOM", "accessibility", "filesystem",
      "click_at", "hover_at",
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

  it("parses Gemini's native five-second loading wait as a non-trial wait batch", async () => {
    await expect(agent(fakeTransport(interaction([
      functionCall("wait_5_seconds", {}),
    ]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "actions",
      actionBatchType: "wait",
      actions: [{ type: "wait", milliseconds: 5000 }],
    });
  });

  it("parses the fixation-marker tool into an exact fixation move and click", async () => {
    await expect(agent(fakeTransport(interaction([
      functionCall("click_fixation_marker", {}),
    ]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "actions",
      actionBatchType: "fixation",
      actions: [
        { type: "move", x: 540, y: 337.5 },
        { type: "click", x: 540, y: 337.5 },
      ],
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

  it("flattens nine trajectory points and clicks the final point", async () => {
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
        { type: "click", x: 864, y: 540 },
      ],
    });
  });

  it("uses the final trajectory point as the response click", async () => {
    const trajectory = Array.from({ length: 9 }, (_, index) => ({ x: 100 + index * 20, y: 200 + index * 10 }));
    const turn = await agent(fakeTransport(interaction([
      functionCall("submit_trial_actions", { trajectory }),
    ]))).next(observation, new AbortController().signal);

    expect(turn).toMatchObject({
      status: "actions",
      actionBatchType: "trial",
      actions: [
        ...trajectory.slice(0, -1).map(({ x, y }) => ({ type: "move", x: Math.floor(x / 1000 * viewport.width), y: Math.floor(y / 1000 * viewport.height) })),
        { type: "move", x: Math.floor(trajectory.at(-1)!.x / 1000 * viewport.width), y: Math.floor(trajectory.at(-1)!.y / 1000 * viewport.height) },
        { type: "click", x: Math.floor(trajectory.at(-1)!.x / 1000 * viewport.width), y: Math.floor(trajectory.at(-1)!.y / 1000 * viewport.height) },
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
      status: "recoverable",
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
      trajectory: [{ x: 0.5, y: 0 }, ...Array.from({ length: 8 }, (_, x) => ({ x, y: x }))],
    })],
    ["a malformed trajectory point", functionCall("submit_trial_actions", { trajectory: [...Array.from({ length: 8 }, () => ({ x: 1, y: 1 })), { x: 500 }] })],
  ])("rejects %s", async (_name, call) => {
    await expect(agent(fakeTransport(interaction([call]))).next(observation, new AbortController().signal)).resolves.toMatchObject({
      status: "recoverable",
      actions: [],
    });
  });

  it.each([
    ["an unsupported function", functionCall("navigate", { url: "https://example.test" }), "recoverable"],
    ["missing function-call arguments", { type: "function_call", id: "call-1", name: "click_visible" }, "recoverable"],
    ["unexpected setup arguments", functionCall("click_visible", { x: 500, y: 500, intent: "start", url: "https://example.test" }), "recoverable"],
    ["a safety block", { type: "safety", decision: "requires_confirmation" }, "blocked"],
    ["a prompt block", { type: "prompt_blocked", decision: "blocked" }, "blocked"],
  ])("classifies %s without returning an executable action", async (_name, stepOrSteps, expectedStatus) => {
    const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];
    const turn = await agent(fakeTransport(interaction(steps))).next(observation, new AbortController().signal);
    expect(turn.status).toBe(expectedStatus);
    expect(turn.actions).toEqual([]);
  });

  it("finishes only for a completed text-only response", async () => {
    await expect(agent(fakeTransport(interaction([{ type: "text", text: "I am finished." }]))).next(
      observation,
      new AbortController().signal,
    )).resolves.toMatchObject({ status: "finished", actions: [] });
  });

  it.each([
    ["missing status", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: undefined }), "recoverable", "status"],
    ["failed", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: "failed" }), "blocked", "failed"],
    ["cancelled", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: "cancelled" }), "blocked", "cancelled"],
    ["incomplete", interaction([{ type: "text", text: "terminal" }], "interaction-1", { status: "incomplete" }), "blocked", "incomplete"],
    ["top-level error", { error: { message: "provider error" } }, "blocked", "provider error"],
    [
      "interaction error",
      interaction([{ type: "text", text: "terminal" }], "interaction-1", { error: { message: "provider error" } }),
      "blocked",
      "provider error",
    ],
  ])("classifies a %s no-action interaction instead of treating it as finished", async (_name, response, expectedStatus, failureReason) => {
    const turn = await agent(fakeTransport(response)).next(observation, new AbortController().signal);
    expect(turn).toMatchObject({ status: expectedStatus, actions: [] });
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
      status: "recoverable",
      actions: [],
    });
  });

  it.each(["regular", "allowed", "require_confirmation", "requires_confirmation"] as const)(
    "acknowledges an authorized navigation action for Gemini safety decision %s",
    async (decision) => {
      const transport = fakeTransport(
        interaction([
          functionCall("click_visible", {
            x: 700,
            y: 500,
            intent: "Click the visible Start button.",
            safety_decision: {
              decision,
              explanation: "This is an authorized experiment navigation action.",
            },
          }),
        ]),
        interaction([{ type: "text", text: "Completed." }], "interaction-2"),
      );
      const computerUseAgent = agent(transport);
      const signal = new AbortController().signal;
      const firstTurn = await computerUseAgent.next(observation, signal);

      expect(firstTurn).toMatchObject({ status: "actions", actionBatchType: "navigation" });
      const results: readonly ActionResult[] = firstTurn.actions.map((action) => ({ action, status: "executed" }));
      await expect(computerUseAgent.reportActionResults(observation, results, signal)).resolves.toMatchObject({
        status: "finished",
        actions: [],
      });
      const functionResult = (transport.requests[1] as {
        input: Array<{ result: Array<{ type: string; text?: string }>; safety_acknowledgement?: boolean }>;
      }).input[0];
      expect(functionResult).not.toHaveProperty("safety_acknowledgement");
      expect(functionResult.result[0]).toEqual({
        type: "text",
        text: JSON.stringify({
          status: "executed",
          safety_acknowledgement: true,
        }),
      });
    },
  );

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
