# Agent Harness Design

> Superseded: this 2026-08-16 custom protocol design has been replaced by
> [the 2026-08-17 Gemini Computer Use design](2026-08-17-gemini-computer-use-adapter-design.md)
> and [implementation plan](../plans/2026-08-17-gemini-computer-use-adapter.md).
> Keep this file only as historical context.

## Purpose

Add a model-adaptable visual-agent runner under `agent_harness/`. The runner
opens an existing Firebase experiment URL in Chromium, observes only viewport
screenshots, asks a selected model for a restricted pointer action, executes
that action with Playwright, and repeats until the visible experiment is
complete.

The experiment website remains the source of truth for trials, rendering,
session identity, response collection, trajectories, and result saving. The
harness must not reproduce task logic or create another persistence pipeline.

## Goals

- Run either existing task from its deployed Firebase URL.
- Use one Playwright control loop for every supported model.
- Initially access Google, partner, and open vision models through Gemini
  Enterprise Agent Platform.
- Allow a future direct OpenAI adapter without changing browser or experiment
  code.
- Preserve the screenshot-only information boundary.
- Produce reproducible, auditable run logs without exposing private task state
  to a model.
- Keep paid model calls out of continuous integration.

## Non-Goals

- Reimplementing either experiment inside the harness.
- Reading the DOM, accessibility tree, page source, task data, answer keys, or
  JavaScript state to help the model act.
- Moving response or trajectory saving out of the website.
- Automatically choosing the best model.
- Supporting arbitrary model-generated code or unrestricted browser commands.
- Deploying the first version as a persistent service. The first version is a
  command-line worker; container or managed-job deployment can be added later.

## Repository Placement

The harness is an independent runtime package inside the existing repository:

```text
agent_harness/
  src/
    cli.ts
    config/
      load-config.ts
      model-catalog.ts
      types.ts
    core/
      observation.ts
      run-loop.ts
      run-state.ts
    browser/
      playwright-controller.ts
    providers/
      model-adapter.ts
      google-agent-platform.ts
      google-request-builders.ts
    actions/
      executor.ts
    prompts/
      public-instruction.ts
    logging/
      run-logger.ts
  tests/
    unit/
    integration/
    no-cheating/
  package.json
  tsconfig.json
  README.md
```

The normalized action types, strict parser, and browser-action policy live
inside `agent_harness/src/actions/`. The existing website repository code is a
read-only external interface and is not modified by this implementation. The
harness supports `MOVE`, `CLICK`, and `DONE` independently while interacting
with the website only through normal browser pointer events.

All implementation code changes are restricted to `agent_harness/`. Files
outside that directory may be changed only when they are Markdown
documentation. Firebase configuration, task renderers, shared website code,
Functions, persistence, and root build configuration remain unchanged.

## Architecture

```text
Run configuration
       |
       v
Firebase task URL ---> Playwright controller
                            |
                     viewport JPEG only
                            |
                            v
                 GoogleAgentPlatformAdapter
                    /        |          \
             Google API   MaaS chat   rawPredict
                 model      model       model
                    \        |          /
                     raw model response
                            |
                     strict action parser
                            |
                  CLICK / MOVE / DONE
                            |
                   policy and bounds check
                            |
                     Playwright execution
                            |
                    next viewport JPEG
```

Playwright and model access are separated by a typed observation boundary.
Only the browser module owns the Playwright `Browser`, `Context`, and `Page`
objects. Provider code receives screenshot bytes and public text, never a
browser handle.

## Core Interfaces

The provider-neutral interface is deliberately small:

```ts
interface ModelAdapter {
  readonly provider: string;
  readonly model: string;
  generateAction(request: ModelRequest): Promise<ModelResponse>;
}

interface ModelRequest {
  screenshot: Uint8Array;
  mimeType: "image/jpeg";
  publicInstruction: string;
  allowedActions: readonly AgentActionType[];
}

interface ModelResponse {
  rawOutput: unknown;
  usage?: ModelUsage;
  startedAt: string;
  completedAt: string;
}
```

`ModelResponse` intentionally returns raw provider output. The shared strict
parser, not the provider adapter, decides whether the response is a valid
action. This keeps validation identical across models and ensures malformed
actions are logged rather than silently repaired.

The first implementation is:

```ts
class GoogleAgentPlatformAdapter implements ModelAdapter
```

