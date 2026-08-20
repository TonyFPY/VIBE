# Gemini trial-level custom action batches

**Status:** Current implementation design

## Decision

The agent loop will operate at the experiment-trial boundary. Gemini receives
one screenshot at the beginning of an interaction. Its screenshot-oriented
Computer Use browser context is retained across setup/navigation continuation
but reset after each completed trial, while native pointer and browser control
functions are excluded. The adapter exposes client-executed custom functions
whose coordinate arguments are validated and executed by Playwright.

The custom functions are:

- `click_visible({ x, y, intent })` for one visible setup or navigation click,
  including Start and Continue pages.
- `click_fixation_marker()` for a visible fixation-marker fallback. The
  harness expands it to one exact viewport-center move followed by a click and
  then captures a fresh stimulus screenshot.
- `submit_trial_actions({ trajectory })` for one trial-response batch. The
  `trajectory` array contains 9 through 49 normalized pointer coordinates, and
  the final trajectory point is flattened as both the final move and response click.

The accepted trial-response batch grammar is:

```text
submit_trial_actions(trajectory{9,49})
```

The adapter flattens each custom function call into shared pointer actions.
Trial-response batches therefore contain at least 10 actions: 9–49 model-authored
trajectory points followed by a click at the final point. The total flattened
batch length is capped at 50 actions. The setup/navigation action uses
`click_visible` and must contain exactly that one click. The fixation action
uses `click_fixation_marker` and must contain exactly one viewport-center move
followed by a click.
The trial final click must land on a surrounding candidate tile, outside the
middle reference tile;
the harness rejects a batch targeting that frame before executing any action.
Native pointer calls, unapproved native wait/navigation/keyboard/scrolling or
dragging controls, and any second click are rejected for this condition. The
documented native `wait_5_seconds` loading action remains allowed as its own
single-action wait batch. The final click in a trial batch is the trial
response.

The custom function coordinates are integer values in the inclusive `0..999`
normalized range. The adapter maps them to the fixed `1080 x 675` CSS viewport
with `Math.floor(x / 1000 * 1080)` and `Math.floor(y / 1000 * 675)`; malformed,
fractional, or out-of-range values are rejected rather than repaired.

The total trial action budget is defined in `agent_harness/src/actions/policy.ts`
by `MIN_TRIAL_BATCH_ACTIONS` and `MAX_BATCH_ACTIONS`. The Gemini schema and
parser derive the move bounds as one fewer than those totals; change those two
constants when adjusting the 10–50 budget. Navigation remains one click.

This uses Gemini's documented function-calling and interaction-continuation
mechanism. The adapter keeps one provider function call as the unit of
continuation, while the client expands its custom trial call into the ordered
browser actions that Playwright executes:

- https://ai.google.dev/gemini-api/docs/computer-use
- https://ai.google.dev/gemini-api/docs/function-calling

## Lifecycle

```text
instructions page
  ↓ screenshot
Gemini calls click_visible
  ↓ Playwright executes one setup click
settleDelayMs: 2000
  ↓ screenshot (may still show Preparing trial…)
Gemini calls wait_5_seconds while Preparing trial… is visible
  ↺ settle → screenshot until the fixation marker is visible
controller performs the exact viewport-center move → click fixation
settleDelayMs: 2000
  ↓ screenshot showing the response stimuli
Gemini calls submit_trial_actions
  ↓ Playwright executes the model trajectory and clicks its final point
website records the final click and trial ends
  ↓ settle and one fresh screenshot (may show the next loading screen)
if not complete: reset Gemini interaction → next request using that screenshot
website saving/completed state
```

The Start action remains model-controlled because the controller cannot locate
the Start button through the DOM or task metadata. After a successful trial
response, the Gemini interaction resets and the next cross-only screenshot is
presented to the provider. Gemini must request the validated
`click_fixation_marker` action before receiving the response-grid screenshot for the
next response. The first screenshot is taken on the instructions page before
any fixation. After setup/navigation or a loading wait, the harness captures a
fresh screenshot without inserting fixation; Gemini uses that screenshot to
decide whether to wait. Only the screenshot after fixation is passed to
`submit_trial_actions`, so response coordinates cannot be chosen from the
cross-only screen.
The repository run example uses `settleDelayMs: 2000`. A successful result save
ends the run without another Gemini request.

The harness does not receive a privileged trial ID or trial state. A trial
boundary is represented by the model batch's final click and the next public
screenshot; the website remains responsible for actual trial generation,
response recording, scoring, and saving.

## Interfaces

The provider-neutral interface changes continuation from one action result to
an ordered result list:

```ts
reportActionResults(
  observation: AgentObservation,
  results: readonly ActionResult[],
  signal: AbortSignal,
): Promise<AgentTurn>;

resetContext?(): Promise<void>;
```

`AgentTurn.actions` already carries an ordered action list. Each provider marks
an action turn as `navigation`, `fixation`, `trial`, or `wait`. The run loop
validates navigation turns as exactly one final `click`, even after trial
responses, so Continue is handled like Start. It validates fixation turns as
exactly one viewport-center `move` followed by `click`; wait turns as exactly
one wait action. For each CSS-pixel coordinate it applies the existing finite,
in-viewport policy.

For each trial-response batch it applies the same checks but requires at least
10 actions. Validation covers the entire batch before any browser action
executes. A malformed batch is rejected as a unit and never partially
applied. A short trial-response batch is reported as rejected with the
unchanged screenshot so Gemini can retry; it does not consume a trial or
execute any pointer action.

