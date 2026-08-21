#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT="$SCRIPT_DIR/codex-native.sh"
LIB="$SCRIPT_DIR/codex-native-lib.sh"

source "$LIB"

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
assert_contains "$help_output" "--browser-app"
assert_contains "$help_output" "--browser-profile"
assert_contains "$help_output" "--browser-launch"
assert_contains "$help_output" "--max-attempts"
assert_contains "$help_output" "persistent Playwright MCP"

dry_run_output="$($SCRIPT --dry-run \
  --task object-matching \
  --model gpt-5.6-luna gpt-5.6-terra \
  --id 46 47 \
  --effort medium \
  --browser-app "Google Chrome" \
  --browser-profile isolated \
  --browser-launch external)"

assert_contains "$dry_run_output" "A46: gpt-5.6-luna (effort=medium, worker=persistent-playwright-mcp)"
assert_contains "$dry_run_output" "A47: gpt-5.6-terra (effort=medium, worker=persistent-playwright-mcp)"
assert_contains "$dry_run_output" "attempts=5"
assert_contains "$dry_run_output" "agent-browser-http"
assert_contains "$dry_run_output" "scripts/codex-mcp-worker.sh"
assert_contains "$dry_run_output" "mcp_servers.vibe_browser.url="
assert_contains "$dry_run_output" "mcp_servers.vibe_browser.http_headers.Authorization="
assert_contains "$dry_run_output" "--ignore-user-config"
assert_contains "$dry_run_output" "http://127.0.0.1:44646/mcp"
assert_contains "$dry_run_output" "http://127.0.0.1:44647/mcp"
assert_contains "$dry_run_output" "AGENT_BROWSER_HEADLESS=false"
assert_contains "$dry_run_output" "CODEX_RAW_LOG_PATH="
assert_contains "$dry_run_output" "CODEX_ATTEMPT="
assert_contains "$dry_run_output" "continuation"
assert_contains "$dry_run_output" "object-matching"
assert_contains "$dry_run_output" "attempt-001/terminal.log"
assert_contains "$dry_run_output" "attempt-002/terminal.log"
assert_contains "$dry_run_output" "attempt-001/codex.jsonl"
assert_contains "$dry_run_output" "attempt-002/codex.jsonl"
assert_contains "$dry_run_output" "attempt-001/last-message.txt"
assert_contains "$dry_run_output" "attempt-002/last-message.txt"
assert_contains "$dry_run_output" "prompt-public.txt"
assert_contains "$dry_run_output" "prompt-attempt-001.txt"
assert_contains "$dry_run_output" "prompt-attempt-002.txt"
assert_contains "$dry_run_output" "events.jsonl"
assert_contains "$dry_run_output" "worker.log"
assert_contains "$dry_run_output" "status.txt values: RESULTS_SAVED | RESULTS_DOWNLOADED | INCOMPLETE"
assert_contains "$dry_run_output" "status line prefixes: [A<ID>] and [A<ID> attempt N]"
assert_contains "$dry_run_output" "continuation instruction: Reconnect to the existing MCP browser worker; call observe before any pointer input; reuse the same public task instruction."
assert_not_contains "$dry_run_output" "mcp_servers.vibe_browser.headers.Authorization"
assert_not_contains "$dry_run_output" "built-in\\ Chrome\\ browser\\ control"
assert_not_contains "$dry_run_output" "browser-client.mjs"
assert_not_contains "$dry_run_output" "agent.browsers"
assert_not_contains "$dry_run_output" "node_repl/js_reset"
assert_not_contains "$dry_run_output" "user-data-dir"
assert_not_contains "$dry_run_output" "enable\\ computer_use"
assert_not_contains "$dry_run_output" "codex\\ mcp\\ add"
assert_not_contains "$dry_run_output" "eval"

temp_root="$(mktemp -d)"
trap 'rm -rf "$temp_root"' EXIT
events_file="$temp_root/events.jsonl"
last_message_file="$temp_root/last-message.txt"
raw_log_file="$temp_root/codex.jsonl"