A future `OpenAIAdapter` implements the same interface. No browser, action,
prompt, or logging code changes when a provider is added.

## Google Agent Platform Model Catalog

Gemini Enterprise Agent Platform exposes Google, partner, and open models, but
their wire protocols are not completely uniform. An explicit model catalog
selects the request builder and prevents unsupported visual runs:

```ts
interface ModelSpec {
  modelId: string;
  publisher: string;
  apiFamily: "google" | "openai-compatible" | "raw-predict";
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportedLocations: readonly string[];
}
```

The adapter uses three private request builders:

- `google` for supported first-party Google model APIs;
- `openai-compatible` for managed models exposed through the Agent Platform
  Chat Completions endpoint;
- `raw-predict` for publisher-specific partner endpoints such as Anthropic.

Only catalog entries with `supportsVision: true` may start an experiment run.
The catalog is version-controlled instead of discovered dynamically so every
run records an exact, reviewable model ID, protocol, and location. Adding a
Google-hosted model is normally a catalog change, not a new harness adapter.

Authentication uses Google Application Default Credentials. API keys,
service-account JSON, and access tokens must not be committed or placed in the
experiment URL. Required models must be enabled in Model Garden and the runner
identity must receive only the Google Cloud permissions needed to invoke them.

## Run Configuration and Session URL

A run configuration contains operational inputs only:

```json
{
  "taskUrl": "https://example.web.app/tasks/visual-similarity",
  "participantId": "001",
  "model": "model-id-from-catalog",
  "location": "global",
  "runMode": "dev",
  "viewport": { "width": 1080, "height": 675 },
  "screenshotQuality": 90,
  "maxSteps": 100,
  "maxInvalidActions": 3
}
```

The harness constructs the experiment URL with URL encoding:

```text
<taskUrl>?participant_id=A001&model=<modelId>&run=<dev|ops>
```

The website derives `participantType: "agent"` from the `A` prefix and remains
responsible for generating the session ID. Unknown or missing run modes are not
accepted by the harness even though the website safely defaults them to
development. An explicit harness configuration avoids accidental run size
changes.

The harness uses a fresh browser context and fresh model state for every run.
Each model request is stateless in the first version: it contains the current
screenshot and the same public task instruction, with no hidden state or
cross-run memory.

Chromium uses `deviceScaleFactor: 1` so screenshot pixels match the CSS-pixel
coordinates returned by the model. The harness must not crop or downscale the
viewport because either change could remove participant-visible information or
alter coordinate accuracy.

## Observation and Prompt Boundary

Each observation contains exactly:

- JPEG bytes captured from the fixed browser viewport at the configured
  quality;
- the participant-visible task instruction;
- the allowed action names.

It must not contain:

- DOM, HTML, accessibility, selectors, or element coordinates;
- the Playwright `Page` object or any callable browser function;
- local screenshot paths or filenames;
- trial objects, stimulus metadata, correct answers, or source IDs;
- task configuration, repository files, or environment variables;
- response history containing private controller state.

Screenshots are passed to adapters as memory bytes. Playwright captures JPEG
directly rather than producing PNG and converting it afterward. The default
quality is 90, which reduces memory, network payload, and private log storage
while limiting compression artifacts in the visual stimuli. Configuration
validation accepts quality values from 80 through 100 and records the selected
value in the run log. A screenshot may be written to the private run log after
it receives a generated screenshot ID, but neither that ID nor its filesystem
path is sent to the model. The run loop retains only the current screenshot
buffer and releases it after the provider request and private log write finish.

## Actions and Execution

The normalized action set is:

```text
CLICK(x, y, purpose)
MOVE(x, y)
DONE
```

`purpose` is one of `navigation`, `fixation`, or `response`. Coordinates are
finite CSS-pixel values inside the configured viewport. Task-specific allowlists
can disable an action type, but no model may request arbitrary JavaScript,
keyboard macros, shell commands, navigation, or filesystem access.

The executor uses only public browser inputs:

- `MOVE` calls Playwright mouse movement so the website records normal pointer
  events;
- `CLICK` uses the Playwright mouse at the requested coordinates;
- `DONE` terminates only after the model has visually identified the public
  completion state.

The controller does not inspect the DOM to locate targets or judge correctness.
It waits a small configured settle interval after an action, captures the next
screenshot, and continues.

## Run Loop

For every run:

