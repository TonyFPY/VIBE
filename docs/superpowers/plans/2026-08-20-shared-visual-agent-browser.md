# Shared Visual Agent Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral screenshot-only MCP browser bridge and make `scripts/codex.sh` launch truly isolated headless/headed Codex experiment runs.

**Architecture:** Reuse the existing `PlaywrightBrowserHost` behind a new `agent-browser` runtime. Each MCP process owns one browser context and one run logger. `codex.sh` creates one tmux window and one Codex `exec` process per model/ID pair, configuring the MCP server inline without changing global Codex configuration.

**Tech Stack:** Bash, Node.js 22+, TypeScript, Playwright, `@modelcontextprotocol/sdk` 1.30.0, Vitest, tmux.

**Spec:** `docs/superpowers/specs/2026-08-20-shared-visual-agent-browser-design.md`

## Global Constraints

- Keep Gemini provider files and the existing human experiment unchanged.
- Expose screenshots and pointer/wait actions only; never expose DOM, accessibility data, page objects, JavaScript, source, filesystem, network bodies, task metadata, or answer keys.
- Default every run to actual Chromium headless mode; `--headed` is an explicit per-ID override.
- Use one browser context, MCP process, and run directory per experiment run.
- Do not mutate global Codex configuration.
- Invalid actions are rejected and logged rather than repaired.
- Do not require paid model calls in tests.

### Task 1: Add shared run configuration and action boundary

**Files:**
- Create: `agent_harness/src/agent-browser/run-config.ts`
- Create: `agent_harness/src/agent-browser/action-policy.ts`
- Test: `agent_harness/tests/agent-browser/run-config.test.ts`
- Test: `agent_harness/tests/agent-browser/action-policy.test.ts`

**Interfaces:**
- `parseAgentBrowserConfig(environment: NodeJS.ProcessEnv): AgentBrowserConfig`
- `validatePointerAction(action: unknown, viewport: Viewport): ActionValidation`
- `validateWaitAction(milliseconds: unknown): ActionValidation`

- [ ] **Step 1: Write failing configuration and policy tests** for default headless mode, explicit headed mode, supported task URLs, invalid environment values, coordinate bounds, unsupported fields, and wait bounds.
- [ ] **Step 2: Run `npm --prefix agent_harness test -- tests/agent-browser/run-config.test.ts tests/agent-browser/action-policy.test.ts`** and confirm the new modules are missing.
- [ ] **Step 3: Implement minimal pure validation/configuration modules** with no Playwright or MCP imports.
- [ ] **Step 4: Run the focused tests and typecheck** and confirm they pass.

### Task 2: Add the shared MCP toolset

**Files:**
- Create: `agent_harness/src/agent-browser/mcp-server.ts`
- Test: `agent_harness/tests/agent-browser/mcp-server.test.ts`

**Interfaces:**
- `VisualBrowserToolset` owns a lazy `BrowserSession`, `RunLoggerPort`, and run configuration.
- `createVisualBrowserMcpServer(toolset: VisualBrowserToolset): McpServer`
- `VisualBrowserToolset.close(): Promise<void>`

- [ ] **Step 1: Write failing tests** for the four-tool surface, JPEG observation output, action execution, one browser session per run, invalid-action logging, no private value leakage, and cleanup.
- [ ] **Step 2: Run the focused MCP test and confirm failure** because the toolset does not exist.
- [ ] **Step 3: Implement the toolset** using the existing `BrowserHost`/`BrowserSession` interfaces and `RunLogger`; never pass the page object into a tool result.
- [ ] **Step 4: Register only the four MCP tools** with the official SDK and run the focused tests.

### Task 3: Add the stdio server entrypoint

**Files:**
- Create: `agent_harness/src/agent-browser/mcp-server-main.ts`
- Modify: `agent_harness/package.json`
- Modify: `agent_harness/package-lock.json`
- Test: `agent_harness/tests/agent-browser/mcp-server-main.test.ts`

**Interfaces:**
- `main()` reads the environment, constructs the existing Playwright host and logger, connects `StdioServerTransport`, and closes all resources on exit.

- [ ] **Step 1: Write failing entrypoint lifecycle tests** using injected factories so tests do not launch a real browser.
- [ ] **Step 2: Run the focused test and confirm failure.**
- [ ] **Step 3: Implement startup, stderr-only diagnostics, signal/error cleanup, and the `agent-browser-mcp` package script.**
- [ ] **Step 4: Run focused tests and `npm --prefix agent_harness run typecheck`.**

### Task 4: Replace prompt-only browser mode in `scripts/codex.sh`

**Files:**
- Modify: `scripts/codex.sh`
- Modify: `scripts/start-codex-experiments.test.sh`

**Interfaces:**
- Preserve `--task`, `--model`, `--id`, `--effort`, `--headed`, `--host`, `--run`, `--session`, and `--dry-run`.
- Add `--runs-dir` for explicit batch-log placement.

- [ ] **Step 1: Extend the shell test** to assert actual MCP environment/config values, default headless behavior, selected headed IDs, clean Codex flags, and no global `codex mcp add` mutation.
- [ ] **Step 2: Run the shell test and confirm the new assertions fail** against the current prompt-only launcher.
- [ ] **Step 3: Implement per-run batch directories, TOML-safe inline MCP configuration, `codex exec`, capability disabling, isolated working directories, and tmux lifecycle handling.**
- [ ] **Step 4: Run shell syntax checks, launcher tests, and dry-run inspection.**

### Task 5: Document operation and perform full verification

**Files:**
- Modify: `agent_harness/README.md`
- Modify: `scripts/run.md`
- Modify: `scripts/codex.sh` only if verification exposes a usability issue.

- [ ] **Step 1: Document installation, headless default, headed override, run logs, tmux commands, and the provider-neutral MCP extension point.**
- [ ] **Step 2: Run the full harness test suite, typecheck, shell tests, `bash -n`, and `git diff --check`.**
- [ ] **Step 3: Review the diff for Gemini changes, secret leakage, global Codex config writes, and accidental broad filesystem access.**
