# Codex CLI + Persistent Playwright MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scripts/codex.sh` launch parallel Codex CLI experiment runs through persistent screenshot-only Playwright MCP workers, allowing fresh Codex contexts to resume the same browser page and emitting human-readable terminal output.

**Architecture:** One participant ID maps to one run directory, Playwright browser/page, local Streamable HTTP MCP worker, and a sequence of Codex `exec` attempts. The launcher starts/stops the worker, injects its URL into each Codex attempt through inline config, reuses the public instruction, and retries only while the visible experiment remains recoverable.

**Tech Stack:** Bash, Node.js 22+, TypeScript, Playwright, `@modelcontextprotocol/sdk` 1.30.0 `StreamableHTTPServerTransport`, Codex CLI `exec`, tmux, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-codex-mcp-refresh-design.md`

## Global Constraints

- Preserve the existing human website, task renderers, Firebase persistence, and Gemini harness behavior.
- Expose only `observe`, `move`, `click`, and `wait` through MCP.
- Never expose DOM, accessibility data, Playwright page objects, JavaScript results, source, filesystem paths, network bodies, task metadata, hidden state, or answer keys.
- Use one persistent browser/MCP worker per participant ID and never share workers between IDs.
- A fresh Codex attempt must reconnect to the existing worker/page and must not restart the experiment.
- Use `codex exec` configuration overrides; do not modify global Codex configuration or run `codex mcp add`.
- Reject invalid actions without clamping or silently repairing them.
- Keep raw JSONL and screenshots in run directories; stdout/stderr must be human-readable by default.
- Do not require paid model calls in CI.

### Task 1: Define the reconnectable MCP worker transport

**Files:**
- Create: `agent_harness/src/agent-browser/http-server-main.ts`
- Create: `agent_harness/src/agent-browser/http-server.ts`
- Modify: `agent_harness/src/agent-browser/mcp-server-main.ts`
- Test: `agent_harness/tests/agent-browser/http-server.test.ts`

**Interfaces:**
- `startAgentBrowserHttpServer(environment, factories): Promise<AgentBrowserHttpHandle>`
- `AgentBrowserHttpHandle.url: string`
- `AgentBrowserHttpHandle.close(): Promise<void>`

- [ ] **Step 1: Add failing lifecycle tests** for a loopback-only HTTP listener, a per-run bearer token, one `VisualBrowserToolset` per worker, reconnecting two client requests to the same toolset, and cleanup closing the HTTP server, browser session, host, and logger.
- [ ] **Step 2: Run the focused test** with `npm --prefix agent_harness test -- tests/agent-browser/http-server.test.ts` and confirm the new module is missing.
- [ ] **Step 3: Implement `StreamableHTTPServerTransport`** from `@modelcontextprotocol/sdk/server/streamableHttp.js` behind a Node `http.createServer`. Accept only the configured MCP endpoint, require the generated bearer token, dispatch initialize/tool requests to the same MCP server, and return 404/401/405 for invalid path, token, or method.
- [ ] **Step 4: Keep the existing stdio entrypoint unchanged** for compatibility and make the HTTP worker use the same `VisualBrowserToolset` and `PlaywrightBrowserHost`.
- [ ] **Step 5: Run the focused tests and `npm --prefix agent_harness run typecheck`.**

### Task 2: Add per-run worker lifecycle and Codex MCP configuration

**Files:**
- Create: `scripts/codex-mcp-worker.sh`
- Modify: `scripts/codex-native.sh`
- Modify: `scripts/codex.sh`
- Modify: `scripts/start-codex-experiments.test.sh`
- Test: `agent_harness/tests/run-script.test.ts`

**Interfaces:**
- `scripts/codex-mcp-worker.sh` starts the HTTP worker, writes a private connection manifest, and remains alive until terminated.
- The manifest contains only the loopback MCP URL, bearer token, run ID, and worker PID; it is mode `0600`.

- [ ] **Step 1: Extend shell tests** to assert one worker per ID, distinct ports/tokens, no `codex mcp add`, and inline Codex config containing the MCP URL/token without global config writes.
- [ ] **Step 2: Run the shell tests** and confirm they fail against the current Chrome-control launcher.
- [ ] **Step 3: Implement worker startup** in each `A<ID>` directory, select a loopback port, generate a token with `openssl rand -hex 32` or Node crypto, wait for the worker health/initialize readiness signal, and register cleanup with the tmux/run trap.
- [ ] **Step 4: Build each Codex command** with `codex exec --config` overrides for one MCP server, the requested model, effort, read-only sandbox, isolated run directory, JSONL output, and last-message file. Disable shell, unified execution, multi-agent, image generation, and local image inspection as currently required.
- [ ] **Step 5: Run shell syntax checks, launcher tests, and `--dry-run`;** verify dry-run prints topology/config summaries but does not create workers or browsers.

### Task 3: Implement fresh-context resume semantics

**Files:**
- Modify: `scripts/codex-native.sh`
- Modify: `agent_harness/src/agent-browser/http-server.ts`
- Modify: `agent_harness/src/agent-browser/mcp-server.ts`
- Test: `agent_harness/tests/agent-browser/http-server.test.ts`
- Test: `scripts/start-codex-experiments.test.sh`

**Interfaces:**
- `--max-attempts N` remains the retry limit, default `5`.
- Each attempt receives the same generated public instruction plus a short continuation suffix.
- Worker state remains browser/page state; Codex context is disposable.

- [ ] **Step 1: Add tests** showing attempt 2 reconnects to the same worker, receives the same task instruction, must observe before pointer input, and does not issue a second navigation/start sequence.
- [ ] **Step 2: Implement attempt state** using `attempt-001`, `attempt-002`, etc. in separate Codex JSONL files while retaining one worker manifest and one browser session.
- [ ] **Step 3: Detect retryable outcomes** from exit status, last-message markers, MCP transport termination, and worker event status. Retry only when no visible terminal result has been observed and attempts remain.
- [ ] **Step 4: Add continuation instructions**: reconnect to the existing task, do not restart, call `observe`, reassess from the newest screenshot, and reuse the original public task instruction.
- [ ] **Step 5: Test terminal success and exhaustion** so visible save/download states stop retries and exhausted attempts produce `INCOMPLETE`.

### Task 4: Produce human-readable operator output

**Files:**
- Create: `scripts/format-codex-event.mjs`
- Modify: `scripts/filter-codex-output.mjs`
- Modify: `scripts/codex-native.sh`
- Modify: `scripts/filter-codex-output.test.mjs`
- Test: `scripts/format-codex-event.test.mjs`

**Interfaces:**
- `formatCodexEvent(event, context): string | undefined`
- `formatModelMessage(text, context): string`
- `summarizeToolEvent(event, context): string | undefined`

- [ ] **Step 1: Add formatter tests** for model messages, attempt/status events, tool calls, coordinate summaries, errors, truncation, multiline normalization, image-data omission, and unknown JSON events.
- [ ] **Step 2: Implement line formatting** with `[A<ID> attempt N]` prefixes, concise event names, coordinate summaries, retry messages, and final statuses.
- [ ] **Step 3: Forward human-readable Codex model messages** after stripping protocol envelopes and normalizing whitespace. Truncate long messages to a fixed limit, retain the complete event in raw logs, and omit hidden reasoning fields, raw tool arguments, base64, and generic `data` payloads.
- [ ] **Step 4: Keep raw logs separate** from terminal output. Use `tee` only after formatting, never on raw Codex JSONL.
- [ ] **Step 5: Run formatter tests and a dry-run** confirming no unfiltered `data` or image payload is printed.

### Task 5: Verify parallel end-to-end behavior and update documentation

**Files:**
- Modify: `agent_harness/README.md`
- Modify: `scripts/run.md`
- Modify: `README.md`
- Modify: `scripts/codex-native.test.sh`
- Modify: `scripts/start-codex-experiments.test.sh`

- [ ] **Step 1: Document** the unchanged command, one-worker-per-ID behavior, retry/context-refresh semantics, human-readable output, raw log locations, and `--max-attempts`.
- [ ] **Step 2: Add a no-paid-call mock integration test** with two IDs, two workers, one forced failed attempt, one resumed attempt, and separate saved run artifacts.
- [ ] **Step 3: Run verification:** `npm test`, `npm --prefix agent_harness test`, `npm --prefix agent_harness run typecheck`, `npm run build`, both launcher shell tests, `bash -n scripts/codex.sh scripts/codex-native.sh scripts/codex-mcp-worker.sh`, and `git diff --check`.
- [ ] **Step 4: Run a local headed smoke test** against `run=dev` with one ID and a deterministic/mock Codex path; confirm the browser page survives a forced context refresh and the terminal contains readable model/status lines.
- [ ] **Step 5: Review the diff** for global Codex config writes, shared browser state, private information leakage, raw terminal JSON, and accidental changes to the Gemini/human paths.