1. Validate configuration and resolve a vision-capable model catalog entry.
2. Create a fresh Chromium context with the configured viewport.
3. Open the constructed Firebase task URL.
4. Capture the viewport directly as JPEG bytes at the configured quality.
5. Send the JPEG, public instruction, and action allowlist through the adapter.
6. Log the raw response and parse it with the shared strict action parser.
7. Validate the action type, purpose, coordinate bounds, and run policy.
8. Execute a valid public pointer action, or record an invalid action without
   executing it.
9. Repeat from step 4 until valid `DONE`, the step limit, the invalid-action
   limit, a timeout, or an unrecoverable provider/browser failure.
10. Close the context and write the final harness summary.

The website independently saves behavioral results and trajectories through
its existing API. The harness does not retry, rewrite, or upload those records.

## Performance and Resource Design

The design minimizes harness overhead without changing the experiment pixels,
timing rules, or information boundary.

### Browser lifecycle

- Launch one headless Chromium process for a sequential batch of runs.
- Create a new isolated browser context for every run and close it immediately
  at the terminal state. This preserves fresh cookies, cache, storage, and
  session state while avoiding repeated Chromium startup cost.
- Keep batch concurrency at one by default. A configurable concurrency limit
  may be added for throughput testing, but it must be bounded by memory and
  model quota rather than allowed to grow with the queue.
- Keep the native `1080 × 675`, scale-factor-one viewport. Do not block task
  images, fonts, or other resources needed for equivalent rendering.

### Observation lifecycle

- Capture JPEG directly from Playwright at quality 90; do not create a PNG or
  an intermediate image conversion.
- Retain at most the current screenshot and its in-flight provider encoding.
  Release binary and base64 representations as soon as the request and private
  log write complete.
- Write screenshots directly to disk with backpressure instead of collecting
  them in a run-level array.
- If an action is invalid and the browser has not changed, reuse the current
  JPEG for the retry. Append only a schema-validation reminder to the public
  prompt; do not recapture identical pixels or expose private state.

### Model request lifecycle

- Create the Google authentication and HTTP clients once per harness process.
  Reuse authorized sessions and HTTP keep-alive connections across calls.
- Resolve and validate the model catalog entry once at run start.
- Request exactly one action per call and cap output at 128 tokens by default.
- Prefer provider-supported structured JSON output. For models without it, use
  the same short JSON-only instruction and strict parser.
- Use non-streaming responses because the complete, short action is required
  before validation; token streaming adds coordination overhead without
  enabling earlier execution.
- Keep requests stateless. Do not resend prior screenshots or raw model output.
- Reuse or cache only the static public instruction when a provider supports
  native prompt caching. Never cache screenshots or private controller data.
- Apply 10-second connection, 60-second model-request, and 30-minute total-run
  timeouts by default. Retry only recognized transient failures, with at most
  two retries by default. All limits are validated configuration overrides.

### Action pacing

- Use a short configurable post-action settle delay with a 100 ms default.
  The website already preloads task stimuli, so a long fixed wait would add
  delay to every step.
- Do not use DOM selectors, JavaScript evaluation, or hidden page state to skip
  the settle interval or detect readiness.
- Maintain only one in-flight screenshot, model request, and action per run.
  Backpressure prevents a slow provider from creating a memory queue.

### Logging and measurement

- Stream events to JSON Lines as they occur; do not retain the full log in
  memory.
- Cap the accepted raw model response at 32 KiB by default and record an
  oversize response as invalid. The action parser validates only the bounded
  original response and never a repaired or summarized version.
- Record separate durations for navigation, screenshot capture, request
  serialization, provider wait, parsing, action execution, settling, and log
  writes.
- Summarize count, median, and p95 durations after a batch. Provider wait is
  reported separately from harness overhead so optimization targets the actual
  bottleneck.
- Post-run JSON Lines compression is disabled by default. When explicitly
  enabled, compress only after the browser context closes, never in the action
  loop where it would add CPU delay.

These rules require harness-owned memory to remain bounded with step count.
Long runs may create more files on disk, but they must not retain more
screenshots, response bodies, or log events in process memory.

## Logging

Harness logs are distinct from behavioral result files. Each run writes a
private append-only JSON Lines event stream containing, where available:

```text
run ID
website session ID if publicly available at completion
provider and exact model ID
model catalog protocol and location
viewport
screenshot quality
screenshot ID
step and observation count
model request start and completion timestamps
raw model output
parsed action
action validity and validation error
action execution timestamp
provider usage metadata
terminal status and failure reason
```

