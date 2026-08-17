# Agent Harness Implementation Plan

> Superseded: this 2026-08-16 custom protocol plan has been replaced by
> [the 2026-08-17 Gemini Computer Use design](../specs/2026-08-17-gemini-computer-use-adapter-design.md)
> and [implementation plan](2026-08-17-gemini-computer-use-adapter.md).
> Keep this file only as historical context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Build an isolated `agent_harness` CLI that opens a deployed Firebase experiment in Chromium, sends JPEG screenshots to Google Agent Platform vision models, executes only validated pointer actions, and preserves the website’s existing result-saving pipeline.

**Architecture:** The harness owns a Playwright browser controller, a serialized screenshot/action run loop, streaming logs, and a provider-neutral `ModelAdapter`. The first provider implementation is `GoogleAgentPlatformAdapter`, which selects Google, OpenAI-compatible MaaS, or partner `rawPredict` request builders from a versioned model catalog. The website remains responsible for trials, session IDs, behavioral records, trajectories, and saving.

**Tech Stack:** TypeScript, Node.js, Playwright Chromium, Vitest, `@google/genai`, Google Application Default Credentials, native `fetch`, and a harness-local restricted action contract.

## Global Constraints

- The model receives only a current viewport JPEG, participant-visible instruction text, and allowed action names.
- The model never receives DOM, HTML, accessibility data, selectors, `Page`, JavaScript state, source code, filesystem paths, task metadata, answer keys, or hidden state.
- Use a native `1080 × 675` viewport with `deviceScaleFactor: 1`; do not crop or resize screenshots.
- Capture JPEG directly with default quality `90`; accept quality only from `80` through `100`.
- Keep one screenshot, one provider request, and one action in flight per run.
- Reuse one Chromium process and one Google auth/HTTP client across sequential runs; create a fresh browser context per run.
- Use `CLICK`, `MOVE`, and `DONE` only; never execute arbitrary code or silently repair invalid actions.
- Default model output is at most `128` tokens; default connection, request, and run timeouts are `10s`, `60s`, and `30m`.
- Retry only recognized transient provider failures, at most twice with bounded exponential backoff and jitter.
- Stream JSON Lines logs; do not retain screenshots, raw responses, or events in run-level arrays.
- Paid model calls are opt-in and never run in CI.
- Existing human website behavior and the website’s result/trajectory persistence must remain unchanged.
- All implementation code changes are confined to `agent_harness/`.
- Files outside `agent_harness/` are read-only except Markdown documentation.
- Do not modify website tasks, shared website code, Firebase configuration, Functions, root package files, root environment files, or root ignore files.
- Work directly in the current checkout; do not create a worktree for this implementation.

---

### Task 1: Scaffold the isolated harness package and typed run configuration

**Files:**
- Create: `agent_harness/package.json`
- Create: `agent_harness/tsconfig.json`
- Create: `agent_harness/src/config/types.ts`
- Create: `agent_harness/src/config/load-config.ts`
- Create: `agent_harness/src/config/model-catalog.ts`
- Create: `agent_harness/tests/config/load-config.test.ts`
- Create: `agent_harness/tests/config/model-catalog.test.ts`
- Create: `agent_harness/.gitignore`

**Interfaces:**
- Produces `HarnessConfig`, `PerformanceConfig`, `ModelSpec`, `parseHarnessConfig`, `buildTaskUrl`, and `resolveModelSpec` for every later task.

- [ ] **Step 1: Write the failing configuration tests**

```ts
it("builds an agent URL with the compact identity fields", () => {
  expect(buildTaskUrl({
    taskUrl: "https://vibe-9d6e5.web.app/tasks/visual-similarity",
    participantId: "001",
    model: "google/gemini-3.5-flash",
    location: "global",
    runMode: "dev",
  })).toBe(
    "https://vibe-9d6e5.web.app/tasks/visual-similarity?participant_id=A001&model=google%2Fgemini-3.5-flash&run=dev",
  );
});

it("rejects non-vision models and JPEG quality outside 80..100", () => {
  expect(() => parseHarnessConfig({ model: "text-only", screenshotQuality: 90 })).toThrow("vision");
  expect(() => parseHarnessConfig({ model: "google/gemini-3.5-flash", screenshotQuality: 79 })).toThrow("screenshotQuality");
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm --prefix agent_harness test -- --run tests/config`

Expected: FAIL because the package and configuration modules do not exist.

- [ ] **Step 3: Add package and configuration types**

