#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename -- "$0")"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

usage() {
  cat <<USAGE
Usage:
  $SCRIPT_NAME --run-dir <path> --run-id <AID> --url <experiment-url> --manifest <path> [options]

Options:
  --headless <true|false>    Browser mode for the worker (default: true)
  --host <host>              Loopback MCP host (default: 127.0.0.1)
  --port <port>              MCP port, or 0 for an ephemeral port (default: 0)
  --help                     Show this help
USAGE
}

fail() {
  echo "$1" >&2
  echo "Run '$SCRIPT_NAME --help' for usage." >&2
  exit 2
}

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" && "$value" != --* ]] || fail "$option requires a value"
}

json_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
  fi
}

RUN_DIR=""
RUN_ID=""
EXPERIMENT_URL=""
MANIFEST=""
HEADLESS="true"
MCP_HOST="127.0.0.1"
MCP_PORT="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --run-dir)
      require_value "$1" "${2:-}"
      RUN_DIR="$2"
      shift 2
      ;;
    --run-id)
      require_value "$1" "${2:-}"
      RUN_ID="$2"
      shift 2
      ;;
    --url)
      require_value "$1" "${2:-}"
      EXPERIMENT_URL="$2"
      shift 2
      ;;
    --manifest)
      require_value "$1" "${2:-}"
      MANIFEST="$2"
      shift 2
      ;;
    --headless)
      require_value "$1" "${2:-}"
      case "$2" in
        true|false) HEADLESS="$2" ;;
        *) fail "--headless must be true or false" ;;
      esac
      shift 2
      ;;
    --host)
      require_value "$1" "${2:-}"
      case "$2" in
        127.0.0.1|localhost) MCP_HOST="$2" ;;
        *) fail "--host must be 127.0.0.1 or localhost" ;;
      esac
      shift 2
      ;;
    --port)
      require_value "$1" "${2:-}"
      [[ "$2" =~ ^[0-9]+$ && "$2" -le 65535 ]] || fail "--port must be an integer from 0 through 65535"
      MCP_PORT="$2"
      shift 2
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ -n "$RUN_DIR" ]] || fail "--run-dir is required"
[[ "$RUN_ID" =~ ^A[0-9]{1,12}$ ]] || fail "--run-id must look like A46"
[[ -n "$EXPERIMENT_URL" ]] || fail "--url is required"
[[ -n "$MANIFEST" ]] || fail "--manifest is required"

mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"

BEARER_TOKEN="$(generate_token)"
READY_FILE="$RUN_DIR/mcp-worker.ready"
rm -f "$MANIFEST" "$READY_FILE"

cleanup() {
  local status=$?
  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup INT TERM EXIT

AGENT_BROWSER_URL="$EXPERIMENT_URL" \
AGENT_BROWSER_RUN_ID="$RUN_ID" \
AGENT_BROWSER_HEADLESS="$HEADLESS" \
AGENT_BROWSER_BEARER_TOKEN="$BEARER_TOKEN" \
AGENT_BROWSER_MCP_HOST="$MCP_HOST" \
AGENT_BROWSER_MCP_PORT="$MCP_PORT" \
npm --prefix "$REPO_ROOT/agent_harness" run agent-browser-http >"$READY_FILE" &
WORKER_PID=$!

for _ in {1..200}; do
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    wait "$WORKER_PID"
  fi
  if [[ -s "$READY_FILE" ]]; then
    MCP_URL="$(sed -n '1p' "$READY_FILE")"
    if [[ "$MCP_URL" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/.+ ]]; then
      break
    fi
  fi
  sleep 0.05
done

[[ "${MCP_URL:-}" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/.+ ]] || fail "Timed out waiting for MCP worker readiness"

MANIFEST_TMP="${MANIFEST}.$$"
{
  printf '{\n'
  printf '  "url": %s,\n' "$(json_quote "$MCP_URL")"
  printf '  "bearerToken": %s,\n' "$(json_quote "$BEARER_TOKEN")"
  printf '  "runId": %s,\n' "$(json_quote "$RUN_ID")"
  printf '  "pid": %s\n' "$WORKER_PID"
  printf '}\n'
} >"$MANIFEST_TMP"
chmod 600 "$MANIFEST_TMP"
mv "$MANIFEST_TMP" "$MANIFEST"
chmod 600 "$MANIFEST"

echo "MCP worker ready for $RUN_ID at $MCP_URL"
wait "$WORKER_PID"