Screenshots live in a per-run private directory keyed by screenshot ID. Logs
and screenshots are excluded from Git. Sensitive credentials and bearer tokens
are never logged.

## Error Handling

- **Invalid model output:** log the raw output and validation error, do not
  execute or silently repair it, then reuse the unchanged observation with a
  schema-only validation reminder until `maxInvalidActions` is reached.
- **Out-of-bounds coordinates:** treat as an invalid action; do not clamp them.
- **Provider throttling or transient failure:** retry with bounded exponential
  backoff and jitter; record every attempt. Do not switch models automatically.
- **Browser or navigation failure:** capture a private diagnostic screenshot,
  close the context, and terminate the run as failed.
- **Step or wall-clock limit:** terminate as incomplete and preserve all logs.
- **Website save failure:** leave recovery behavior to the visible website. The
  model may interact with participant-visible recovery controls through the
  same screenshot/action loop.
- **Model returns `DONE` too early:** record an incomplete termination. The
  harness does not infer hidden completion from DOM state.

## Testing Strategy

### Unit tests

- configuration validation, JPEG quality bounds, and URL construction;
- model catalog resolution and vision-capability checks;
- request-builder selection for all three Google API families;
- strict parsing for `CLICK`, `MOVE`, and `DONE`;
- bounds, purpose, step-limit, and invalid-action policies;
- provider response normalization and retry classification;
- JSON Lines logging with credential redaction.
- bounded screenshot buffers, streamed logging, and response-size limits;
- fixed device scale, JPEG reuse after invalid actions, and timing summaries.

### Deterministic integration tests

- a mock model completes a local deterministic experiment through screenshots
  and pointer actions;
- a mock model produces malformed and out-of-bounds actions that are logged and
  rejected;
- a long mock run verifies that screenshot and event objects are released
  rather than retained with step count;
- Playwright pointer actions reach a deterministic public-page fixture and, in
  an opt-in live smoke test, the existing website without importing or changing
  website code;
- a scope audit confirms implementation changes are confined to
  `agent_harness/` plus Markdown documentation.

### No-cheating tests

Use canary values such as `SECRET_ANSWER_CANARY` in private trial state and
assert they never appear in:

- observations;
- public prompts;
- serialized Google API requests;
- adapter logs or model-visible screenshot identifiers.

Provider modules must have no Playwright dependency. Tests also assert that
their request types cannot contain a `Page`, DOM snapshot, selector,
accessibility tree, or callable browser interface.

### Optional live smoke test

A manually enabled test may call one inexpensive vision-capable Google-hosted
model against a development task. It is skipped by default and never runs in
CI. Paid partner-model calls require an explicit model selection and operator
confirmation.

## Delivery Sequence

1. Scaffold the isolated `agent_harness` TypeScript package and tests.
2. Implement a harness-local `MOVE`/`CLICK`/`DONE` action contract and boundary
   tests.
3. Implement configuration, model catalog, strict policy, and private logging.
4. Implement the Playwright controller against a deterministic mock adapter.
5. Add no-cheating request serialization tests.
6. Implement the Google Agent Platform adapter and its protocol builders.
7. Add a manually invoked development smoke test using a vision model.
8. Verify one task end-to-end while preserving existing human behavior and
   website result saving.

## Acceptance Criteria

- One command starts a configured agent run against a deployed Firebase task.
- The same Playwright loop works with at least one Google-hosted vision model
  and one non-Google vision model available through Google Agent Platform.
- Switching those models requires configuration only.
- The model receives screenshots, public instructions, and action names only.
- Invalid actions are logged and never corrected or executed silently.
- Existing website persistence saves agent behavioral results and trajectories.
- Harness logs include the model, timings, raw output, parsed action, validity,
  screenshot IDs, and terminal status.
- Per-step work is serialized with bounded memory, direct JPEG capture, reused
  clients, and no redundant screenshot after an invalid action.
- Performance summaries separate provider latency from browser and harness
  overhead.
- Unit, deterministic integration, and no-cheating tests pass without paid
  model calls.
- Adding a future direct OpenAI adapter requires no changes to the controller,
  run loop, action parser, or website.
- No website source, Firebase configuration, Functions code, root build code,
  or non-Markdown file outside `agent_harness/` is modified.
