# Gemini trial-level action batches

**Status:** Draft for review

## Decision

The agent loop will operate at the experiment-trial boundary. Gemini receives
one screenshot at the beginning of an interaction and may return an ordered
batch of native Computer Use function calls. The harness executes the whole
batch before capturing the next screenshot.

The accepted batch grammar is:

```text
move* click
```

There is no forced minimum length: a model may emit only a click, or several
moves followed by a click. The total batch length is capped at 50 actions.
`wait`, navigation, keyboard, scrolling, dragging, and any second click are
invalid for this condition. The final click is the trial response.

This follows Gemini's documented Interactions API pattern for multiple
function calls and one function result per executed call:

- https://ai.google.dev/gemini-api/docs/computer-use
- https://ai.google.dev/gemini-api/docs/function-calling

## Lifecycle

```text
instructions page
  ↓ screenshot
Gemini emits Start batch
  ↓ execute batch
controller-owned center fixation
  ↓ screenshot
Gemini emits trial batch (move* → click)
  ↓ execute all actions without an intermediate screenshot
website records the final click and trial ends
  ↓ if not complete: center fixation → next screenshot
website saving/completed state
```

The Start action remains model-controlled because the controller cannot locate
the Start button through the DOM or task metadata. The center fixation remains
controller-owned, is not reported as a model action, and uses the same browser
mouse policy as other pointer movement. The first screenshot is taken on the
instructions page before any fixation. After a batch's final click, the run
waits for the configured settle delay and checks evaluator-owned backend
completion before beginning another fixation. A successful result save ends
the run without another Gemini request.

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
batch validator that checks:

1. one through 50 actions;
2. every action before the last is `move`;
3. the last action is `click`;
4. each CSS-pixel coordinate passes the existing finite, in-viewport policy.

Validation covers the entire batch before any browser action executes. A
malformed batch is rejected as a unit and never partially applied.

## Gemini adapter

The adapter parses all ordered `function_call` steps in the interaction. It
accepts only modern `move` and `click` calls for the batch, retains every call
ID/name, and returns the normalized shared actions in the same order. It
rejects unsupported calls, malformed calls, multiple clicks, clicks before the
last action, and batches over 50.

The initial text input includes a provider interaction policy telling Gemini
to use an ordered path of separate `move` calls followed by a final `click`,
without padding a batch. The task instruction remains the participant-visible
task goal. The policy guides the model but does not force a minimum number of
moves.

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

- native multi-call parsing in order, including 50-action acceptance and
  51-action rejection;
- `move* → click` acceptance and invalid sequence rejection;
- one continuation request containing one result per call and one screenshot;
- batch execution order with no intermediate screenshots;
- initial instruction screenshot, Start action, center fixation, next trial
  screenshot, and saving-page/backend completion ordering;
- `mouseMoveSteps: 1` configuration and browser forwarding;
- no-cheating assertions for every function result, screenshot, action result,
  and logger event.

Paid Gemini calls remain opt-in and excluded from CI.
