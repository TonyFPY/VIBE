#!/usr/bin/env bash
set -euo pipefail

# Stable public entry point for Codex experiment runs.
#
# The implementation lives in codex-native.sh and launches one persistent
# Playwright MCP browser worker per participant ID. It does not use the Chrome
# plugin path or the Gemini browser harness.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

exec bash "$SCRIPT_DIR/codex-native.sh" "$@"