```ts
export interface HarnessConfig {
  taskUrl: string;
  participantId: string;
  model: string;
  location: string;
  runMode: "dev" | "ops";
  viewport: { width: 1080; height: 675 };
  screenshotQuality: number;
  maxSteps: number;
  maxInvalidActions: number;
  performance: PerformanceConfig;
}

export interface PerformanceConfig {
  outputTokens: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  totalRunTimeoutMs: number;
  settleDelayMs: number;
  maxResponseBytes: number;
  maxProviderRetries: number;
}
```

Configure scripts as `test: vitest run`, `typecheck: tsc --noEmit`, and `start: tsx src/cli.ts`. Add `playwright`, `@google/genai`, `google-auth-library`, `typescript`, `tsx`, and `vitest` to this package only; do not add agent dependencies to the deployed website package. In `agent_harness/.gitignore`, ignore `runs/`, `.cache/`, `node_modules/`, and `.env`.

- [ ] **Step 4: Implement parsing, URL construction, and model catalog resolution**

`parseHarnessConfig` must apply the exact defaults: viewport `1080 × 675`, quality `90`, output tokens `128`, connect timeout `10000`, request timeout `60000`, total run timeout `1800000`, settle delay `100`, max response bytes `32768`, and provider retries `2`. It must require `taskUrl`, a numeric participant ID, `runMode` of `dev` or `ops`, and a catalog model with `supportsVision: true`. `buildTaskUrl` must add or replace `participant_id`, `model`, and `run` without exposing credentials.

- [ ] **Step 5: Run tests and commit**

Run: `npm --prefix agent_harness test -- --run tests/config && npm --prefix agent_harness run typecheck`

Expected: all configuration tests pass and TypeScript reports no errors.

```bash
git add agent_harness
git commit -m "feat: scaffold agent harness configuration"
```

### Task 2: Implement the harness-local restricted action contract

**Files:**
- Create: `agent_harness/src/actions/contract.ts`
- Create: `agent_harness/src/actions/policy.ts`
- Create: `agent_harness/tests/actions/contract.test.ts`
- Create: `agent_harness/tests/actions/policy.test.ts`

**Interfaces:**
- Produces `AgentAction`, `AgentActionType`, `ClickAction`, `MoveAction`,
  `DoneAction`, `parseAgentAction`, and
  `validateActionBounds(action, viewport)` for harness use only.

- [ ] **Step 1: Add failing tests for MOVE and bounds policy**

```ts
it("accepts MOVE but rejects extra fields", () => {
  expect(parseAgentAction({ type: "MOVE", x: 20, y: 30 })).toEqual({
    valid: true,
    action: { type: "MOVE", x: 20, y: 30 },
  });
  expect(parseAgentAction({ type: "MOVE", x: 20, y: 30, code: "page.evaluate" }).valid).toBe(false);
});

it("rejects coordinates outside the configured viewport without clamping", () => {
  expect(validateActionBounds({ type: "MOVE", x: 1080, y: 675 }, { width: 1080, height: 675 })).toEqual({ valid: false, error: "coordinates outside viewport" });
});
```

- [ ] **Step 2: Run the focused action tests and verify the new assertions fail**

Run: `npm --prefix agent_harness test -- --run tests/actions`

Expected: FAIL because the harness-local contract and policy modules are missing.

- [ ] **Step 3: Implement minimal MOVE parsing and explicit bounds validation**

Use exact object-key checks. `CLICK` uses purpose values `navigation`,
`fixation`, or `response`. `MOVE` accepts only `{ type, x, y }`; `DONE`
accepts only `{ type }`. Parser validation checks finite non-negative numbers.
Bounds validation checks `0 <= x < viewport.width` and
`0 <= y < viewport.height`; it never rounds or clamps. Do not import or modify
the website action parser.

- [ ] **Step 4: Run the full website test suite**

Run: `npm --prefix agent_harness test -- --run tests/actions && npm --prefix agent_harness run typecheck`

