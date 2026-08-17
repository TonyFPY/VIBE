# Agent Harness

The agent harness is a separate command-line worker for the deployed visual
behavior website. It opens the public task URL in Playwright Chromium, captures
the fixed viewport directly as JPEG, calls a vision model through Gemini
Enterprise Agent Platform, validates one restricted pointer action, and
repeats. It does not import or modify website code.

## Install

From the repository root:

```bash
npm --prefix agent_harness install
npm --prefix agent_harness exec -- playwright install chromium
```

Set up Google Application Default Credentials and enable the selected model in
Model Garden. The runner identity needs permission to invoke the model; do not
put an access token or service-account JSON in the run configuration.

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_LOCATION=global
export GOOGLE_GENAI_USE_ENTERPRISE=true
```

## Configure a run

Create a private JSON file outside source control:

```json
{
  "taskUrl": "https://vibe-9d6e5.web.app/tasks/visual-similarity",
  "participantId": "001",
  "model": "google/gemini-3.5-flash",
  "location": "global",
  "runMode": "dev"
}
```

The harness accepts only participant digits. It constructs
`participant_id=A001`, adds the selected model and explicit `run=dev|ops`, and
removes unrelated query parameters. `dev` is the safe smoke-test mode; `ops`
runs the full website operation.

Before every model observation, the harness moves to and clicks the fixed
viewport center to begin the next trial. The fixation cross is never sent to
the model, so it does not spend a vision request on a deterministic action.
After the final response, the harness preserves the same flow on the terminal
save page, captures that page, and lets the model return `DONE`; it never
clicks a save or download control.

The versioned model catalog is in `src/config/model-catalog.ts`. A model must
be explicitly listed as vision-capable and available in the configured
location. Each entry keeps a stable harness/logging name separate from the
exact model ID sent to Google. Google, OpenAI-compatible MaaS, and Anthropic
`rawPredict` protocols are internal request strategies behind the same adapter.

## Run

```bash
npm --prefix agent_harness start -- --config /absolute/path/to/run.json
```

The CLI prints a redacted terminal summary. Exit code `0` means the model
returned `DONE`, `2` means incomplete, and `1` means failed. Private JPEGs and
streamed JSON Lines events are written under `agent_harness/runs/<run-id>/` by
default and are ignored by Git. The terminal event includes constant-memory
count, total, median-bucket, and p95-bucket timing summaries for navigation,
screenshots/logging, provider calls, parsing, actions, and settling.

The website remains responsible for session IDs, response records, cursor
trajectories, and result saving. The harness never uploads a second result
copy.

## Security boundary

The model request contains only:

- the current `1080 × 675` viewport JPEG;
- the participant-visible task instruction;
- allowed `CLICK`, `MOVE`, and `DONE` action shapes;
- a schema-only validation reminder after invalid output.

Provider code cannot receive a Playwright page. The browser interface exposes
only JPEG capture, pointer movement, pointer click, and close. Invalid JSON,
extra fields, negative or out-of-bounds coordinates, arbitrary code, and
unsupported actions are logged and rejected without correction.

## Checks

Unit and no-cheating tests do not call paid models:

```bash
npm --prefix agent_harness test
npm --prefix agent_harness run typecheck
```

The deterministic browser integration test uses only a local public-page
fixture and mock actions:

```bash
npm --prefix agent_harness run test:integration
```

Live Google model testing is opt-in after a vision model is enabled and ADC is
configured. It uses `run=dev`, stops after at most ten model steps, and writes
temporary logs outside the repository:

```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_LOCATION=global
export AGENT_TASK_URL=https://vibe-9d6e5.web.app/tasks/visual-similarity
export AGENT_MODEL=google/gemini-3.5-flash
npm --prefix agent_harness run test:live
```

This command can incur model charges. It is excluded from `npm test` and must
never be added to unattended CI.
