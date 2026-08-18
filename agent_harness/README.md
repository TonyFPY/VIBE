# Agent Harness

The agent harness is a command-line runner for the existing visual behavior
website. It opens the same public task URL a human participant uses, captures
the fixed browser viewport as JPEG, sends that screenshot to Gemini native
Computer Use, executes one validated pointer or wait action through Playwright,
and repeats until the website reports completion or the runner reaches a
terminal state.

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

The viewport is fixed at `1080 x 675` CSS pixels with device scale factor `1`.
Gemini returns native Computer Use coordinates in its `0..999` space; the
adapter maps them to CSS pixels with:

```ts
const xCss = Math.floor(xGemini / 1000 * 1080);
const yCss = Math.floor(yGemini / 1000 * 675);
```

Out-of-range coordinates are rejected. They are not clamped or repaired.

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

## Native Computer Use Loop

Each provider turn contains only the public participant instruction, the
current JPEG screenshot, and Gemini's native `computer_use` tool configuration
for a browser environment. The tool configuration excludes navigation, typing,
scrolling, dragging, keyboard input, screenshots requested by the model, and
other browser operations outside the shared action set.

The first screenshot is captured on the instructions page, before the setup
Start batch. Each Gemini interaction returns one ordered setup or trial-response
batch. The harness executes every action in the batch and reports one result per
action. It then settles, checks completion, performs controller-owned center
fixation when applicable, and captures the next screenshot for the following
interaction. No intermediate screenshots are captured within a batch.

Trial-response batches require at least nine pointer moves followed by a final
click; the Start batch is exempt from this minimum. Pointer movement uses
non-interpolated Playwright steps by default. Set
`mouseMoveSteps` at the top level of the JSON configuration to choose a value
from `1` through `100`:

```json
{
  "mouseMoveSteps": 1
}
```

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

The model receives screenshots only, plus the public instruction and native
tool declaration. It never receives the Playwright page, DOM, accessibility
tree, URL, task configuration, answer key, source files, filesystem paths,
backend payloads, or hidden experiment state.

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
