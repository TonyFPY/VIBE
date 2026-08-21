#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/codex.sh"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || {
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  }
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" != *"$needle"* ]] || {
    printf 'Expected output not to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  }
}

help_output="$($SCRIPT --help)"
assert_contains "$help_output" "--task"
assert_contains "$help_output" "--model"
assert_contains "$help_output" "--id"
assert_contains "$help_output" "--effort"
assert_contains "$help_output" "--browser-profile"
assert_contains "$help_output" "--browser-launch"
assert_contains "$help_output" "--max-attempts"
assert_contains "$help_output" "persistent Playwright MCP"

signed_in_output="$($SCRIPT --dry-run \
  --task visual-similarity \
  --model gpt-5.6-luna \
  --id 46 \
  --effort medium)"
assert_contains "$signed_in_output" "A46: gpt-5.6-luna (effort=medium, worker=persistent-playwright-mcp)"
assert_contains "$signed_in_output" "worker manifest: "
assert_contains "$signed_in_output" "browser launch: worker"
assert_contains "$signed_in_output" "scripts/codex-mcp-worker.sh"
assert_contains "$signed_in_output" "agent-browser-http"
assert_contains "$signed_in_output" "mcp_servers.vibe_browser.url="
assert_contains "$signed_in_output" "mcp_servers.vibe_browser.headers.Authorization="
assert_contains "$signed_in_output" "http://127.0.0.1:"
assert_contains "$signed_in_output" "Bearer\\ dry-run-token-A46"
assert_contains "$signed_in_output" "--disable shell_tool"
assert_not_contains "$signed_in_output" "user-data-dir"
assert_not_contains "$signed_in_output" "codex\\ mcp\\ add"
assert_not_contains "$signed_in_output" "browser-client.mjs"
assert_not_contains "$signed_in_output" "Chrome control"

legacy_output="$($SCRIPT --dry-run \
  --task visual-similarity \
  --model gpt-5.6-luna \
  --id 46 \
  --headed 46)"
assert_contains "$legacy_output" "worker=persistent-playwright-mcp"
assert_contains "$legacy_output" "AGENT_BROWSER_HEADLESS=false"

dry_run_output="$($SCRIPT --dry-run \
  --task object-matching \
  --model gpt-5.6-luna gpt-5.6-terra \
  --id 46 47 \
  --effort medium \
  --browser-profile isolated \
  --browser-launch external)"
assert_contains "$dry_run_output" "A46: gpt-5.6-luna (effort=medium, worker=persistent-playwright-mcp)"
assert_contains "$dry_run_output" "A47: gpt-5.6-terra (effort=medium, worker=persistent-playwright-mcp)"
assert_contains "$dry_run_output" "attempts=5"
assert_contains "$dry_run_output" "gpt-5.6-luna-medium"
assert_contains "$dry_run_output" "gpt-5.6-terra-medium"
assert_contains "$dry_run_output" "codex exec"
assert_not_contains "$dry_run_output" "--ignore-user-config"
assert_contains "$dry_run_output" "--sandbox read-only"
assert_contains "$dry_run_output" "--disable shell_tool"
assert_contains "$dry_run_output" "filter-codex-output.mjs"
assert_not_contains "$dry_run_output" "--enable\\ computer_use"
assert_contains "$dry_run_output" "scripts/codex-mcp-worker.sh"
assert_contains "$dry_run_output" "mcp_servers.vibe_browser.url="
assert_contains "$dry_run_output" "mcp_servers.vibe_browser.headers.Authorization="
assert_contains "$dry_run_output" "http://127.0.0.1:44646/mcp"
assert_contains "$dry_run_output" "http://127.0.0.1:44647/mcp"
assert_contains "$dry_run_output" "Bearer\\ dry-run-token-A46"
assert_contains "$dry_run_output" "Bearer\\ dry-run-token-A47"
assert_contains "$dry_run_output" "AGENT_BROWSER_HEADLESS=false"
assert_contains "$dry_run_output" "browser launch: worker"
assert_not_contains "$dry_run_output" "browser-client.mjs"
assert_not_contains "$dry_run_output" "Chrome control"
assert_not_contains "$dry_run_output" "user-data-dir"
assert_not_contains "$dry_run_output" "codex\\ mcp\\ add"

custom_attempts_output="$($SCRIPT --dry-run \
  --task visual-similarity \
  --model gpt-5.6-luna \
  --id 46 \
  --max-attempts 2)"
assert_contains "$custom_attempts_output" "attempts=2"

if "$SCRIPT" --dry-run --task invalid --model gpt-5.6-luna --id 41 >/dev/null 2>&1; then
  echo "Expected invalid task to fail" >&2
  exit 1
fi

if "$SCRIPT" --dry-run --task visual-similarity \
  --model gpt-5.6-luna gpt-5.6-terra --id 41 >/dev/null 2>&1; then
  echo "Expected model and ID counts to match" >&2
  exit 1
fi

parallel_default_output="$($SCRIPT --dry-run --task visual-similarity \
  --model gpt-5.6-luna gpt-5.6-terra --id 41 42)"
assert_contains "$parallel_default_output" "A41: gpt-5.6-luna"
assert_contains "$parallel_default_output" "A42: gpt-5.6-terra"
assert_contains "$parallel_default_output" "http://127.0.0.1:44641/mcp"
assert_contains "$parallel_default_output" "http://127.0.0.1:44642/mcp"

if "$SCRIPT" --dry-run --host "https://example.test/path" \
  --task visual-similarity --model gpt-5.6-luna --id 41 >/dev/null 2>&1; then
  echo "Expected host paths to be rejected" >&2
  exit 1
fi

echo "codex launcher tests passed"
