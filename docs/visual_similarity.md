# 2AFC Visual Similarity

## Scope

Build one browser experiment for human and visual-agent observers. Use a
**Vite + TypeScript** app with **jsPsych v8**: jsPsych owns the timeline,
instructions, phases, progress, and completion; a custom 2AFC trial component
owns rendering, center-cross gating, preloading, responses, and trajectories.
Implement task-specific code in `tasks/visual_similarity` and reuse
`tasks/shared` for app, session, persistence, and agent infrastructure.

Load `/data/dreamsim_100/data_100_web.csv`. Generate it from the source
`data/dreamsim/data_100.csv` with `data/dreamsim/prepare_web_stimuli.py`;
the manifest and deployable 512-pixel JPEGs are written under
`public/data/dreamsim_100/`.
Rows `0–2` are training; row `3+` are testing. Preserve the source unique ID
when present, otherwise preserve `csv_row_index`.

## Current Implementation

```text
tasks/shared/app/main.ts                 app bootstrap, URL mode, jsPsych timeline
tasks/shared/experiment/                 session IDs, local recovery, HTTP submit schema
tasks/visual_similarity/task.ts          CSV adapter, phase/run selection, scoring, preload
tasks/visual_similarity/renderer.ts      instructions, test-ready screen, 2AFC renderer
tasks/shared/app/styles.css               fixed psychophysics canvas and neutral styling
```

The route is `/tasks/visual-similarity`. `mode=development` selects exactly
the first 3 training and first 10 testing trials. Any other mode, including no
mode parameter, uses all testing rows. Human and agent sessions share the same
timeline, renderer, stimuli, response mapping, and persistence schema.

## Run Identity

The launcher/controller supplies run identity before opening the task, for
example:

```text
?participant_id=A001&model=gpt-5
```

Use these launch values to create the session ID and metadata. Agents never
type an identity into the participant UI, so the visible instruction/start
page remains identical across observers. Participant IDs beginning with `H`
identify human runs; IDs beginning with `A` identify agent runs. Supply the
external model in the launch URL for agent runs. `provider` and `agent_name`
are optional metadata parameters.

## Run Commands

From the repository root:

```bash
npm install                 # once, or after dependency changes
npm run dev                 # start the local app at http://127.0.0.1:5173
npm test                    # run unit tests
npm run build               # type-check and create a production build
/Users/tonyfeng/miniconda3/envs/tony/bin/python data/dreamsim/prepare_web_stimuli.py  # generate 512 px JPEG stimuli + CSV manifest
```

Open one of these URLs after `npm run dev`:

```text
# Developer testing: 3 training + 10 testing trials
http://127.0.0.1:5173/tasks/visual-similarity?participant_id=H001&mode=development

# Human participant: full run
http://127.0.0.1:5173/tasks/visual-similarity?participant_id=H001

# Visual-agent development run
http://127.0.0.1:5173/tasks/visual-similarity?participant_id=A001&model=gpt-5&mode=development
```

`mode=development` selects the first three training and first ten testing
trials. Omit it for the full run. Without a results API, failed final
submissions remain in browser recovery storage and expose JSON downloads.

The conversion command reads only images referenced by `data_100.csv`, writes
JPEGs at quality 100 with their longest edge at most 512 px, and preserves
their relative folder paths under `public/data/dreamsim_100/`. Run it before
deploying or whenever the source CSV changes. Vite serves those public assets
at `/data/dreamsim_100/...` locally and copies them to the production build at
the same URL.

## Participant Flow

```text
 Instructions → training (3) → test-ready confirmation → testing (remaining)
 → saving → completion
```

- Instructions explain the center reference, left/right candidates, click
  response, training feedback, testing without feedback, and no refresh.
- Every trial starts with a clickable `+` at the exact center of a fixed,
  logged trial viewport. The cross occupies the future center of the
  reference-image frame and is the only visible trial content until clicked;
  its clickable target is 40 × 40 px; do not show placeholder image frames
  during this pointer-centering stage.
- Use a fixed 1080 × 675 CSS-pixel experiment canvas. Do not responsively
  scale it; require a viewport at least this large.
- Then show three equal 220 × 220 px frames in one horizontal row: left
  candidate, reference, right candidate. Show only the bold `reference` label
  under the reference image. Decode all three images before they are visible.
- Use a formal neutral grayscale interface: plain background, dark text, thin
  gray borders, and no decorative color treatment.
- Training responses show brief alignment feedback. Testing responses
  transition neutrally. Maintain separate training/testing progress.
- Training feedback is phrased as `Aligned with most human responses` or `Not
  aligned with most human responses`; an unaligned training response remains
  visible for an extra 0.5 seconds. Testing does not reveal this feedback. The reference
  frame uses a visibly heavier border than candidate frames, and candidate
  images show a subtle gray frame on hover.
