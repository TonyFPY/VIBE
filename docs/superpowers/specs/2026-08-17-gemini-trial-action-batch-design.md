# Gemini trial-level custom action batches

**Status:** Draft for review

## Decision

The agent loop will operate at the experiment-trial boundary. Gemini receives
one screenshot at the beginning of an interaction. Its screenshot-oriented
Computer Use browser context is retained, but native pointer and browser
control functions are excluded. The adapter exposes client-executed custom
functions whose coordinate arguments are validated and executed by Playwright.

The custom functions are:

- `click_visible({ x, y, intent })` for one visible setup or navigation click.
- `submit_trial_actions({ moves, click })` for one trial-response batch. The
  `moves` array contains 9 through 49 normalized pointer coordinates, and the
  separate `click` coordinate is always flattened as the final action.

The accepted trial-response batch grammar is:

```text
submit_trial_actions(moves{9,49}, click)
```

The adapter flattens each custom function call into shared pointer actions.
Trial-response batches therefore contain at least 10 actions: at least nine
separate `move` actions followed by one final `click`. The total flattened
batch length is capped at 50 actions. The setup action uses `click_visible` and
must contain exactly that one click. Native pointer calls, `wait`, navigation,
keyboard, scrolling, dragging, and any second click are rejected for this
condition. The final click is the trial response.

The custom function coordinates are integer values in the inclusive `0..999`
normalized range. The adapter maps them to the fixed `1080 x 675` CSS viewport
with `Math.floor(x / 1000 * 1080)` and `Math.floor(y / 1000 * 675)`; malformed,
fractional, or out-of-range values are rejected rather than repaired.

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
  ↓ deployed stimuli prepare before fixation
controller-owned center fixation
  ↓ screenshot
Gemini calls submit_trial_actions
  ↓ Playwright executes 9–49 moves → click
website records the final click and trial ends
  ↓ grouped continuation results + one fresh screenshot
if not complete: center fixation → next screenshot
website saving/completed state
```

The Start action remains model-controlled because the controller cannot locate
the Start button through the DOM or task metadata. The center fixation remains
controller-owned, is not reported as a model action, and uses the same browser
mouse policy as other pointer movement. The first screenshot is taken on the
instructions page before any fixation. After a batch's final click, the run
waits for the configured settle delay, allowing deployed stimuli to prepare,
then checks evaluator-owned backend completion before beginning another
fixation. The repository run example uses `settleDelayMs: 2000`. A successful
result save ends the run without another Gemini request.

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
```

`AgentTurn.actions` already carries an ordered action list. The run loop adds a
phase-aware batch validator. For the setup batch it requires exactly one final
`click` action, which is the flattened `click_visible` setup call. For each
CSS-pixel coordinate it applies the existing finite, in-viewport policy.

For each trial-response batch it applies the same checks but requires at least
10 actions. Validation covers the entire batch before any browser action
executes. A malformed batch is rejected as a unit and never partially
applied. A short trial-response batch is reported as rejected with the
unchanged screenshot so Gemini can retry; it does not consume a trial or
execute any pointer action.

## Gemini adapter

The adapter parses all ordered `function_call` steps in the interaction. It
accepts only `click_visible` and `submit_trial_actions` custom calls, retains
each provider call ID/name, and returns the normalized shared actions in the
same order. `click_visible` expands to one click; `submit_trial_actions`
expands to its moves followed by its final click. It rejects native pointer
calls, unsupported calls, malformed coordinates, malformed batch fields, and
flattened batches over 50 actions.

The initial text input includes a provider interaction policy telling Gemini
to use `click_visible` for the visible Start/setup target, then use
`submit_trial_actions` with at least nine separate moves and one final click
for each trial response. The task instruction remains the participant-visible
task goal. The policy guides the model; the harness enforces the phase-specific
minimum and maximum.

After execution, the continuation request contains one `function_result` for
each pending call in original order. Each result includes only the public
execution status/error. The single fresh screenshot is attached to the final
function result, so one batch produces one new visual observation. No URL,
DOM, response body, trial metadata, or answer data is added.

## Browser execution and motion

Each explicit `move` is executed sequentially through Playwright. The run
configuration exposes `mouseMoveSteps`, defaulting to `1`, which sends one
destination `mousemove` event rather than an interpolated path. The setting is
passed to the browser host and applies to both model moves and controller
fixation moves.

The harness logs each action with its batch index and total batch size. The
existing `actionCount` remains the count of executed actions, while provider
turn count remains the count of Gemini interactions. The website's own pointer
trajectory remains authoritative for behavioral analysis.

## Failure and safety behavior

- Any invalid action or invalid batch shape prevents the whole batch from
  executing.
- A browser failure stops the run; already executed actions remain logged and
  unexecuted actions are not silently repaired.
- A backend success observed after the final click has precedence over further
  provider work and skips the next fixation.
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
- batch execution order with no intermediate screenshots;
- initial instruction screenshot, Start action, center fixation, next trial
  screenshot, and saving-page/backend completion ordering;
- `mouseMoveSteps: 1` configuration and browser forwarding;
- no-cheating assertions for every function result, screenshot, action result,
  and logger event.

Paid Gemini calls remain opt-in and excluded from CI.
