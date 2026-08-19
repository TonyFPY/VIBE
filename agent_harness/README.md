# Agent Harness

The agent harness is a command-line runner for the existing visual behavior
website. It opens the same public task URL a human participant uses, captures
the fixed browser viewport as JPEG, sends that screenshot and the public
instruction to Gemini's screenshot-oriented Computer Use adapter, executes
the returned coordinate actions through Playwright, and repeats until the
website reports completion or the runner reaches a terminal state.

The Firebase website remains the owner of trial generation, rendering,
response records, scoring, trajectory capture, and result persistence. The
harness does not upload a second copy of behavioral data.

## Install

From the repository root:

```bash
npm --prefix agent_harness install
npm --prefix agent_harness exec -- playwright install chromium
```

The Gemini adapter uses the Gemini API JavaScript SDK from `@google/genai`.
Set an API key in the process environment:

```bash
export GEMINI_API_KEY=your-api-key
```

## Configure

No JSON run file is required. Each run supplies the host, task, model, run
mode, and participant ID directly:

```text
--host https://vibe-9d6e5.web.app
--task visual-similarity|object-matching
--model google/<computer-use-model>
--runMode dev|ops
--pid <digits>
```

The harness constructs `participant_id=A001` from `--pid 001`; `--pid 1`
sends `participant_id=A1` and saves participant ID `1`. The host must be an
HTTP or HTTPS origin without a path, query, or fragment.

The catalog currently accepts these Gemini Computer Use model IDs:

```text
google/gemini-3.7-flash
google/gemini-3.5-flash-lite
google/gemini-3.5-flash
google/gemini-3-flash-preview
```

The `google/` prefix is required in `--model`; the harness sends the provider
model ID without that prefix to the Gemini API.

The viewport is fixed at `1080 x 675` CSS pixels with device scale factor `1`.
The Gemini custom functions use integer normalized coordinates in the inclusive
`0..999` range. The adapter maps them to CSS pixels with:

```ts
const xCss = Math.floor(xGemini / 1000 * 1080);
const yCss = Math.floor(yGemini / 1000 * 675);
```

Out-of-range coordinates are rejected. They are not clamped or repaired.

Performance defaults are encoded in
[`src/config/load-config.ts`](src/config/load-config.ts): the browser waits
`2000` ms after a batch for stimuli to prepare, provider requests allow
`120000` ms, and the total run timeout is `1800000` ms. The same module keeps
the fixed viewport, screenshot, pointer pacing, action, response-size, and
retry defaults.

## Run

The recommended wrapper resolves the repository paths automatically, so it can
be called from any working directory:

```bash
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.7-flash \
  --runMode dev \
  --pid 1
```

For object matching or a visible browser:

```bash
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.7-flash \
  --runMode dev \
  --pid 1 \
  --headed
```

The wrapper is [`run.sh`](run.sh); the direct npm form remains supported:

```bash
npm --prefix agent_harness start -- \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.7-flash \
  --runMode dev \
  --pid 1
npm --prefix agent_harness start -- \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.7-flash \
  --runMode dev \
  --pid 1 \
  --headed
```

Runs are headless by default. `--headed` opens a visible Chromium window and
uses a controller-only pointer overlay; the overlay is never part of a model
request.

The CLI writes screenshots and JSON Lines events under `agent_harness/runs/`
by default. Override that location with:

```bash
export AGENT_RUNS_DIR=/absolute/path/to/private-runs
```

## Gemini custom action-batch loop

Each provider turn contains only the public participant instruction, the
current JPEG screenshot, and the declared provider tool schemas. The Gemini
adapter retains the screenshot-oriented `computer_use` browser context but
excludes its native pointer and browser-control functions. It exposes two
client-executed custom functions instead:

- `click_visible({ x, y, intent })` for one visible setup or navigation click,
  including Start and Continue pages.
- `submit_trial_actions({ moves, click })` for a trial-response batch. `moves`
  contains 9 through 49 normalized pointer coordinates, and `click` is the
  one final normalized click coordinate.

The first screenshot is captured on the instructions page, before the setup
Start action. Each Gemini interaction returns a custom function call whose
actions are flattened in order. The harness rejects native pointer calls and
any flattened batch over 50 actions, then executes the accepted actions through
Playwright. A trial batch therefore contains 10 through 50 actions: the 9–49
explicit moves followed by the final click. No intermediate screenshots are
captured while a batch executes.

