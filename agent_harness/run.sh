#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  agent_harness/run.sh --host <http(s)://host> --task <task> --model <model> --runMode <dev|ops> --pid <digits> [--headed]

Options:
  --host <http(s)://host>
  --task visual-similarity|object-matching
  --model google/gemini-3.7-flash|google/gemini-3.5-flash-lite|google/gemini-3.5-flash|google/gemini-3-flash-preview
  --runMode dev|ops
  --pid <1-12 digits>
  --headed
  --help

Examples:
  agent_harness/run.sh --host https://vibe-9d6e5.web.app --task visual-similarity --model google/gemini-3.7-flash --runMode dev --pid 1
  agent_harness/run.sh --host https://vibe-9d6e5.web.app --task object-matching --model google/gemini-3.7-flash --runMode dev --pid 1 --headed
USAGE
}

fail() {
  echo "$1" >&2
  echo "Run 'agent_harness/run.sh --help' for usage." >&2
  exit 2
}

require_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    fail "$option requires a value"
  fi
}

HOST=""
TASK=""
MODEL=""
RUN_MODE=""
PID=""
HEADED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --headed)
      if [[ "$HEADED" -eq 1 ]]; then fail "--headed may be supplied only once"; fi
      HEADED=1
      shift
      ;;
    --host)
      if [[ -n "$HOST" ]]; then fail "--host may be supplied only once"; fi
      require_value "$1" "${2:-}"
      HOST="$2"
      shift 2
      ;;
    --task)
      if [[ -n "$TASK" ]]; then fail "--task may be supplied only once"; fi
      require_value "$1" "${2:-}"
      case "$2" in
        visual-similarity|object-matching) TASK="$2" ;;
        *) fail "--task must be visual-similarity or object-matching" ;;
      esac
      shift 2
      ;;
    --model)
      if [[ -n "$MODEL" ]]; then fail "--model may be supplied only once"; fi
      require_value "$1" "${2:-}"
      case "$2" in
        google/gemini-3.7-flash|google/gemini-3.5-flash-lite|google/gemini-3.5-flash|google/gemini-3-flash-preview) MODEL="$2" ;;
        *) fail "--model must be a supported Gemini Computer Use model" ;;
      esac
      shift 2
      ;;
    --runMode)
      if [[ -n "$RUN_MODE" ]]; then fail "--runMode may be supplied only once"; fi
      require_value "$1" "${2:-}"
      case "$2" in
        dev|ops) RUN_MODE="$2" ;;
        *) fail "--runMode must be dev or ops" ;;
      esac
      shift 2
      ;;
    --pid)
      if [[ -n "$PID" ]]; then fail "--pid may be supplied only once"; fi
      require_value "$1" "${2:-}"
      if [[ ! "$2" =~ ^[0-9]{1,12}$ ]]; then fail "--pid must contain 1 to 12 digits"; fi
      PID="$2"
      shift 2
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ -n "$HOST" ]] || fail "--host is required"
[[ -n "$TASK" ]] || fail "--task is required"
[[ -n "$MODEL" ]] || fail "--model is required"
[[ -n "$RUN_MODE" ]] || fail "--runMode is required"
[[ -n "$PID" ]] || fail "--pid is required"

CLI_ARGS=(
  --host "$HOST"
  --task "$TASK"
  --model "$MODEL"
  --runMode "$RUN_MODE"
  --pid "$PID"
)
if [[ "$HEADED" -eq 1 ]]; then CLI_ARGS+=(--headed); fi

exec npm --prefix "${REPOSITORY_ROOT}/agent_harness" start -- \
  "${CLI_ARGS[@]}"



