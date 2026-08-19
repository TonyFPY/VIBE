# Gemini custom action-batch design

**Status:** Current implementation direction

This document defines the provider-facing custom-function contract. The
experiment lifecycle, navigation handling, and browser timing are specified
in the [trial-level design](2026-08-17-gemini-trial-action-batch-design.md).

## Decision

Use Gemini's screenshot reasoning with client-side custom function calling for
pointer batches. Do not rely on Gemini's native predefined `move` and `click`
calls to arrive as one complete trial batch: native Computer Use may return one
intermediate action at a time.

The request advertises a custom `click_visible` function for setup/navigation
clicks, including Start and Continue pages, and a custom
`submit_trial_actions` function for trial responses. The
trial function has separate `moves` and final `click` fields, so its shape
cannot express a click before the path. The harness still validates every
coordinate and action count before Playwright executes anything. The setup
phase accepts exactly one action, the flattened `click_visible` click, so a
trial batch cannot bypass the visible Start step.

Gemini continues to receive only the public instruction and the current JPEG
screenshot. Playwright remains the client-side execution environment; the
custom function is only the provider-facing action contract.

## Function contracts

Coordinates in custom function arguments use Gemini's normalized `0..999`
space and map to the fixed `1080 x 675` CSS-pixel viewport using the existing
flooring conversion.

```text
click_visible({ x: integer, y: integer, intent: string })
submit_trial_actions({
  moves: [{ x: integer, y: integer }, ...],
  click: { x: integer, y: integer }
})
```

`moves` contains 9 through 49 entries. Together with `click`, a trial batch
contains 10 through 50 executable actions. The click is always the final
action. The runtime totals and derived move limits are defined in
`agent_harness/src/actions/policy.ts`. Unsupported native pointer functions,
waits, native navigation, keyboard, scrolling, dragging, and model-requested
screenshots remain excluded.

The adapter flattens one custom trial call into the existing ordered
`AgentTurn.actions` list. Pending provider calls record how many executable
actions each call produced; continuation results are grouped back into one
function result per provider call.

## Lifecycle

```text
instructions or Continue screenshot
  ↓ Gemini click_visible (navigation batch)
execute one navigation click
  ↓ controller-owned fixation + trial screenshot
Gemini submit_trial_actions (trial batch)
  ↓ execute all moves and final click without intermediate screenshots
if incomplete: controller-owned fixation + next trial screenshot
if saved: stop
```

The existing configurable settle delay remains responsible for allowing the
website to finish preparing a trial before the controller-owned fixation.

## Boundary and failure behavior

- The model receives no DOM, URL, task metadata, answer key, source code,
  filesystem path, backend payload, or Playwright object.
- A malformed custom function, an out-of-range coordinate, a trial with fewer
  than 9 moves, or a batch over 50 actions is rejected before browser input.
- Invalid batches are reported through the existing rejected-result path and do
  not partially execute.
- The website remains authoritative for trial completion, response logging,
  scoring, trajectory capture, and result persistence.

## Verification

Add unit coverage for custom tool request shape, setup click parsing, trial
batch parsing, coordinate conversion, malformed batches, grouped continuation
results, and the screenshot-only boundary. Keep integration and live Gemini
calls out of normal CI; the live smoke test remains opt-in.