After execution, the harness settles and checks completion, performs
controller-owned center fixation if the experiment is still active, and
captures one fresh screenshot. Navigation batches continue the current
provider interaction with grouped per-action results, so Continue pages follow
the same rule as Start. After a successful trial batch, the Gemini adapter
resets its provider interaction and the next request receives only the fresh
screenshot and public instruction. This keeps the conversation context bounded
without exposing page state or replaying browser actions. Providers that do
not implement context reset retain the grouped-result continuation behavior.
The provider-neutral `ComputerUseAgent` interface still exposes only
screenshot observations, a navigation/trial batch kind, and coordinate actions.

Gemini's native `wait_5_seconds` action is also accepted as a single loading
wait. It is used only when the visible page says it is preparing or loading;
the harness waits, captures a fresh screenshot, and does not insert a center
fixation click. It is never part of a trial-response batch.

If Gemini returns malformed or policy-invalid action output, the harness marks
that provider turn recoverable, logs it, resets the Gemini interaction, and
resends the same screenshot with a correction instruction. It retries up to
three correction attempts for that provider turn. No action from a rejected
turn is sent to Playwright. Safety, authentication, and other terminal
provider failures still stop the run; exhausting the three correction attempts
returns an incomplete run rather than pretending the trial succeeded.

For Gemini and other providers that implement context reset, a provider
timeout causes the run loop to abandon the pending interaction, start one
fresh request from the latest screenshot, and never replay the
already-executed action batch. A second timeout remains an unrecoverable
provider failure. Providers without context reset retain the existing terminal
timeout behavior.

The setup/navigation phase accepts exactly one action: the `click_visible` click.
Loading screens may use the separate one-action `wait_5_seconds` batch.
Pointer movement uses non-interpolated Playwright steps by default. The
runtime defaults are encoded in `src/config/load-config.ts`:

Playwright does not pause between successive model waypoints by default. The
harness therefore waits `20` ms after each pointer move so the shared website
trajectory sampler can observe movements that are at least `16` ms apart.
Change the coded `mouseMoveSteps` and `mouseMoveDelayMs` defaults when tuning
this pacing; `mouseMoveDelayMs: 0` disables the delay.

`mouseMoveSteps` controls spatial interpolation inside one Playwright move;
`mouseMoveDelayMs` controls time between model-emitted moves. The latter is
the setting that affects trajectory sampling.

The trial action budget is defined in `src/actions/policy.ts`:
`MIN_TRIAL_BATCH_ACTIONS` is `10` and `MAX_BATCH_ACTIONS` is `50`. The Gemini
schema and parser derive the move limits (`9` through `49`) from those totals.
Change those two policy constants to adjust the total trial budget; the
navigation click remains exactly one action.

Completion is evaluator-owned. The provider can stop producing actions, but a
run is successful only after the browser controller observes a successful
website result save request. The website is the sole writer of behavioral
records.

## Statuses

The terminal summary has one of these statuses:

- `completed`: the website result endpoint returned success.
- `failed`: the browser, provider, action executor, backend save, or cleanup
  path failed unrecoverably.
- `incomplete`: the provider stopped or the invalid-action limit was reached
  before website completion.
- `timeout`: the total run deadline expired.
- `step_limit`: the action-turn limit was reached.

Exit code `0` means `completed`, exit code `1` means `failed`, and exit code
`2` means `incomplete`, `timeout`, or `step_limit`.

## Boundary

The model receives screenshots only, plus the public instruction and the
provider's declared tool schemas. In the Gemini adapter, that means the
screenshot-oriented browser context and the two custom functions described
above; native pointer controls remain excluded. It never receives the
Playwright page, DOM, accessibility tree, URL, task configuration, answer key,
source files, filesystem paths, backend payloads, or hidden experiment state.

Logs preserve screenshot IDs, timing, parsed actions, backend status metadata,
and raw provider output. They do not serialize observations or request/response
payloads, and environment secrets such as `GEMINI_API_KEY` are redacted.

## Checks

Unit, integration, and no-cheating tests do not make paid Gemini calls:

```bash
npm --prefix agent_harness test
npm --prefix agent_harness run typecheck
npm --prefix agent_harness run test:integration
```

The live smoke test is opt-in and can incur Gemini API charges:

```bash
export GEMINI_API_KEY=your-api-key
export AGENT_TASK_URL=https://vibe-9d6e5.web.app/tasks/visual-similarity
export AGENT_MODEL=google/gemini-3.7-flash
npm --prefix agent_harness run test:live
```

Do not add the live smoke test to unattended CI.
