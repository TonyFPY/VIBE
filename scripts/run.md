## dev 
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash \
  --runMode dev \
  --pid 1 

## ops
### Visual Similarity Task
#### 1 9 17 25 33
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash-lite \
  --runMode ops \
  --pid 33 

#### 2 10 18 26 34
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3-flash-preview \
  --runMode ops \
  --pid 34 

#### 3 11 19 27 35
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.5-flash \
  --runMode ops \
  --pid 35 

#### 4 12 20 28 36
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task visual-similarity \
  --model google/gemini-3.7-flash \
  --runMode ops \
  --pid 36 

scripts/codex.sh \
  --task visual-similarity \
  --model gpt-5.6-luna \
  --id 1 \
  --run dev \
  --effort medium

scripts/codex.sh \
  --task visual-similarity \
  --model gpt-5.6-luna gpt-5.6-terra gpt-5.6-sol gpt-5.5 gpt-5.4 \
  --id 51 52 53 54 55 \
  --run ops \
  --effort medium

scripts/codex.sh \
  --task visual-similarity \
  --model gpt-5.4 \
  --id 45 \
  --run ops \
  --effort medium \
  --headed 45

### Object Matching Task

#### 5 13 21 29 37
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.5-flash-lite \
  --runMode ops \
  --pid 37 

#### 6 14 22 30 38
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3-flash-preview \
  --runMode ops \
  --pid 38 

#### 7 15 23 31 39
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.5-flash \
  --runMode ops \
  --pid 39 

#### 8 16 24 32 40
./agent_harness/run.sh \
  --host https://vibe-9d6e5.web.app \
  --task object-matching \
  --model google/gemini-3.7-flash \
  --runMode ops \
  --pid 40 

scripts/codex.sh \
  --task object-matching \
  --model gpt-5.6-luna gpt-5.6-terra gpt-5.6-sol gpt-5.5 gpt-5.4 \
  --id 56 57 58 59 60 \
  --run ops \
  --effort medium

scripts/codex.sh \
  --task object-matching \
  --model gpt-5.4 \
  --id 50 \
  --run ops \
  --effort medium \
  --headed 50

Codex runs now use the repository's persistent Playwright MCP worker path.
Use `--dry-run` to inspect each Codex command before starting tmux. Each fresh
`codex exec` attempt receives the same worker's loopback MCP URL and bearer
token inline, so the model reconnects to the existing browser/controller
instead of launching a second browser for the same participant ID. Every
`codex exec` attempt includes `--ignore-user-config` while keeping the
`vibe_browser` MCP server configured inline. It also sets
`mcp_servers.vibe_browser.default_tools_approval_mode="approve"` for that
private five-tool server, so headless `codex exec` does not reject its MCP
calls when the session approval policy is `never`; this does not approve shell,
filesystem, or any other MCP server. User-level MCP servers cannot bypass the
five-tool screenshot-only boundary. Testing response paths use one bounded
`move_trajectory` MCP call, which executes the ordered waypoints locally before
the final response click in the same request, avoiding a model round trip per
waypoint or after the trajectory. The
launcher does not call
`codex mcp add`, does not modify the user's global Codex configuration, and
does not allow Chrome-plugin, raw CDP, or direct Playwright fallbacks from the
model.

Each run allows ten Codex turns by default. If a turn ends with
`INCOMPLETE` before the visible save screen, the launcher starts a fresh
continuation turn and resumes the existing experiment tab. Override this with
`--max-attempts N` (1–10). A non-zero Codex process error still stops that run
and leaves its tmux window open for inspection.

Each participant ID gets exactly one persistent Playwright MCP worker and one
run directory. Continuation attempts reuse that worker instead of spawning a
second browser/controller for the same ID. In `--dry-run`, look for one
`worker manifest` and one `worker command` per `A<ID>` plus the separate
`attempt-001/` and `attempt-002/` artifact paths.

Readable live output is written to `attempt-00N/terminal.log` with compact
`[A<ID>]` and `[A<ID> attempt N]` prefixes. The raw Codex event stream is saved
unchanged in `attempt-00N/codex.jsonl`, and Codex's final message for that turn
is saved in `attempt-00N/last-message.txt`. The run root also keeps
`prompt-public.txt`, per-attempt prompt files, `events.jsonl`, `worker.log`,
`mcp-connection.json`, and `status.txt`.

Fresh-context resume means the next attempt starts a new Codex turn with the
same public instruction plus a continuation suffix that tells Codex to
reconnect to the existing MCP browser worker, call `observe` before any pointer
input, and continue from the newest visible page state instead of restarting
the experiment.

Runs are headless by default. Use `--headed <id...>` for selected visible
Chromium workers, or request the compatibility modes `--browser-profile
isolated` / `--browser-launch external`, which also force headed workers.
Multiple headed workers can compete for window focus and the desktop pointer;
default headless mode is the safer choice for parallel batches.
