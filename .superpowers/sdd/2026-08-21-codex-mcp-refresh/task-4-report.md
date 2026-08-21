# Task 4 Report: Human-Readable Operator Output

Date: 2026-08-21

## Scope

Implemented Task 4 only for the Codex CLI + persistent Playwright MCP launcher path.

Files changed:

- `scripts/format-codex-event.mjs`
- `scripts/format-codex-event.test.mjs`
- `scripts/filter-codex-output.mjs`
- `scripts/filter-codex-output.test.mjs`
- `scripts/codex-native.sh`
- `scripts/codex-native.test.sh`

## What Changed

### 1. Added a dedicated terminal formatter

Created `scripts/format-codex-event.mjs` with the required interfaces:

- `formatCodexEvent(event, context): string | undefined`
- `formatModelMessage(text, context): string`
- `summarizeToolEvent(event, context): string | undefined`

Behavior:

- prefixes readable lines with `[A<ID> attempt N]`
- normalizes multiline model text into single readable lines
- truncates long terminal messages to a fixed limit with an ellipsis
- summarizes MCP tool calls without exposing raw arguments blobs or payloads
- summarizes coordinate-bearing actions (`move`, `click`) concisely
- emits final `turn.completed` token summaries
- falls back to concise `event <type>` lines for unknown JSON events

### 2. Replaced terminal JSON summaries with readable output

Reworked `scripts/filter-codex-output.mjs` so terminal output is no longer summarized JSONL.

Behavior:

- parses raw Codex JSONL events
- formats safe human-readable lines for terminal display
- normalizes and truncates non-JSON stderr/stdout lines
- appends every original raw line to a dedicated raw JSONL log path when configured
- never prints base64 image data, generic `data` payloads, or hidden reasoning fields

### 3. Kept raw logs separate from operator display

Updated `scripts/codex-native.sh` so:

- raw Codex output remains in per-attempt `codex.jsonl`
- human-readable display is piped through the formatter and then `tee`d into `terminal.log`
- `tee` is now only used on formatted terminal text, not on raw Codex JSONL

Per-attempt artifacts now include:

- `attempt-XXX/codex.jsonl`
- `attempt-XXX/terminal.log`
- `attempt-XXX/last-message.txt`

### 4. Updated launcher dry-run coverage

Adjusted `scripts/codex-native.test.sh` expectations to assert the new split output behavior:

- `CODEX_RAW_LOG_PATH` is present
- `CODEX_ATTEMPT` is present
- `attempt-001/terminal.log` is present

## TDD / Verification

### Red

Added failing coverage first for:

- prefixed model messages
- multiline normalization
- truncation
- tool start/completion summaries
- coordinate summaries
- error summaries
- final turn status summaries
- unknown JSON events
- raw-log preservation with filtered terminal output

### Green

Implemented the formatter and launcher/log split until the new tests passed.

## Commands Run

Formatter tests:

```bash
node --test scripts/filter-codex-output.test.mjs scripts/format-codex-event.test.mjs
```

Launcher dry-run test:

```bash
bash scripts/codex-native.test.sh
```

Direct formatter dry-run:

```bash
node --input-type=module -e "import { formatCodexLine } from './scripts/filter-codex-output.mjs'; const line = JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'observe', result: { content: [{ type: 'image', mimeType: 'image/jpeg', data: 'x'.repeat(1024) }] }, status: 'completed' } }); console.log(formatCodexLine(line, { runId: 'A46', attempt: 1 }));"
```

Observed direct formatter output:

```text
[A46 attempt 1] tool observe completed; screenshot updated
```

This confirms the display path does not print image/base64 payloads.

## Requirements Check

- Added formatter tests: yes
- Implemented line formatting with `[A<ID> attempt N]`: yes
- Forwarded readable model messages with whitespace normalization and truncation: yes
- Omitted hidden reasoning, raw tool arguments dumps, base64, generic `data`: yes
- Kept raw logs separate from terminal output: yes
- Used `tee` only after formatting: yes
- Ran formatter tests and dry-run confirming no unfiltered image/data in terminal output: yes

## Non-Goals / Constraints Honored

- Did not modify Gemini Computer Use SDK/provider files
- Worked directly in the current repository
- Did not use an isolated worktree
- Did not use subagents

## Concerns

- The formatter currently summarizes the Codex event shapes observed in this repository and nearby run logs. If the CLI introduces materially different event schemas later, unknown events will degrade to concise `event <type>` lines rather than failing, but may need future formatting expansion.