Expected: all harness action tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add agent_harness/src/actions agent_harness/tests/actions
git commit -m "feat: add restricted move action"
```

### Task 3: Implement the Google Agent Platform adapter and request builders

**Files:**
- Create: `agent_harness/src/providers/model-adapter.ts`
- Create: `agent_harness/src/providers/google-request-builders.ts`
- Create: `agent_harness/src/providers/google-agent-platform.ts`
- Create: `agent_harness/src/providers/response-normalizer.ts`
- Create: `agent_harness/tests/providers/google-request-builders.test.ts`
- Create: `agent_harness/tests/providers/google-agent-platform.test.ts`
- Modify: `agent_harness/src/config/model-catalog.ts`

**Interfaces:**
- Consumes `ModelSpec`, `PerformanceConfig`, and `AgentActionType`.
- Produces `ModelAdapter`, `ModelRequest`, `ModelResponse`, and `GoogleAgentPlatformAdapter`.

```ts
export interface ModelRequest {
  screenshot: Uint8Array;
  mimeType: "image/jpeg";
  publicInstruction: string;
  allowedActions: readonly AgentActionType[];
  validationFeedback?: string;
}

export interface ModelResponse {
  rawOutput: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  startedAt: string;
  completedAt: string;
}

export interface ModelAdapter {
  readonly provider: "google-agent-platform";
  readonly model: string;
  generateAction(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
```

- [ ] **Step 1: Write request-builder tests before implementation**

Test that the catalog selects the correct protocol and that each builder contains only public instruction, allowed actions, and a base64 JPEG data URL. Assert the request never contains a `Page`, selector, trial ID, canary, local path, or answer key. Test that `maxOutputTokens` is `128` and temperature/reasoning settings use the configured low-latency defaults.

- [ ] **Step 2: Run provider tests and verify they fail**

Run: `npm --prefix agent_harness test -- --run tests/providers`

Expected: FAIL because adapter and request-builder modules are missing.

- [ ] **Step 3: Implement the provider-neutral types and model catalog entries**

Represent protocol selection as `"google" | "openai-compatible" | "raw-predict"`. Include only vision-capable catalog entries in the initial catalog fixtures. Keep model IDs and locations explicit and version-controlled.

- [ ] **Step 4: Implement Google request builders**

Use `@google/genai` for Google model calls where supported. Use Google Cloud ADC and native `fetch` for Agent Platform OpenAI-compatible and partner `rawPredict` calls. Keep protocol details inside the provider module. Use non-streaming requests and JSON response instructions. Convert the JPEG to a data URL only for serialization, then release the temporary encoded string after the request completes.

- [ ] **Step 5: Implement response normalization and bounded retry behavior**

Normalize successful responses to text plus usage metadata. Reject non-2xx responses with typed errors. Retry only 429, 500, 502, 503, and 504, with two attempts maximum, exponential delays, jitter, and `AbortSignal` cancellation. Reject responses over `32768` bytes before parsing and never summarize or repair them.

- [ ] **Step 6: Run provider tests and commit**

Run: `npm --prefix agent_harness test -- --run tests/providers && npm --prefix agent_harness run typecheck`

Expected: mocked provider tests pass without network access or credentials.

```bash
git add agent_harness/src/config/model-catalog.ts agent_harness/src/providers agent_harness/tests/providers
git commit -m "feat: add Google Agent Platform model adapter"
```

### Task 4: Add the JPEG Playwright browser controller

**Files:**
- Create: `agent_harness/src/browser/playwright-controller.ts`
- Create: `agent_harness/src/browser/browser-types.ts`
- Create: `agent_harness/tests/browser/playwright-controller.test.ts`

**Interfaces:**
- Produces a reusable process host and isolated per-run sessions:

```ts
export interface BrowserSession {
  screenshot(quality: number): Promise<Uint8Array>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserHost {
  openSession(
    url: string,
    viewport: { width: 1080; height: 675 },
  ): Promise<BrowserSession>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write tests using a fake Playwright page**

Assert that `openSession` reuses one launched browser, creates a new scale-factor-one context, and navigates its page. Assert that `screenshot` calls Playwright with `{ type: "jpeg", quality: 90 }`, `move` calls `page.mouse.move`, and `click` calls `page.mouse.click`. Assert that closing a session closes its page/context but not the shared browser, while closing the host closes Chromium. Assert that no controller method reads DOM content or evaluates JavaScript.

- [ ] **Step 2: Run the browser unit tests and verify they fail**

Run: `npm --prefix agent_harness test -- --run tests/browser/playwright-controller.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement browser lifecycle and direct JPEG capture**

Launch one headless Chromium instance lazily in `PlaywrightBrowserHost` and reuse it. `openSession` creates a fresh context with `{ viewport, deviceScaleFactor: 1 }`, opens the URL, waits for the initial page load and the configured 100 ms settle delay, and stores no task metadata. `screenshot` returns only the current JPEG bytes. `move` and `click` use CSS-pixel coordinates. Session close and host close are independently idempotent.

- [ ] **Step 4: Run unit tests and commit**

Run: `npm --prefix agent_harness test -- --run tests/browser && npm --prefix agent_harness run typecheck`

Expected: all browser-controller tests pass without downloading Chromium.

```bash
git add agent_harness/src/browser agent_harness/tests/browser
git commit -m "feat: add screenshot-only Playwright controller"
```

### Task 5: Implement streaming logs, action execution, and the serialized run loop

**Files:**
- Create: `agent_harness/src/logging/run-logger.ts`
- Create: `agent_harness/src/actions/executor.ts`
- Create: `agent_harness/src/core/run-state.ts`
- Create: `agent_harness/src/core/run-loop.ts`
- Create: `agent_harness/tests/core/run-loop.test.ts`
- Create: `agent_harness/tests/logging/run-logger.test.ts`

**Interfaces:**
- Consumes `HarnessConfig`, `ModelAdapter`, `BrowserHost`, and the
  harness-local `parseAgentAction` and `validateActionBounds`.
- Produces `RunSummary` and `RunLoop.run()`.

```ts
export type RunStatus = "completed" | "incomplete" | "failed";

export interface RunSummary {
  status: RunStatus;
  stepCount: number;
  observationCount: number;
  actionCount: number;
  invalidActionCount: number;
  failureReason?: string;
}

export interface RunLoopDependencies {
  browserHost: BrowserHost;
  model: ModelAdapter;
  logger: RunLogger;
  now?: () => number;
}

export class RunLoop {
  constructor(private readonly dependencies: RunLoopDependencies) {}
  run(config: HarnessConfig, publicInstruction: string): Promise<RunSummary>;
}
```

- [ ] **Step 1: Write deterministic mock-model tests**

Test a model sequence `[MOVE, CLICK, DONE]` completes. Test malformed JSON, extra fields, negative coordinates, and out-of-bounds coordinates are logged and not executed. Test max steps and max invalid actions terminate with `incomplete` or `failed` summaries. Test that invalid actions reuse the same screenshot bytes and add only a public schema reminder.

- [ ] **Step 2: Run focused run-loop tests and verify they fail**

Run: `npm --prefix agent_harness test -- --run tests/core/run-loop.test.ts`

Expected: FAIL because logger, executor, and run-loop modules are missing.

- [ ] **Step 3: Implement streaming redacted JSONL logging**

Write one event per call with run ID, step, screenshot ID, provider/model, timings, raw output, parsed action, validity, and terminal status. Redact `Authorization`, access tokens, service-account fields, and any environment-variable-looking values. Write screenshots by ID directly to the run directory; never retain the complete event list.

- [ ] **Step 4: Implement the action executor**

Dispatch only `MOVE` and `CLICK` to the controller after bounds/policy validation. Dispatch `DONE` to termination logic without browser access. Do not clamp coordinates, infer purposes, or retry execution silently.

- [ ] **Step 5: Implement the serialized run loop**

Open a fresh `BrowserSession` from the shared host, capture one JPEG, call the model, parse the returned JSON, validate policy, log, execute, wait 100 ms, and repeat. Wrap each model request in an `AbortController`. Reuse unchanged JPEG bytes on invalid-action retries. Enforce step, invalid-action, request, and total-run limits. Close the per-run session in `finally`; the CLI closes the reusable host after its run queue. Return a summary even after failure.

- [ ] **Step 6: Run tests and commit**

Run: `npm --prefix agent_harness test -- --run tests/core tests/logging && npm --prefix agent_harness run typecheck`

Expected: deterministic completion, rejection, timeout, and memory-lifecycle tests pass.

```bash
git add agent_harness/src/actions agent_harness/src/core agent_harness/src/logging agent_harness/tests/core agent_harness/tests/logging
git commit -m "feat: add bounded agent run loop"
```

### Task 6: Add the CLI, local deterministic integration path, and no-cheating tests

**Files:**
- Create: `agent_harness/src/cli.ts`
- Create: `agent_harness/src/prompts/public-instruction.ts`
- Create: `agent_harness/tests/no-cheating/observation-boundary.test.ts`
- Create: `agent_harness/tests/integration/mock-run.test.ts`
- Create: `agent_harness/tests/fixtures/public-task.html`
- Create: `agent_harness/README.md`
- Create: `agent_harness/.env.example`
- Modify: `README.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- CLI command: `npm --prefix agent_harness start -- --config path/to/run.json`.
- Produces a run summary and private `agent_harness/runs/<run-id>/events.jsonl`.

- [ ] **Step 1: Write no-cheating and mock integration tests**

Insert `SECRET_ANSWER_CANARY` into a private fake trial object and assert it is absent from every `ModelRequest`, serialized provider body, log prompt, screenshot filename, and URL. Run the mock model against a local deterministic fixture owned by `agent_harness/tests/fixtures/` that exposes only public instructions and buttons; assert the fixture receives pointer events and the controller never calls `page.content`, `page.locator`, `page.evaluate`, or accessibility APIs. Do not import website source modules.

- [ ] **Step 2: Run these tests and verify they fail**

Run: `npm --prefix agent_harness test -- --run tests/no-cheating tests/integration`

Expected: FAIL until the CLI wiring and boundary fixtures exist.

- [ ] **Step 3: Implement public instruction generation and CLI wiring**

Use a fixed public instruction for each supported route that names only the participant-visible task goal and allowed action JSON shape. Load JSON configuration, resolve the catalog model, create one adapter/controller/logger, run the loop, print a redacted summary, and set a nonzero exit status for failed or incomplete runs. Never print raw credentials or screenshots.

- [ ] **Step 4: Add environment documentation**

Document `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI`/Agent Platform settings, ADC setup, model enablement, Chromium installation, and the deployed Firebase URL. Document that `run=dev` is the safe default for smoke testing and `run=ops` is the full operation. State that the website—not the harness—saves results and trajectories.

- [ ] **Step 5: Run all local tests and commit**

Run: `npm --prefix agent_harness test && npm --prefix agent_harness run typecheck && git diff --check`

Expected: all harness tests and type checks pass with no paid model call.

```bash
git add agent_harness README.md docs/deployment.md
git commit -m "feat: add agent harness CLI and boundary tests"
```

### Task 7: Add an explicitly opt-in Google smoke run and final verification

**Files:**
- Create: `agent_harness/tests/live/google-smoke.test.ts`
- Modify: `agent_harness/README.md`
- Modify: `docs/superpowers/specs/2026-08-16-agent-harness-design.md` only if implementation constraints require a documented correction

**Interfaces:**
- Consumes the real `GoogleAgentPlatformAdapter` and deployed Firebase URL only when explicitly enabled.

- [ ] **Step 1: Add a skipped-by-default live test**

Guard the test with `RUN_GOOGLE_SMOKE === "1"` and require `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `AGENT_TASK_URL`, and `AGENT_MODEL`. Use `run=dev`, `participant_id=A001`, max 10 steps, and a low-latency vision model. Never run it from the default test command.

- [ ] **Step 2: Execute the smoke test only with explicit operator configuration**

Run: `RUN_GOOGLE_SMOKE=1 npm --prefix agent_harness test -- --run tests/live/google-smoke.test.ts`

Expected: the model can open the deployed task, perform at least one visible action, and terminate or fail with a complete private log. Do not claim success if the website save status is not visible.

- [ ] **Step 3: Run final verification**

Run: `git diff --check && npm --prefix agent_harness test && npm --prefix agent_harness run typecheck && git diff --name-only HEAD~1`

Expected: all harness tests and type checks pass; no untracked runtime logs or credentials appear in `git status --short`; every non-Markdown changed file is under `agent_harness/`.

- [ ] **Step 4: Commit final verification changes**

```bash
git add agent_harness
git commit -m "test: add opt-in Google agent smoke run"
```

## Plan Self-Review

- **Spec coverage:** browser lifecycle, JPEG memory policy, Google model catalog, all three Google request families, action boundary, no-cheating tests, retries, timeouts, logging, model switching, and future OpenAI extension are covered by Tasks 1–7.
- **Website safety:** Firebase Hosting files, task renderers, shared website code,
  save APIs, Functions, root package files, and human-mode paths are read-only.
  Implementation changes are confined to `agent_harness/`; only Markdown
  documentation may change elsewhere.
- **Memory safety:** direct JPEG capture, one in-flight observation, invalid-action JPEG reuse, streaming logs, response-size limits, and a long mock-run lifecycle test are explicit.
- **Latency safety:** reused browser/API clients, scale-factor-one native screenshots, bounded settle delay, short structured output, non-streaming calls, bounded retries, and phase timing metrics are explicit.
- **Placeholder scan:** complete; no unspecified implementation steps remain.
- **Type consistency:** `ModelAdapter`, `ModelRequest`, `ModelResponse`, `BrowserController`, `HarnessConfig`, `RunLoopDependencies`, and `RunSummary` are defined before later tasks consume them.
