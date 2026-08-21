# Codex CLI + Persistent Playwright MCP Data Collection

## Goal

Use the existing `scripts/codex.sh` command to launch parallel experiment runs through Codex CLI and a screenshot-only Playwright MCP server, without a custom model SDK integration. A failed or incomplete model attempt may receive a fresh Codex context while continuing the same visible experiment page.

## User-facing command

The command remains:

```bash
scripts/codex.sh \
  --task visual-similarity \
  --model gpt-5.5 gpt-5.4 \
  --id 44 45 \
  --run ops \
  --effort medium
```

Models and IDs are paired by position. Each ID is an independent run with its own browser, MCP worker, Codex attempts, logs, and status.

## Architecture

```text
scripts/codex.sh
    ├─ A44: persistent Playwright browser + MCP worker + Codex attempt(s)
    └─ A45: persistent Playwright browser + MCP worker + Codex attempt(s)
```

The launcher owns orchestration. Codex owns task reasoning. The MCP worker owns browser control. The experiment website remains responsible for trial generation, response recording, trajectory capture, scoring, and result persistence.

The MCP boundary exposes only:

- `observe`: return a rendered JPEG screenshot;
- `move`: move to visible CSS-pixel coordinates;
- `click`: click visible CSS-pixel coordinates;
- `wait`: wait for a bounded interval and return a fresh screenshot.

The model never receives the Playwright page, DOM, accessibility tree, JavaScript results, source code, filesystem paths, task metadata, network bodies, hidden state, or answer keys.

## Persistent browser and context refresh

Each participant ID gets one long-lived browser/MCP worker. The worker keeps the current experiment page alive across Codex attempts.

If an attempt ends with `INCOMPLETE`, an invalid MCP action, repeated pointer behavior, or a recoverable transport failure, the launcher may start a new `codex exec` process for that same run. The new attempt receives the same public instruction and reconnects to the existing MCP/browser worker. It must re-observe the current screen before acting and must not restart the experiment.

The worker closes only when the run reaches a visible terminal state, the retry limit is exhausted, or the operator stops the batch.

Retries are bounded by `--max-attempts`, defaulting to five attempts per ID. Terminal success (`Results saved successfully` or the manual-download state) ends the run and prevents further retries.

## MCP transport

The existing MCP implementation is currently stdio-based. It will be extended with a per-run local transport suitable for reconnecting fresh Codex processes to the same worker. The transport must be scoped to the run, use a generated private endpoint or equivalent authenticated local channel, and shut down with the run.

The launcher must not modify global Codex configuration. Each Codex attempt receives its MCP configuration inline or through a private per-run configuration file. No global `codex mcp add` operation is used.

## Human-readable terminal output

The launcher stdout/stderr is an operator view, not a raw protocol stream. It must never print unfiltered MCP or Codex JSON objects containing a generic `data` field.

Each visible line is prefixed with the run ID and attempt when applicable:

```text
[A44 attempt 1] Starting Codex
[A45 attempt 1] Browser and MCP worker ready
[A44 attempt 1] Screenshot received
[A44 attempt 1] Pointer click at (612, 384)
[A44 attempt 1] Waiting for the next visible screen
[A44 attempt 1] Context ended before completion; starting attempt 2
[A44] Results saved successfully
[A45] Incomplete: retry limit reached; see runs/.../A45/
```

When Codex emits a human-readable model message, the launcher may also print it as a prefixed operator line:

```text
[A44 attempt 1] Model: I can see the fixation marker; I am moving to it first.
[A44 attempt 1] Model: The previous click did not advance the trial, so I am re-observing the screen.
```

Model messages are displayed as text only. The launcher strips protocol wrappers, normalizes newlines, truncates excessively long messages, and does not print hidden tool arguments, private state, raw reasoning fields, screenshots, base64 image data, or unfiltered JSON. The complete event remains in the private per-run Codex log. A `--verbose` option may expose more summarized events, but still must not dump raw image data or protocol JSON by default.

## Run artifacts

Each batch has one directory per participant:

```text
runs/<batch>/A44/
  events.jsonl
  codex-attempt-001.jsonl
  codex-attempt-002.jsonl
  screenshots/
  status.txt
```

Raw logs remain available for debugging and analysis. The website remains the sole source of behavioral result and trajectory records; the launcher does not upload a second behavioral dataset.

## Validation and failure handling

- Invalid pointer and wait actions are rejected and logged; they are never clamped or silently repaired.
- Repeated pointer sequences abort the run rather than allowing an uncontrolled loop.
- A failed attempt does not restart the experiment page.
- A new attempt must reuse the public instruction and obtain a fresh screenshot before pointer input.
- MCP/browser failures are surfaced as concise terminal messages and retained in raw logs.
- A nonzero Codex process exit is recorded per attempt and only retried when the run remains recoverable.
- Operator interruption closes the Codex process, MCP worker, browser, and per-run resources.

## Testing

Add tests for:

1. one persistent MCP/browser worker per participant ID;
2. fresh Codex attempts reconnecting to the same worker/page;
3. instruction reuse and no experiment restart after refresh;
4. parallel isolation between IDs;
5. MCP tool and no-cheating boundaries;
6. retry limits and terminal-state handling;
7. human-readable terminal summaries with no raw `data` or base64 output;
8. human-readable model message forwarding with truncation and protocol filtering;
9. dry-run output showing the per-run topology without starting browsers.

Existing human flow, Gemini harness behavior, task renderers, and Firebase persistence must remain compatible.
