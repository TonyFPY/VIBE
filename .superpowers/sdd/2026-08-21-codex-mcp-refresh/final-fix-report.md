# Codex MCP Refresh Final Fix Report

Date: 2026-08-21

## Scope

Fixed exactly the two remaining final-review findings:

- `beginMcpSession()` now clears the per-run repeated-pointer abort state in `agent_harness/src/agent-browser/mcp-server.ts` while preserving the existing browser session and page state.
- Native Codex retry detection now scopes worker retry markers to the current attempt by recording an attempt-local start offset into `events.jsonl` and ignoring older `action-rejected` / `run-aborted` lines.

## TDD Evidence

- RED: `npm --prefix agent_harness test -- tests/agent-browser/mcp-server.test.ts` failed in `clears repeated-pointer abort state for a fresh MCP session without reopening the browser` because `recoveredMove.isError` was still `true`.
- RED: `bash scripts/codex-native.test.sh` failed with `Expected stale worker retry markers from earlier attempts to be ignored`.
- GREEN: both commands above passed after the production changes.

## Verification

- `npm --prefix agent_harness test -- tests/agent-browser/mcp-server.test.ts`
- `bash scripts/codex-native.test.sh`
- `npm --prefix agent_harness run typecheck`
- `bash -n scripts/codex-native.sh scripts/codex-native-lib.sh scripts/codex-native.test.sh`
- `git diff --check -- agent_harness/src/agent-browser/mcp-server.ts agent_harness/tests/agent-browser/mcp-server.test.ts scripts/codex-native-lib.sh scripts/codex-native.sh scripts/codex-native.test.sh`

Result: all commands above passed.

## Staging Notes

The repository has unrelated modified result/export files, untracked test files, plan/spec docs, and run artifacts in the working tree. This fix stages only:

- `agent_harness/src/agent-browser/mcp-server.ts`
- `agent_harness/tests/agent-browser/mcp-server.test.ts`
- `scripts/codex-native-lib.sh`
- `scripts/codex-native.sh`
- `scripts/codex-native.test.sh`
- `.superpowers/sdd/2026-08-21-codex-mcp-refresh/final-fix-report.md`
