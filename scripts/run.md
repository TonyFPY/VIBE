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
  --id 41 42 43 44 45 \
  --run ops \
  --effort medium

scripts/codex.sh \
  --task visual-similarity \
  --model gpt-5.5 gpt-5.4 \
  --id 44 45 \
  --run ops \
  --effort medium

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
  --id 46 47 48 49 50 \
  --run ops \
  --effort medium

The command stays `scripts/codex.sh`; the wrapper now forwards to the native
persistent MCP launcher without changing flags or argument order.

scripts/codex.sh \
  --task object-matching \
  --model gpt-5.6-luna gpt-5.4 \
  --id 46 50 \
  --run ops \
  --effort medium \
  --allow-shared-browser

Codex runs now use the repository's persistent Playwright MCP worker path.
Use `--dry-run` to inspect each Codex command before starting tmux. Each fresh
`codex exec` attempt receives the same worker's loopback MCP URL and bearer
token inline, so the model reconnects to the existing browser/controller
instead of launching a second browser for the same participant ID. The old
`--headed` option is accepted for compatibility but has no effect because
these runs are always headed. The launcher does not call `codex mcp add`,
does not modify the user's global Codex configuration, and does not allow
Chrome-plugin, raw CDP, or direct Playwright fallbacks from the model.

Each run allows five Codex turns by default. If a turn ends with
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

These runs are headed, so multiple local workers can still compete for window
focus and the desktop pointer. Use explicit isolated worker requests when you
need parallel local runs.
