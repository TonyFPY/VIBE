# Final Review Remediation Report

Date: 2026-08-21

## Scope

Implemented the focused remediation items requested for the Codex MCP refresh branch:

- Closed active Streamable HTTP MCP sessions before closing the HTTP listener.
- Reset the visible-observation gate for each fresh HTTP MCP session/Codex attempt without resetting browser/page state.
- Added `--ignore-user-config` to Codex exec invocations while preserving inline `vibe_browser` MCP config.
- Treated worker `action-rejected` and `run-aborted` events as retryable fresh-attempt triggers.
- Sanitized terminal model-message text for data URIs, base64-like spans, and raw `data` payloads.
- Corrected docs/help that claimed native Codex runs are always headed; default workers are headless, with `--headed`, `--browser-profile isolated`, and `--browser-launch external` requesting headed workers.

## Verification

Focused tests:

- `npm --prefix agent_harness test -- tests/agent-browser/http-server.test.ts tests/agent-browser/mcp-server.test.ts tests/run-script.test.ts`
- `node --test scripts/filter-codex-output.test.mjs scripts/format-codex-event.test.mjs`
- `bash scripts/codex-native.test.sh`
- `bash scripts/start-codex-experiments.test.sh`
- `bash -n scripts/codex.sh scripts/codex-native.sh scripts/codex-mcp-worker.sh scripts/codex-native-lib.sh`
- `npm --prefix agent_harness run typecheck`
- `git diff --check -- agent_harness/README.md agent_harness/src/agent-browser/http-server.ts agent_harness/tests/agent-browser/http-server.test.ts scripts/codex-native-lib.sh scripts/codex-native.sh scripts/codex-native.test.sh scripts/filter-codex-output.mjs scripts/filter-codex-output.test.mjs scripts/format-codex-event.mjs scripts/format-codex-event.test.mjs scripts/run.md scripts/start-codex-experiments.test.sh`

Elevated browser test:

- `RUN_PLAYWRIGHT_INTEGRATION=1 npm --prefix agent_harness test -- tests/integration/mock-run.test.ts`

Result: all commands above passed.

## Loopback / Permission Notes

No loopback permission limitation was observed. The elevated Playwright integration test launched Chromium successfully and passed.

Full `git diff --check` still reports unrelated pre-existing whitespace in `scripts/build.md`, which this remediation did not touch.

## Staging Notes

This checkout has unrelated modified result/export files and untracked run artifacts. Those were excluded from the remediation commit.

The checkout also has untracked agent-browser source files that tracked HTTP files already import. The remediation adds `beginMcpSession()` in `agent_harness/src/agent-browser/mcp-server.ts`, so the commit includes the minimum agent-browser source/test files needed for this remediation to typecheck from the repository state.