- After training, show “Are you ready for the real test?” and require the
  observer to select `Continue` before the first testing trial begins.
- Lock both candidates after the first response.

Use the state sequence:

```text
PREFETCHED → WAITING_FOR_CENTER_CLICK → STIMULUS_VISIBLE
→ RESPONSE_REGISTERED → SAVED_IN_MEMORY → NEXT_TRIAL
```

The existing renderer exposes the public image paths only. It retains the
correct side privately until it writes the session result.

## Preload and Trajectories

During testing, maintain a rolling buffer of the next five triplets. On trial
completion, promote the next prepared triplet and start preparation for the
next unseen one. If preparation is incomplete, retain a neutral state and log
the delay; never show partial stimuli.

Record testing-only `pointermove` events from center-cross click through the
first candidate response. Keep actual timestamps; optionally throttle but do
not interpolate during acquisition. Store raw coordinates plus:

```text
x_norm = x / trial_area_width
y_norm = y / trial_area_height
x_centered = (x - center_x) / trial_area_width
y_centered = (y - center_y) / trial_area_height
```

## Data and Persistence

Keep public render data separate from private scoring data. Record only testing
trials; training remains feedback-only and is not written to results or
trajectory files. A testing trial result
includes session/observer identifiers, phase, source row identity, displayed
image paths, target side, selected side, correctness, cross/stimulus/response
timestamps, `reactionTimeMs` (`responseAt - crossClickedAt`), response
coordinates, viewport, and preload timings. A trajectory
row includes trial ID, sample index, timestamp, elapsed time from cross click,
and raw/normalized/centered coordinates.

Store in-progress data in browser-local recovery storage. After the last
testing trial, show a blocking “Saving your results—do not close this window”
screen and POST one complete session payload to the HTTP results API. The API
must atomically persist two JSON files keyed by a filesystem-safe `session_id`:

```text
{participant_id}_{provider}_{model}_{UTC}_<random8>
# e.g. A001_openai_gpt-5_20260813T143022Z_a1b2c3d4

results/{session_id}.json       # session metadata and 2AFC trial records
trajectories/{session_id}.json  # testing pointer-trajectory records
```

Use an `H` participant ID for people and an `A` participant ID for agents.
Agent metadata includes the provider and the exact model label supplied in the
URL (for example `openai` and `gpt-5.6-luna`). The UTC timestamp documents run
start time; the random eight-character suffix prevents concurrent filename
collisions. Store `session_id`, `observer_type`, `participant_id`, `agent_provider`,
`agent_model`, and ISO-8601 `started_at_utc` as structured fields in the
results JSON, not only in its filename.

Retry a bounded number of failed submissions, retain recovery data on failure,
and show completion only after explicit API success. Attempt `window.close()`
only then; if blocked, ask the observer to close the window. A browser-only
fallback may download those same two JSON files, but it is not sufficient for
unattended agent runs.

## Concurrent Agent Runs

The task must support simultaneous agent/browser sessions without shared
mutable state. Generate a unique `session_id` and logged random seed per run;
namespace browser recovery storage by `session_id`; keep the jsPsych timeline,
preload buffer, trial cursor, trajectories, and controller state per browser.
The results API must use `session_id` as an idempotency key: a retry may update
the same session but must never merge or overwrite a different session.

Use bounded per-session preloading (five triplets) and bounded controller
concurrency so parallel runs do not exhaust browser, network, or image-memory
resources. Include a concurrency test that runs two independent sessions and
asserts distinct IDs, isolated storage/results, and no cross-session trial or
trajectory records.

## Human and Agent Boundary

Both observers use the same URL, layout, timeline, stimuli, response mapping,
and result schema. `observer_type` is `human` or `agent`.

The visual agent receives screenshots and may issue only constrained pointer
or keyboard actions. It must not receive DOM/HTML/accessibility-tree access,
CSV rows, filenames, task configuration, private trial state, correctness,
answer keys, source code, filesystem access, or browser scripting access.
Public renderer state contains only visible instructions and displayable image
paths; private state retains target side and correctness.

## Acceptance Checks

- Current unit coverage: CSV phase split, development/full selection, scoring,
  pointer normalization, private answer omission, preload waiting, fixed
  viewport validation, horizontal stimulus markup, and test-ready confirmation.
- Run `npm test` and `npm run build` before handoff.
- Add browser coverage for cross gating, response de-duplication, training-only
  feedback, fixed geometry, preload behavior, and save/retry UI.
- Add concurrency, results-API idempotency, and no-cheating canary tests before
  unattended agent collection.