## Gemini adapter

The adapter parses all ordered `function_call` steps in the interaction. It
accepts `click_visible`, `click_fixation_marker`, and
`submit_trial_actions` custom calls, retains each provider call ID/name, and
returns the normalized shared actions in the same order. `click_visible`
expands to one click; `click_fixation_marker` expands to a center move followed
by a center click; `submit_trial_actions` expands its trajectory points to
moves followed by a click at the final point. It rejects native pointer calls,
unsupported calls, malformed coordinates, malformed batch fields, and
flattened batches over 50 actions.

The initial text input includes a provider interaction policy telling Gemini
to use `click_visible` for a visible Start or Continue target, wait while a
preparing/loading screen is visible, use the fixation-marker fallback only when a
cross-only screenshot is explicitly presented, and then use
`submit_trial_actions` with 9–49 trajectory points whose final point is the
response click, only after the resulting stimulus screenshot. It also states that all custom
coordinates are integer normalized values from `0` through `999`, not CSS
pixels. The task instruction remains the participant-visible task goal. The
policy guides the model; the harness enforces the phase-specific minimum and
maximum.

After a navigation batch, the continuation request contains one
`function_result` for each pending call in original order. Each result includes
only the public execution status/error, with one fresh screenshot attached to
the final result. After a completed trial batch, the Gemini adapter resets its
interaction instead; the next request contains only the public instruction and
the fresh screenshot. This bounds accumulated visual context without adding a
URL, DOM, response body, trial metadata, or answer data.

## Browser execution and motion

Each explicit `move` is executed sequentially through Playwright. The run
configuration exposes `mouseMoveSteps`, defaulting to `1`, which sends one
destination `mousemove` event rather than an interpolated path, and
`mouseMoveDelayMs`, defaulting to `20`, which paces successive model moves so
the website's 16 ms trajectory sampler can retain them. Both settings are
passed to the browser host; the delay applies to model moves, while the
fixation-marker step uses the same browser mouse policy. Gemini requests the
fixation-marker step through the provider tool, so the trial boundary remains
model-visible and provider-mediated.

The harness logs each action with its batch index and total batch size. The
existing `actionCount` remains the count of executed non-fixation actions, so
the readiness move/click is fully logged but does not change the established
setup/trial count. Provider turn count remains the count of Gemini
interactions. The website's own pointer trajectory remains authoritative for
behavioral analysis.

## Failure and safety behavior

- Any invalid action or invalid batch shape prevents the whole batch from
  executing.
- When a provider supports context reset, an invalid parsed batch is logged and
  discarded; the harness starts a fresh provider interaction from the same
  screenshot with a correction instead of reporting the rejected custom call
  as an executed function result. The correction is regenerated for each
  consecutive retry and identifies the attempt; a rejected trial-reference
  click receives explicit guidance to choose a surrounding candidate tile, not
  the middle reference tile. This prevents provider-policy failures on rejected
  action continuations and never replays the rejected browser actions.
- A browser failure stops the run; already executed actions remain logged and
  unexecuted actions are not silently repaired.
- A backend success observed after the final click has precedence over further
  provider work and skips the next readiness step.
- A provider timeout resets the pending interaction and retries one fresh
  screenshot request without replaying browser actions; a second timeout is
  terminal.
- The Gemini adapter treats the observed HTTP 400 `Input blocked` action-policy
  errors (`unsupported action`, `test harness specific action`, or the
  cross-only/`submit_trial_actions` contradiction) as recoverable: it resets
  context, retries from the latest screenshot without replaying actions, and
  stops after three provider-request recoveries. Other provider errors remain
  terminal.
- After a trial batch, an unchanged before/after screenshot is treated as a
  visible no-progress response. The loop keeps trial phase, resets context,
  retries from the fresh screenshot up to three times, and stops as incomplete
  without classifying those retries as invalid action batches.
- Invalid batches remain in the run's `invalidActionCount` telemetry, while the
  configured invalid-action limit applies to consecutive invalid batches and
  resets after a valid batch executes. This prevents isolated model mistakes
  from terminating a long run while still stopping a persistently invalid
  provider safely.
- Backend failure, timeout, provider block, invalid-action limit, and step
  limit retain their existing terminal semantics.
- The provider receives screenshots and public instruction/policy only.

## Tests

Add or update tests for:

- custom setup/trial function parsing in order, including 50-action acceptance
  and 51-action rejection;
- setup-batch acceptance only for the single setup click and trial-batch
  enforcement of the 10-action minimum;
- `move* → click` shape and invalid sequence rejection;
- one continuation request containing one result per call and one screenshot;
- trial-boundary context reset and fresh screenshot-only continuation;
- one safe provider-timeout recovery without replaying actions;
- batch execution order with no intermediate screenshots;
- provider-mediated center fixation after a successful trial, with a fresh
  cross-only screenshot before the next response;
- initial instruction screenshot, Start action, loading screenshot, repeated
  loading waits, fixation-marker readiness move/click, response-grid screenshot, trial
  batch, Continue navigation, next-screen screenshot, and saving-page/backend
  completion ordering;
- `mouseMoveSteps: 1` and `mouseMoveDelayMs: 20` configuration and browser forwarding;
- no-cheating assertions for every function result, screenshot, action result,
  and logger event.

Paid Gemini calls remain opt-in and excluded from CI.
