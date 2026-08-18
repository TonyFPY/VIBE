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
Set an API key in the process environment; do not put the key in the JSON run
configuration.

```bash
export GEMINI_API_KEY=your-api-key
```

## Configure

Create a private JSON run configuration outside source control:

```json
{
  "taskUrl": "https://vibe-9d6e5.web.app/tasks/visual-similarity",
  "participantId": "001",
  "model": "google/gemini-3.7-flash",
  "runMode": "dev"
}
```

The harness accepts only participant digits. It constructs
`participant_id=A001`, adds the selected model and `run=dev|ops`, and removes
unrelated query parameters before opening the task page.

The catalog currently accepts these Gemini Computer Use model IDs:

```text
google/gemini-3.7-flash
google/gemini-3.5-flash-lite
google/gemini-3.5-flash
google/gemini-3-flash-preview
```

The `google/` prefix is required in the JSON configuration; the harness sends
the provider model ID without that prefix to the Gemini API.

The viewport is fixed at `1080 x 675` CSS pixels with device scale factor `1`.
The Gemini custom functions use integer normalized coordinates in the inclusive
`0..999` range. The adapter maps them to CSS pixels with:

```ts
const xCss = Math.floor(xGemini / 1000 * 1080);
const yCss = Math.floor(yGemini / 1000 * 675);
```

Out-of-range coordinates are rejected. They are not clamped or repaired.

The repository example at `agent_harness/tmp/gemini-run.json` sets
`performance.settleDelayMs` to `2000`. After Playwright executes a batch, this
delay gives deployed stimuli time to prepare before the controller performs
the center fixation and captures the next screenshot.

## Run

```bash
npm --prefix agent_harness start -- --config /absolute/path/to/run.json
npm --prefix agent_harness start -- --config /absolute/path/to/run.json --headed
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
controller-owned center fixation if the experiment is still active, captures
one fresh screenshot, and sends the per-action results back as one grouped
function result per pending custom call. The fresh screenshot is attached only
to the final grouped result. This is the provider-specific request/response
mechanism; the provider-neutral `ComputerUseAgent` interface still exposes
only screenshot observations, a navigation/trial batch kind, and coordinate
actions. Navigation batches are validated as one click even after trial
responses, so Continue pages follow the same rule as Start.

The setup/navigation phase accepts exactly one action: the `click_visible` click.
Pointer movement uses non-interpolated Playwright steps by default. Set
`mouseMoveSteps` at the top level of the JSON configuration to choose a value
from `1` through `100`:

```json
{
  "mouseMoveSteps": 1
}
```

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
