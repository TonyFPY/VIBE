#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename -- "$0")"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
CODEX_OUTPUT_FILTER="$SCRIPT_DIR/filter-codex-output.mjs"
CODEX_MCP_WORKER="$SCRIPT_DIR/codex-mcp-worker.sh"

DEFAULT_HOST="https://vibe-9d6e5.web.app"
DEFAULT_RUN_MODE="ops"
DEFAULT_EFFORT="medium"
DEFAULT_BROWSER_APP="Google Chrome"
DEFAULT_BROWSER_PROFILE="signed-in"
DEFAULT_BROWSER_LAUNCH="codex"
DEFAULT_MAX_ATTEMPTS=5

usage() {
  cat <<USAGE
Usage:
  $SCRIPT_NAME --task <task> --model <model1> [model2 ...] --id <id1> [id2 ...] [options]

Required:
  --task <task>              visual-similarity or object-matching
  --model <model1> ...       Codex models, in the same order as the IDs
  --id <id1> ...             numeric participant IDs, one per model

Options:
  --host <url>               Experiment host (default: $DEFAULT_HOST)
  --run <dev|ops>            Experiment run mode (default: $DEFAULT_RUN_MODE)
  --effort <effort>          Codex reasoning effort (default: $DEFAULT_EFFORT)
                            low, medium, high, xhigh, or ultra
  --browser-app <name>       Headed browser application (default: $DEFAULT_BROWSER_APP)
                            Deprecated compatibility option; Playwright owns the browser
  --browser-profile <mode>   signed-in or isolated (default: $DEFAULT_BROWSER_PROFILE)
                            Deprecated compatibility option; isolated requests headed workers
  --browser-launch <mode>    codex or external (default: $DEFAULT_BROWSER_LAUNCH)
                            Deprecated compatibility option; external requests headed workers
  --max-attempts <n>         Continuation attempts per run (default: $DEFAULT_MAX_ATTEMPTS)
  --allow-shared-browser     Allow multiple runs to share signed-in Chrome
  --headed <id1> [id2 ...]   Deprecated compatibility option; native runs are always headed
  --runs-dir <path>          Batch log directory (default: generated under $REPO_ROOT/runs)
  --session <name>           tmux session name (default: generated)
  --dry-run                  Print commands without opening browsers or starting tmux
  --help                     Show this help

This launcher uses one persistent Playwright MCP worker per participant ID.
Each Codex attempt receives the worker's loopback MCP URL and bearer token
through inline configuration. It does not use the Chrome plugin, does not call
'codex mcp add', and does not modify global Codex configuration.

Example:
  $SCRIPT_NAME --task object-matching \\
    --model gpt-5.6-luna --id 46 --effort medium

Parallel headed workers:
  $SCRIPT_NAME --task object-matching \\
    --model gpt-5.6-luna gpt-5.6-terra --id 46 47 \\
    --browser-profile isolated
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

toml_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

TASK=""
HOST="$DEFAULT_HOST"
RUN_MODE="$DEFAULT_RUN_MODE"
EFFORT="$DEFAULT_EFFORT"
BROWSER_APP="$DEFAULT_BROWSER_APP"
BROWSER_PROFILE="$DEFAULT_BROWSER_PROFILE"
BROWSER_LAUNCH="$DEFAULT_BROWSER_LAUNCH"
MAX_ATTEMPTS="$DEFAULT_MAX_ATTEMPTS"
SESSION_NAME=""
RUNS_DIR=""
DRY_RUN=0
ALLOW_SHARED_BROWSER=0
IDS=()
MODELS=()
HEADED_IDS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --task)
      require_value "$1" "${2:-}"
      [[ -z "$TASK" ]] || fail "--task may be supplied only once"
      case "$2" in
        visual-similarity|object-matching) TASK="$2" ;;
        *) fail "--task must be visual-similarity or object-matching" ;;
      esac
      shift 2
      ;;
    --model)
      [[ "${#MODELS[@]}" -eq 0 ]] || fail "--model may be supplied only once"
      shift
      while [[ $# -gt 0 && "$1" != --* ]]; do
        [[ "$1" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Invalid model name: $1"
        MODELS+=("$1")
        shift
      done
      ;;
    --id)
      [[ "${#IDS[@]}" -eq 0 ]] || fail "--id may be supplied only once"
      shift
      while [[ $# -gt 0 && "$1" != --* ]]; do
        [[ "$1" =~ ^[0-9]{1,12}$ ]] || fail "IDs must contain 1 to 12 digits: $1"
        IDS+=("$1")
        shift
      done
      ;;
    --host)
      require_value "$1" "${2:-}"
      HOST="$2"
      shift 2
      ;;
    --run)
      require_value "$1" "${2:-}"
      case "$2" in
        dev|ops) RUN_MODE="$2" ;;
        *) fail "--run must be dev or ops" ;;
      esac
      shift 2
      ;;
    --effort)
      require_value "$1" "${2:-}"
      case "$2" in
        low|medium|high|xhigh|ultra) EFFORT="$2" ;;
        *) fail "--effort must be low, medium, high, xhigh, or ultra" ;;
      esac
      shift 2
      ;;
    --browser-app)
      require_value "$1" "${2:-}"
      BROWSER_APP="$2"
      shift 2
      ;;
    --browser-profile)
      require_value "$1" "${2:-}"
      case "$2" in
        signed-in|isolated) BROWSER_PROFILE="$2" ;;
        *) fail "--browser-profile must be signed-in or isolated" ;;
      esac
      shift 2
      ;;
    --browser-launch)
      require_value "$1" "${2:-}"
      case "$2" in
        codex|external) BROWSER_LAUNCH="$2" ;;
        *) fail "--browser-launch must be codex or external" ;;
      esac
      shift 2
      ;;
    --max-attempts)
      require_value "$1" "${2:-}"
      case "$2" in
        1|2|3|4|5|6|7|8|9|10) MAX_ATTEMPTS="$2" ;;
        *) fail "--max-attempts must be an integer from 1 to 10" ;;
      esac
      shift 2
      ;;
    --allow-shared-browser)
      ALLOW_SHARED_BROWSER=1
      shift
      ;;
    --headed)
      shift
      while [[ $# -gt 0 && "$1" != --* ]]; do
        [[ "$1" =~ ^[0-9]{1,12}$ ]] || fail "Headed IDs must contain 1 to 12 digits: $1"
        HEADED_IDS+=("$1")
        shift
      done
      [[ "${#HEADED_IDS[@]}" -gt 0 ]] || fail "--headed requires at least one ID"
      ;;
    --runs-dir)
      require_value "$1" "${2:-}"
      [[ -z "$RUNS_DIR" ]] || fail "--runs-dir may be supplied only once"
      RUNS_DIR="$2"
      shift 2
      ;;
    --session)
      require_value "$1" "${2:-}"
      [[ -z "$SESSION_NAME" ]] || fail "--session may be supplied only once"
      SESSION_NAME="$2"
      shift 2
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ -n "$TASK" ]] || fail "--task is required"
[[ "${#MODELS[@]}" -gt 0 ]] || fail "--model requires at least one model"
[[ "${#IDS[@]}" -gt 0 ]] || fail "--id requires at least one ID"
[[ "${#MODELS[@]}" -eq "${#IDS[@]}" ]] || fail "--model and --id must contain the same number of values"
[[ "$HOST" =~ ^https?://[^/?#[:space:]]+/?$ ]] || fail "--host must be an HTTP or HTTPS origin without a path"
HOST="${HOST%/}"

if [[ "${#HEADED_IDS[@]}" -gt 0 ]]; then
  for headed_id in "${HEADED_IDS[@]+"${HEADED_IDS[@]}"}"; do
    found=0
    for run_id in "${IDS[@]}"; do
      if [[ "$headed_id" == "$run_id" ]]; then
        found=1
        break
      fi
    done
    [[ "$found" -eq 1 ]] || fail "--headed ID must also be present in --id: $headed_id"
  done
fi

for ((index = 0; index < ${#IDS[@]}; index += 1)); do
  for ((other = index + 1; other < ${#IDS[@]}; other += 1)); do
    [[ "${IDS[$index]}" != "${IDS[$other]}" ]] || fail "Duplicate participant ID: ${IDS[$index]}"
  done
done

if [[ -z "$SESSION_NAME" ]]; then
  SESSION_NAME="codex-native-${TASK//-/_}-$(date +%Y%m%d-%H%M%S)-$$"
fi
[[ "$SESSION_NAME" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "--session contains unsupported characters"

if [[ -z "$RUNS_DIR" ]]; then
  RUNS_DIR="$REPO_ROOT/runs/${SESSION_NAME}"
elif [[ "$RUNS_DIR" != /* ]]; then
  RUNS_DIR="$(pwd -P)/$RUNS_DIR"
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  command -v tmux >/dev/null 2>&1 || fail "tmux is required"
  CODEX_BIN="$(command -v codex)" || fail "codex is required"
  NODE_BIN="$(command -v node)" || fail "node is required"
  CODEX_EXEC_HELP="$(codex exec --help 2>&1)" || fail "codex exec is unavailable"
  for required_flag in --ignore-rules --ephemeral --disable --json --output-last-message; do
    [[ "$CODEX_EXEC_HELP" == *"$required_flag"* ]] || fail "Installed codex exec is missing required flag: $required_flag"
  done
  [[ -f "$CODEX_OUTPUT_FILTER" && -r "$CODEX_OUTPUT_FILTER" ]] || fail "Codex output filter is missing or unreadable: $CODEX_OUTPUT_FILTER"
  [[ -x "$CODEX_MCP_WORKER" || -f "$CODEX_MCP_WORKER" ]] || fail "Codex MCP worker is missing: $CODEX_MCP_WORKER"
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    fail "tmux session already exists: $SESSION_NAME"
  fi
else
  CODEX_BIN="codex"
  NODE_BIN="node"
fi

prepare_run_directories() {
  [[ "$DRY_RUN" -eq 1 ]] && return
  mkdir -p "$RUNS_DIR"
  for participant_id in "${IDS[@]}"; do
    local run_dir="$RUNS_DIR/A${participant_id}"
    [[ ! -e "$run_dir" ]] || fail "Run directory already exists: $run_dir"
    mkdir -p "$run_dir"
    chmod 700 "$run_dir"
  done
}

build_prompt() {
  local url="$1"
  local attempt="${2:-1}"
  local browser_start_instruction
  local experiment_start_rule
  if [[ "$attempt" -gt 1 ]]; then
    browser_start_instruction="This is a continuation attempt after a previous Codex turn stopped before completion. Reconnect to the configured MCP server, observe the current visible page, and resume the matching experiment tab for the participant URL above. Do not restart the experiment or navigate to another URL."
    experiment_start_rule="Do not click Start or restart the experiment. Resume from the current visible state; click Continue only if it is the current next control in the existing flow."
  else
    browser_start_instruction="The launcher started a persistent Playwright browser worker at the participant URL above. Use the configured MCP server to observe the current screen before acting."
    experiment_start_rule="Click Start and Continue normally."
  fi
  cat <<PROMPT
Use the configured vibe_browser MCP server to complete this experiment through screenshots and pointer actions only:
$url

$browser_start_instruction

Use only the MCP tools exposed by vibe_browser: observe, move, click, and wait. Do not use Playwright directly, chromium.connectOverCDP, raw CDP, DevTools, shell commands, DOM inspection, accessibility data, source code, files, network requests, task configuration, hidden state, OCR/helper tools, or fallback attachment paths. If the vibe_browser MCP server is unavailable, report INCOMPLETE immediately; do not try another browser-control mechanism.

Rules:
- $experiment_start_rule
- For every trial, click the visible fixation marker (+) first.
- For every testing trial, after clicking the cross, move the cursor toward the chosen response image through multiple small visible movements, then click the image.
- Do not jump directly from the fixation marker to a candidate with one direct click.
- Re-observe the current screen after each click and choose each response from the newest visible screen.
- Continue until the browser visibly shows "Results saved successfully" or the manual-save/download screen.
- Do not stop because the experiment is long. An early final answer is an incomplete run.
- If "Save incomplete" appears, click "Download results", then "Download trajectories", and stop.
- If "Results saved successfully" appears, do not click a download button: the API already saved both files. Stop.

For concise logging, after each completed testing trial write one short message only:
'Trial N: [brief visible description]; [selected position] is the match.'
Do not narrate coordinates, pointer movements, or reasoning.

Only after the visible end state, report one of:
- RESULTS_SAVED
- RESULTS_DOWNLOADED
- INCOMPLETE: <short reason>
PROMPT
}

build_codex_command() {
  local url="$1"
  local model="$2"
  local run_dir="$3"
  local mcp_url="$4"
  local bearer_token="$5"
  local attempt="${6:-1}"
  local prompt
  prompt="$(build_prompt "$url" "$attempt")"

  local -a codex_args=(
    "$CODEX_BIN"
    exec
    --ignore-rules
    --ephemeral
    --skip-git-repo-check
    --sandbox read-only
    --model "$model"
    --config "model_reasoning_effort=$(toml_quote "$EFFORT")"
    --config "mcp_servers.vibe_browser.url=$(toml_quote "$mcp_url")"
    --config "mcp_servers.vibe_browser.headers.Authorization=$(toml_quote "Bearer $bearer_token")"
    --cd "$run_dir"
    --disable shell_tool
    --disable unified_exec
    --disable multi_agent
    --disable image_generation
    --disable view_image
    --json
    --output-last-message "$run_dir/last-message.txt"
    "$prompt"
  )
  printf '%q ' "${codex_args[@]}"
}

is_headed_run() {
  local participant_id="$1"
  if [[ "$BROWSER_PROFILE" == "isolated" || "$BROWSER_LAUNCH" == "external" ]]; then
    return 0
  fi
  for headed_id in "${HEADED_IDS[@]+"${HEADED_IDS[@]}"}"; do
    [[ "$headed_id" == "$participant_id" ]] && return 0
  done
  return 1
}

dry_run_port_for_id() {
  local participant_id="$1"
  echo $((44600 + 10#$participant_id))
}

build_worker_command() {
  local url="$1"
  local run_id="$2"
  local run_dir="$3"
  local manifest="$4"
  local headless="$5"
  local port="$6"
  local -a worker_args=(
    "$CODEX_MCP_WORKER"
    --run-dir "$run_dir"
    --run-id "$run_id"
    --url "$url"
    --manifest "$manifest"
    --headless "$headless"
    --port "$port"
  )
  printf '%q ' "${worker_args[@]}"
}

print_run() {
  local index="$1"
  local participant_id="${IDS[$index]}"
  local model="${MODELS[$index]}"
  local model_label="${model}-${EFFORT}"
  local url="$HOST/tasks/$TASK?run=$RUN_MODE&participant_id=A${participant_id}&model=${model_label}"
  local run_id="A${participant_id}"
  local run_dir="$RUNS_DIR/$run_id"
  local manifest="$run_dir/mcp-connection.json"
  local headless="true"
  if is_headed_run "$participant_id"; then
    headless="false"
  fi
  local dry_mcp_url="http://127.0.0.1:$(dry_run_port_for_id "$participant_id")/mcp"
  local dry_bearer_token="dry-run-token-$run_id"

  echo "$run_id: $model (effort=$EFFORT, worker=persistent-playwright-mcp)"
  echo "  browser launch: worker"
  echo "  $url"
  echo "  run directory: $run_dir"
  echo "  worker manifest: $manifest"
  echo "  worker entrypoint: npm --prefix agent_harness run agent-browser-http"
  echo "  worker env: AGENT_BROWSER_HEADLESS=$headless"

  local initial_codex_template
  initial_codex_template="$(build_codex_command "$url" "$model" "$run_dir" "__MCP_URL__" "__MCP_TOKEN__" 1)"
  local continuation_codex_template
  continuation_codex_template="$(build_codex_command "$url" "$model" "$run_dir" "__MCP_URL__" "__MCP_TOKEN__" 2)"
  local dry_initial_codex_command
  dry_initial_codex_command="$(build_codex_command "$url" "$model" "$run_dir" "$dry_mcp_url" "$dry_bearer_token" 1)"
  local worker_command
  worker_command="$(build_worker_command "$url" "$run_id" "$run_dir" "$manifest" "$headless" 0)"
  local dry_worker_command
  dry_worker_command="$(build_worker_command "$url" "$run_id" "$run_dir" "$manifest" "$headless" "$(dry_run_port_for_id "$participant_id")")"
  local log_file_quoted
  printf -v log_file_quoted '%q' "$run_dir/codex.jsonl"
  local last_message_quoted
  printf -v last_message_quoted '%q' "$run_dir/last-message.txt"
  local status_file_quoted
  printf -v status_file_quoted '%q' "$run_dir/status.txt"
  local manifest_quoted
  printf -v manifest_quoted '%q' "$manifest"
  local initial_template_quoted
  printf -v initial_template_quoted '%q' "$initial_codex_template"
  local continuation_template_quoted
  printf -v continuation_template_quoted '%q' "$continuation_codex_template"
  local output_filter_command
  printf -v output_filter_command '%q %q' "$NODE_BIN" "$CODEX_OUTPUT_FILTER"
  local initial_pipeline
  initial_pipeline="eval \"\$initial_codex_command\" 2>&1 | $output_filter_command | tee -a $log_file_quoted"
  local continuation_pipeline
  continuation_pipeline="eval \"\$continuation_codex_command\" 2>&1 | $output_filter_command | tee -a $log_file_quoted"

  local command_string
  command_string="set -uo pipefail; cleanup() { if [[ -n \"\${worker_pid:-}\" ]]; then kill \"\$worker_pid\" 2>/dev/null || true; wait \"\$worker_pid\" 2>/dev/null || true; fi; }; trap cleanup EXIT INT TERM; $worker_command > $run_dir/worker.log 2>&1 & worker_pid=\$!; for readiness_attempt in {1..400}; do if [[ -s $manifest_quoted ]]; then break; fi; if ! kill -0 \"\$worker_pid\" 2>/dev/null; then printf '%s\\n' worker-error > $status_file_quoted; printf '\\nMCP worker exited before readiness. Logs: %s\\n' $run_dir/worker.log; read -r; exit 1; fi; sleep 0.05; done; if [[ ! -s $manifest_quoted ]]; then printf '%s\\n' worker-timeout > $status_file_quoted; printf '\\nTimed out waiting for MCP worker manifest. Logs: %s\\n' $run_dir/worker.log; read -r; exit 1; fi; mcp_url=\$(sed -n 's/.*\"url\": \"\\([^\"]*\\)\".*/\\1/p' $manifest_quoted); bearer_token=\$(sed -n 's/.*\"bearerToken\": \"\\([^\"]*\\)\".*/\\1/p' $manifest_quoted); if [[ ! \"\$mcp_url\" =~ ^http://(127\\.0\\.0\\.1|localhost):[0-9]+/.+ || ! \"\$bearer_token\" =~ ^[a-f0-9]{64}$ ]]; then printf '%s\\n' worker-manifest-error > $status_file_quoted; printf '\\nCould not read MCP worker manifest.\\n'; read -r; exit 1; fi; initial_codex_command=$initial_template_quoted; continuation_codex_command=$continuation_template_quoted; initial_codex_command=\${initial_codex_command//__MCP_URL__/\$mcp_url}; initial_codex_command=\${initial_codex_command//__MCP_TOKEN__/\$bearer_token}; continuation_codex_command=\${continuation_codex_command//__MCP_URL__/\$mcp_url}; continuation_codex_command=\${continuation_codex_command//__MCP_TOKEN__/\$bearer_token}; printf '\\n%s Browser and MCP worker ready.\\n' \"$run_id\"; attempt=1; run_status=incomplete; codex_status=0; while [[ \"\$attempt\" -le \"$MAX_ATTEMPTS\" ]]; do if [[ \"\$attempt\" -gt 1 ]]; then printf '\\nStarting Codex continuation attempt %s/%s for the existing MCP/browser worker.\\n' \"\$attempt\" \"$MAX_ATTEMPTS\"; fi; if [[ \"\$attempt\" -eq 1 ]]; then $initial_pipeline; codex_status=\${PIPESTATUS[0]}; else $continuation_pipeline; codex_status=\${PIPESTATUS[0]}; fi; if [[ \"\$codex_status\" -ne 0 ]]; then run_status=error; break; elif [[ -f $last_message_quoted ]] && grep -Eqi 'RESULTS_SAVED|Results saved successfully' $last_message_quoted; then run_status=completed; break; elif [[ -f $last_message_quoted ]] && grep -Eqi 'RESULTS_DOWNLOADED|Download trajectories|Download results' $last_message_quoted; then run_status=manual-save; break; else run_status=incomplete; fi; if [[ \"\$attempt\" -lt \"$MAX_ATTEMPTS\" ]]; then attempt=\$((attempt + 1)); else break; fi; done; if [[ \"\$run_status\" == incomplete && \"\$attempt\" -ge \"$MAX_ATTEMPTS\" ]]; then printf '\\nCodex continuation attempts exhausted (%s).\\n' \"$MAX_ATTEMPTS\"; fi; printf '%s\\n' \"\$run_status\" > $status_file_quoted; printf '\\nNative Codex status: %s (exit=%s, attempts=%s). Logs: %s\\n' \"\$run_status\" \"\$codex_status\" \"\$attempt\" $log_file_quoted; read -r"
  local tmux_command
  printf -v tmux_command 'bash -lc %q' "$command_string"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf "  worker command: %s\n" "$dry_worker_command"
    printf "  codex command: %s\n" "$dry_initial_codex_command"
    printf "  command: %s\n" "$tmux_command"
    return
  fi

  if [[ "$index" -eq 0 ]]; then
    if ! tmux new-session -d -s "$SESSION_NAME" -n "$run_id" "$tmux_command"; then
      fail "Could not create tmux session: $SESSION_NAME"
    fi
  else
    if ! tmux new-window -d -t "$SESSION_NAME" -n "$run_id" "$tmux_command"; then
      tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
      fail "Could not create tmux window: $run_id"
    fi
  fi
}

prepare_run_directories

echo "tmux session: $SESSION_NAME"
echo "task: $TASK | run: $RUN_MODE | effort: $EFFORT | worker=persistent-playwright-mcp | attempts=$MAX_ATTEMPTS | runs: ${#MODELS[@]}"
echo "batch logs: $RUNS_DIR"
for index in "${!MODELS[@]}"; do
  print_run "$index"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  exit 0
fi

echo
echo "Started ${#MODELS[@]} native Codex MCP experiment windows. Attach with:"
echo "  tmux attach -t $SESSION_NAME"
echo "List windows with:"
echo "  tmux list-windows -t $SESSION_NAME"
echo "Each window owns one persistent Playwright MCP worker and browser."
