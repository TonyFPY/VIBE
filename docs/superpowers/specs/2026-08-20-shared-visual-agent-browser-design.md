# Shared Visual Agent Browser Design

## Goal

Provide one provider-neutral, screenshot-only Playwright browser bridge that
Codex can use now and that Claude or another agent can reuse later, while
keeping the existing Gemini harness behavior unchanged.

## Scope

This change adds a local MCP server around the existing Playwright browser
session and updates `scripts/codex.sh` to launch one isolated Codex execution
and one isolated browser bridge per experiment run. The launcher remains the
user-facing batch/tmux interface.

The first provider uses `codex exec` because it supports a clean per-process
configuration and `--ignore-user-config`. This prevents the user's installed
browser, computer-use, node-repl, and unrelated MCP configuration from being
implicitly inherited by an experiment run.

Claude and other launchers are explicitly out of scope for this change, but
they will be able to consume the same MCP tool contract and run manifest.

## Architecture

```text
scripts/codex.sh
    |
    +-- one tmux window / one Codex exec / one MCP process per run
                                     |
                       shared agent-browser MCP server
                                     |
                       existing PlaywrightBrowserHost
                                     |
                         same experiment URL and renderer
```

Shared runtime files live under `agent_harness/src/agent-browser/`:

- `run-config.ts` validates the environment contract and resolves the real
  headless/headed setting.
- `action-policy.ts` validates pointer coordinates and wait durations without
  exposing task answers or page state.
- `mcp-server.ts` maps the provider-neutral tool contract to the existing
  `BrowserSession` interface.
- `mcp-server-main.ts` starts the stdio MCP process and owns shutdown cleanup.

The existing `agent_harness/src/browser/` implementation remains the only
Playwright implementation. Gemini files are not changed by this feature.

## Tool contract

The MCP server exposes only these tools:

- `observe`: capture and return the rendered JPEG screenshot.
- `move`: move the pointer to visible CSS-pixel coordinates.
- `click`: click visible CSS-pixel coordinates.
- `wait`: wait for a bounded duration and return a new screenshot.

The model never receives a Playwright page, DOM, accessibility tree, URL
after startup, JavaScript result, request/response body, task configuration,
filesystem path, screenshot filename, or backend completion state. Completion
must be inferred from the visible screen.

The server does not expose arbitrary code execution, keyboard injection,
navigation, evaluation, network inspection, downloads, or a completion tool.
The initial experiment tasks use pointer actions only; keyboard support can be
added later as a separately tested action type.

## Run isolation and safety

Every run receives:

- a unique run directory and JSONL trajectory log;
- a unique MCP process;
- a fresh Playwright browser context;
- an explicit `AGENT_BROWSER_HEADLESS=true|false` value;
- a URL validated to be an allowed experiment task route.

`codex.sh` starts Codex with:

- `codex exec --ignore-user-config --ignore-rules --ephemeral`;
- a private per-run working directory;
 - `--sandbox read-only`;
- native shell, browser, computer-use, in-app-browser, view-image, and app
  capabilities disabled where supported by the installed Codex CLI;
- only the per-run MCP server configured inline, without mutating global
  Codex configuration.

The script defaults to headless mode. `--headed <id...>` changes the
environment passed to the corresponding MCP process, so it changes the
actual Chromium launch rather than merely changing prompt text.

Invalid pointer/wait arguments are rejected and logged. Values are never
silently clamped or repaired. MCP stdio diagnostics go to stderr so stdout
remains a valid protocol stream.

## Logging

The shared `RunLogger` stores controller-owned events and screenshots under
the batch run directory. Model-visible tool responses contain only the image
or a short public action result. Backend events may be logged for analysis but
are never returned through MCP.

## Compatibility

The Gemini provider, Gemini transport, existing `RunLoop`, task website, and
human flow remain unchanged. Existing browser-controller tests continue to
own the shared Playwright behavior. New tests cover the MCP boundary,
configuration validation, isolation, invalid-action logging, and launcher
command generation.

## Acceptance criteria

1. A dry run shows one Codex process and one MCP process per requested ID.
2. Runs without `--headed` pass `headless=true` to Playwright.
3. Only selected IDs pass `headless=false` to Playwright.
4. The MCP tool list contains only `observe`, `move`, `click`, and `wait`.
5. Tool results never contain DOM, page objects, URLs, response bodies,
   filesystem paths, or canary answer values.
6. Invalid coordinates and wait durations are logged and rejected.
7. Existing Gemini and repository tests pass.
8. No global Codex configuration is modified by the launcher.