printf '{"type":"backend-event","status":200,"ok":true}\n' > "$events_file"
assert_contains "$(terminal_status_from_artifacts "$events_file" "$last_message_file")" "RESULTS_SAVED"

: > "$events_file"
printf 'Download trajectories\n' > "$last_message_file"
assert_contains "$(terminal_status_from_artifacts "$events_file" "$last_message_file")" "RESULTS_DOWNLOADED"

printf 'INCOMPLETE: model stopped before completion\n' > "$last_message_file"
: > "$raw_log_file"
if ! should_retry_codex_attempt 0 "$raw_log_file" "$last_message_file"; then
  echo "Expected INCOMPLETE marker to be retryable" >&2
  exit 1
fi

printf 'transport disconnected unexpectedly\n' > "$raw_log_file"
: > "$last_message_file"
if ! should_retry_codex_attempt 1 "$raw_log_file" "$last_message_file"; then
  echo "Expected transport failure to be retryable" >&2
  exit 1
fi

printf '{"type":"action-rejected","actionType":"click","error":"Fresh visible observation required before pointer input"}\n' > "$events_file"
: > "$raw_log_file"
: > "$last_message_file"
if ! should_retry_codex_attempt 0 "$raw_log_file" "$last_message_file" "$events_file"; then
  echo "Expected worker action-rejected event to be retryable" >&2
  exit 1
fi

printf '{"type":"run-aborted","reason":"repeated-pointer-sequence"}\n' > "$events_file"
if ! should_retry_codex_attempt 0 "$raw_log_file" "$last_message_file" "$events_file"; then
  echo "Expected worker run-aborted event to be retryable" >&2
  exit 1
fi

printf '{"type":"action-rejected","actionType":"click","error":"Fresh visible observation required before pointer input"}\n' > "$events_file"
printf '{"type":"observation","screenshotId":"observation-000001"}\n' >> "$events_file"
printf 'fatal config error\n' > "$raw_log_file"
printf 'stopped\n' > "$last_message_file"
attempt_event_start=2
if should_retry_codex_attempt 1 "$raw_log_file" "$last_message_file" "$events_file" "$attempt_event_start"; then
  echo "Expected stale worker retry markers from earlier attempts to be ignored" >&2
  exit 1
fi

printf 'fatal config error\n' > "$raw_log_file"
printf 'stopped\n' > "$last_message_file"
printf '{"type":"observation","screenshotId":"observation-000001"}\n' > "$events_file"
if should_retry_codex_attempt 1 "$raw_log_file" "$last_message_file" "$events_file"; then
  echo "Expected hard Codex failures without retry markers to stop" >&2
  exit 1
fi

assert_contains "$(status_prefix A46)" "[A46]"
assert_contains "$(attempt_prefix A46 2)" "[A46 attempt 2]"

custom_attempts_output="$($SCRIPT --dry-run \
  --task visual-similarity \
  --model gpt-5.6-luna \
  --id 46 \
  --max-attempts 2)"
assert_contains "$custom_attempts_output" "attempts=2"

if "$SCRIPT" --dry-run --task visual-similarity \
  --model gpt-5.6-luna --id 46 --max-attempts 0 >/dev/null 2>&1; then
  echo "Expected zero continuation attempts to fail" >&2
  exit 1
fi

if "$SCRIPT" --dry-run --task visual-similarity \
  --model gpt-5.6-luna --id 46 --max-attempts 11 >/dev/null 2>&1; then
  echo "Expected more than ten continuation attempts to fail" >&2
  exit 1
fi

if "$SCRIPT" --dry-run --task visual-similarity \
  --model gpt-5.6-luna gpt-5.6-terra --id 41 >/dev/null 2>&1; then
  echo "Expected model and ID counts to match" >&2
  exit 1
fi

if "$SCRIPT" --dry-run --task visual-similarity \
  --model gpt-5.6-luna --id 41 \
  --runs-dir "/tmp/codex-runs; touch /tmp/codex-injected" >/dev/null 2>&1; then
  echo "Expected hostile runs-dir to be rejected" >&2
  exit 1
fi

echo "native Codex launcher tests passed"
