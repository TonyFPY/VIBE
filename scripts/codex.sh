#!/usr/bin/env bash
set -euo pipefail

# Stable public entry point for Codex experiment runs.
#
# The implementation lives in codex-native.sh so this command does not require
# the repository's Playwright/custom-MCP dependencies or Gemini browser
# harness. It still uses the Chrome integration configured in Codex CLI.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

exec bash "$SCRIPT_DIR/codex-native.sh" "$@"
