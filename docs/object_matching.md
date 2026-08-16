# Object Matching

## Scope

Add an object-matching task to the shared Vite + TypeScript/jsPsych v8
website. Reuse `tasks/shared` for routing, session identity, local recovery,
result submission, and the screenshot-only agent boundary. Keep task-specific
CSV parsing, preloading, layout, scoring, and tests in `tasks/object_matching`.

The route is `/tasks/object-matching`. Human and agent observers use the same
timeline, renderer, stimuli, response mapping, and result schema.

Current implementation files are `tasks/object_matching/task.ts`,
`tasks/object_matching/renderer.ts`, and `tasks/object_matching/tests/task.test.ts`.

## Data

Load `/data/rs_imagenet_100/data_web_100.csv`. Generate it from
`data/rs_imagenet/data_100.csv` with `data/rs_imagenet/prepare_web_subset.py`;
it references selected, unmodified JPEGs under
`public/data/rs_imagenet_100/`.
Each row is:

```text
trial_id,class_name,reference,candidate_0,...,candidate_7,correct_label
```

`correct_label` is the private integer `0`–`7` identifying the correct
candidate. Preserve `trial_id`, otherwise preserve `csv_row_index`.

Rows `0–2` are training; rows `3+` are testing. `mode=development` selects
the first 3 training and first 10 testing trials. Omit the mode, or use any
other value, for the complete run.

## Run Identity and Commands

Use the same launch metadata as visual similarity:

```text
?participant_id=A001&model=gpt-5
```

Participant IDs beginning with `H` identify human launches; IDs beginning with
`A` identify agent launches. Agent launches supply `model`; `provider` and
`agent_name` are optional metadata. The agent never types identity into the UI.

```bash
npm install
npm run dev
npm test
npm run build
/Users/tonyfeng/miniconda3/envs/tony/bin/python data/rs_imagenet/prepare_web_subset.py  # copy selected stimuli and create data_web_100.csv
```

```text
# Human developer test: 3 training + 10 testing trials
http://127.0.0.1:5173/tasks/object-matching?participant_id=H001&mode=development

# Human full run
http://127.0.0.1:5173/tasks/object-matching?participant_id=H001

# Agent developer test
http://127.0.0.1:5173/tasks/object-matching?participant_id=A001&model=gpt-5&mode=development
```

Run the subset command before deployment or after changing `data_100.csv`.
It writes the selected subset to `public/data/rs_imagenet_100/`; Vite serves
those files at `/data/rs_imagenet_100/...` locally and copies them to the
production build at the same URL.

## Participant Flow

```text
Instructions → training (3) → test-ready confirmation → testing (remaining)
→ saving → completion
```

- The instruction page explains the centered reference, eight labelled options,
  center-cross click, one-click response, training feedback, testing without
  feedback, and no refresh.
- After training, show **“Are you ready for the real test?”** and require
  `Continue` before the first testing trial.
- Show separate training and testing progress bars. Advance a bar only after
  a valid response is recorded.
- Training responses show brief text-only `Correct` / `Incorrect` feedback.
  Correct feedback is large and green; incorrect feedback is large and red and
  remains visible for 1.15 seconds. Testing responses advance without feedback.

## Fixed Trial Geometry

Use the same formal, fixed-display approach as visual similarity:

- Require a browser viewport at least 1080 × 675 CSS pixels; never responsively
  scale task stimuli.
- Render an 1080 × 675 CSS-pixel neutral grayscale canvas: white background,
  dark text, thin gray borders, and no decorative color treatment.
- Place the reference at the canvas center. Place eight fixed candidates around
  it in this label-to-position mapping:

```text
          option 0     option 1     option 2

          option 3     reference    option 4

          option 5     option 6     option 7
```

- Use equal 160 × 160 px frames for the reference and every candidate. Center
  the 720 × 560 px stimulus grid in the canvas, leaving room for labels and
  keeping every image inside the fixation view. Do not render text under the
  options; option identity is conveyed by fixed spatial position. Render the
  bold label `reference` under the reference image and use a visibly heavier
  border for that frame. Options show a subtle gray frame on hover.
- Before the trial is revealed, show only a clickable `+` at the exact center
  of the future reference frame. Use a 40 × 40 px clickable target and do not
  show placeholder image frames. Clicking it replaces the cross with the nine
  images.
- Decode all nine images before the cross becomes available; never show a
  partial trial. Disable all candidate buttons immediately after the first
  valid selection.

Use this state sequence:

```text
PREFETCHED → WAITING_FOR_CENTER_CLICK → STIMULUS_VISIBLE
→ RESPONSE_REGISTERED → SAVED_IN_MEMORY → NEXT_TRIAL
```

## Preloading and Pointer Trajectories

Maintain a per-session rolling buffer of the current trial plus the next three
fully decoded nine-image trials. After a response, promote the next ready trial
and begin preloading the next unseen trial. If preparation is incomplete, show
a neutral preparing state and log the delay.

During testing only, record every `pointermove` from the center-cross click
through the first response. Each trajectory row records:

```text
trial_id, sample_index, timestamp, elapsed_ms_from_cross_click,
x_raw, y_raw, x_norm, y_norm, x_centered, y_centered
```

Normalize coordinates against the fixed trial canvas. Do not interpolate
samples. Reuse the shared trajectory type/recorder rather than duplicating it.

## Results and Persistence

Keep public renderer data separate from private trial state. Public data has
only visible instructions, image paths, visible option labels, and progress.
Private data retains `class_name` and `correct_label` for scoring.

Record testing responses only; training is feedback-only and is not written to
the result or trajectory files. Each testing record includes session/observer
metadata, phase, source trial ID, CSV row index, class name, reference and
candidate paths, `correct_label`, `selected_label`, correctness,
cross/ready/stimulus/response timestamps, `reactionTimeMs` (`responseAt -
crossClickedAt`), response coordinates, fixed viewport, and preload timings.

Keep a session-scoped recovery payload in browser local storage. On completion,
POST one complete session payload to the shared results API. The API persists:

```text
results/{session_id}.json       # metadata and 8-way trial results
trajectories/{session_id}.json  # testing pointer records
```

Generate filesystem-safe IDs using the shared convention:

```text
{participant_id}_{provider}_{model}_{UTC}_<random8>
```

Use `session_id` as the API idempotency key. Retry bounded failures; preserve
local recovery data and do not show completion until the API confirms success.
If no API is available locally, expose downloads of those same two JSON files.

## Human and Agent Boundary

The visual agent receives screenshots and may issue only constrained pointer or
keyboard actions. It never receives DOM/HTML/accessibility-tree data, CSV rows,
filenames, directory names, `class_name`, `correct_label`, hidden state, source
code, filesystem access, or browser scripting access. The model-facing
observation contains screen pixels and public instructions only.

Each browser session owns its timeline, preload buffer, recovery key, result
array, trajectory array, random seed, and session ID. Concurrent sessions must
not share mutable state or overwrite each other’s results.

## Acceptance Checks

- Unit-test CSV parsing, 3/remaining phase split, development/full selection,
  `selected_label === correct_label` scoring, coordinate normalization, and
  public/private state separation.
- Browser-test instruction flow, 1080 × 675 viewport gate, cross gating,
  fixed candidate labels/positions, nine-image readiness, duplicate-response
  lock, training-only feedback, test-ready confirmation, and progress bars.
- Test the rolling three-trial preload buffer and results/recovery payload.
- Add concurrent-session, API-idempotency, and answer-canary no-cheating tests
  before unattended agent collection.
