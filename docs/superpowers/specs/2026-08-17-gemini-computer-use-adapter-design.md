# Gemini Computer Use Agent Harness Design

## Purpose

Replace the harness's custom screenshot-to-JSON model protocol with a native
Gemini Computer Use adapter. The Firebase experiment remains the common
experimental infrastructure for human and agent observers: the website owns
trial rendering, response/trajectory logging, scoring, and result persistence.
The external runner owns only browser control, screenshots, provider calls,
action validation, timing, and terminal status.

## Scope

The first implementation is Gemini-only. The provider boundary is generic so a
future OpenAI or Anthropic adapter can be added without changing the browser
controller, run loop, logging, or website.

All implementation changes for this migration are confined to `agent_harness/`.
Markdown documentation may be updated outside that directory. The Firebase
website, backend, task renderers, and root build configuration remain unchanged.

## Information boundary

Every provider receives exactly:

- the current fixed `1080 × 675` viewport screenshot;
- the public participant instruction;
- the provider's configured Computer Use tool definition.

The provider never receives a Playwright page, DOM, HTML, accessibility tree,
URL, task configuration, source code, filesystem path, trial metadata, answer
key, response history containing private state, or backend response body.

The controller may observe evaluator-owned backend request/response metadata to
determine terminal state. That metadata is never placed in an observation or
provider prompt.

## Architecture

```text
Run configuration
       |
       v
Firebase task URL ---> PlaywrightBrowserHost ---> BrowserSession
                                      |              |
                                      |              +-- screenshot JPEG
                                      |              +-- move/click execution
                                      |              +-- save-request status
                                      v
                                  RunLoop
                                      |
                                      v
                         ComputerUseAgent interface
                                      |
                                      v
                         GeminiComputerUseAgent
                                      |
                                      v
                         Gemini native function calls
```

The browser controller and provider communicate only through typed
observations, normalized actions, and action results. The provider cannot call
the controller directly.

## Provider-neutral interface

The shared interface uses CSS-pixel coordinates. Provider-specific coordinate
conversion happens inside each adapter.

```ts
export interface AgentObservation {
  screenshot: Uint8Array;
  mimeType: "image/jpeg";
  publicInstruction: string;
}

export type ComputerAction =
  | { type: "click"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "wait"; milliseconds: number };

export interface AgentTurn {
  status: "actions" | "finished" | "blocked";
  actions: readonly ComputerAction[];
  rawProviderOutput: unknown;
  providerIntent?: string;
  failureReason?: string;
}

export interface ComputerUseAgent {
  readonly provider: string;
  readonly model: string;
  next(observation: AgentObservation, signal: AbortSignal): Promise<AgentTurn>;
  reportActionResult(
    observation: AgentObservation,
    result: ActionResult,
    signal: AbortSignal,
  ): Promise<AgentTurn>;
  close(): Promise<void>;
}

export interface ActionResult {
  action: ComputerAction;
  status: "executed" | "rejected" | "failed";
  error?: string;
}
```

The concrete interface may use a provider-owned conversation identifier or
history internally. Each runner creates one fresh adapter instance per run;
there is no cross-run model memory.

## Gemini adapter

`GeminiComputerUseAgent` enables Gemini's browser Computer Use tool and
translates native function calls into `ComputerAction` values. It supports the
provider's naming variants needed by the configured model:

```text
click_at / click       -> click
hover_at / move        -> move
wait / wait_5_seconds  -> wait
```

Navigation, browser opening, typing, scrolling, dragging, keyboard input, and
other actions are excluded from the Gemini tool configuration when the API
supports exclusions and are rejected by the adapter if returned anyway.

Gemini returns coordinates in its `0..999` coordinate space. The adapter maps
them once to the fixed CSS viewport:

```ts
const xCss = Math.floor(xGemini / 1000 * 1080);
const yCss = Math.floor(yGemini / 1000 * 675);
```

Raw coordinates outside `0..999` are invalid and are not clamped. The shared
runner therefore never needs to know whether a provider uses normalized or
absolute coordinates.

The initial request contains the public instruction and current screenshot.
After an action is executed, the adapter receives the action result together
with the next screenshot through the provider's native function-response
mechanism.
Only one action is executed per provider turn in the first version. If Gemini
returns multiple function calls, the turn is rejected as unsupported rather
than silently executing a batch that could collapse separate experimental
states.

Provider text, intent, function-call arguments, safety decisions, and raw
responses are retained only in evaluator-side logs. They are not sent back to
Gemini as hidden controller state.

## Browser and run loop

The existing Playwright controller remains the only owner of Browser, Context,
and Page objects. It continues to:

- create a fresh context per run at `1080 × 675` with device scale factor `1`;
- capture JPEG screenshots directly;
- execute only pointer operations exposed by `BrowserSession`;
- keep the headed-mode cursor overlay controller-only;
- close the session in a `finally` block.

The run loop retains automatic center fixation so the model is not charged a
vision turn for the deterministic fixation cross. It captures a new screenshot
after each model action and preserves the website's existing trial transition
behavior.

## Completion and failure

The model does not produce an authoritative `DONE` action. Terminal state is
owned by the runner:

- `completed`: the existing results submission succeeds;
- `failed`: the existing results submission exhausts its failed attempts, a
  provider safety decision blocks execution, or an unrecoverable browser/
  provider failure occurs;
- `timeout`: the configured total run timeout is reached;
- `step_limit`: the configured action-turn limit is reached;
- `incomplete`: the provider stops producing actions before backend completion.

The browser controller observes only evaluator-side metadata for the existing
results submission. It records request attempts, response status, and request
failure events, but never reads or logs response bodies. A successful results
response is the authoritative completion signal. The runner does not click
download controls or create a second results upload.

## Safety policy

Every normalized action passes strict validation before execution:

- only `click`, `move`, and bounded `wait` are supported;
- coordinates must be finite and inside the fixed viewport after mapping;
- one action per provider turn is required;
- no action executes after a terminal backend signal;
- malformed or unsupported provider output is logged and returned as a failed
  action result without correction;
- Gemini safety responses requesting user confirmation are never bypassed in
  unattended runs.

## Testing

Replace the old custom JSON-provider tests with:

- Gemini function-call normalization and coordinate mapping tests;
- unsupported-action, invalid-coordinate, safety-response, and multi-action
  rejection tests;
- stateful function-response continuation tests using a fake Gemini transport;
- backend success, retry exhaustion, and request-failure signal tests;
- no-cheating canary tests covering observations, prompts, serialized provider
  requests, action results, and logs;
- deterministic Playwright integration against the existing public fixture;
- timeout, step-limit, provider failure, and early-finished-run tests.

The live Gemini smoke test remains opt-in and excluded from CI. No paid model
call is required for unit, no-cheating, or deterministic integration tests.

## Documentation updates

`agent_harness/README.md` will describe native Gemini Computer Use, the
provider-neutral action interface, evaluator-owned completion, and the fact
that the website—not the harness—saves behavioral data. The previous custom
JSON-action design and plan will be marked superseded or updated so current
documentation does not describe the removed implementation.
