#!/usr/bin/env bash

status_prefix() {
  local run_id="$1"
  printf '[%s]' "$run_id"
}

attempt_prefix() {
  local run_id="$1"
  local attempt="$2"
  printf '[%s attempt %s]' "$run_id" "$attempt"
}

terminal_status_from_artifacts() {
  local events_file="$1"
  local last_message="$2"

  if [[ -f "$events_file" ]] && grep -Eq '"type":"backend-event".*"status":2[0-9][0-9].*"ok":true|"type": "backend-event".*"status": 2[0-9][0-9].*"ok": true' "$events_file"; then
    printf '%s\n' RESULTS_SAVED
    return 0
  fi

  if [[ -f "$last_message" ]] && grep -Eqi 'RESULTS_SAVED|Results saved successfully' "$last_message"; then
    printf '%s\n' RESULTS_SAVED
    return 0
  fi

  if [[ -f "$last_message" ]] && grep -Eqi 'RESULTS_DOWNLOADED|Download trajectories|Download results|manual-save/download' "$last_message"; then
    printf '%s\n' RESULTS_DOWNLOADED
    return 0
  fi

  return 1
}

raw_log_has_retryable_transport() {
  local raw_log_file="$1"
  [[ -f "$raw_log_file" ]] || return 1
  grep -Eqi 'MCP.*(terminated|closed|disconnect|connection|transport)|transport.*(terminated|closed|disconnect)' "$raw_log_file"
}

attempt_marked_incomplete() {
  local last_message="$1"
  [[ -f "$last_message" ]] || return 1
  grep -Eqi '(^|[^A-Z])INCOMPLETE([[:space:]:]|$)' "$last_message"
}

should_retry_codex_attempt() {
  local codex_status="$1"
  local raw_log_file="$2"
  local last_message="$3"

  if attempt_marked_incomplete "$last_message"; then
    return 0
  fi

  if raw_log_has_retryable_transport "$raw_log_file"; then
    return 0
  fi

  return 1
}
