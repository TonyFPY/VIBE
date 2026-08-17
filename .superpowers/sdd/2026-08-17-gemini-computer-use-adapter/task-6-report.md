# Task 6 Report

## Status

Complete. Rebuilt the no-cheating boundary test around the committed
`GeminiComputerUseAgent`, fake Gemini transport, metadata-only browser-session
events, and persisted `RunLogger` output. Updated logging to remove
request/response body fields from persisted events and to persist backend
events as metadata only. Rewrote the harness README and `.env.example` for the
Gemini API key/native Computer Use flow. Marked the 2026-08-16 design and plan
superseded with links to the 2026-08-17 Gemini design and plan.

## Changed Files

- `agent_harness/tests/no-cheating/observation-boundary.test.ts`
- `agent_harness/src/logging/run-logger.ts`
- `agent_harness/README.md`
- `agent_harness/.env.example`
- `docs/superpowers/specs/2026-08-16-agent-harness-design.md`
- `docs/superpowers/plans/2026-08-16-agent-harness.md`

## Commit

- `a9f139ea65d357146086ba015bde3ac0efb2b8b2` (`docs: document Gemini computer-use boundary`)

## Commands and Output

### Initial required red boundary run before edits

Command:

```bash
npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts
```

Output:

```text
> test
> vitest run tests/no-cheating/observation-boundary.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness

 ❯ tests/no-cheating/observation-boundary.test.ts (0 test)

 FAIL  tests/no-cheating/observation-boundary.test.ts [ tests/no-cheating/observation-boundary.test.ts ]
Error: Cannot find module '../../src/providers/google-request-builders' imported from /Users/tonyfeng/GitHub/vibe/agent_harness/tests/no-cheating/observation-boundary.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

### Replacement boundary test red run

Command:

```bash
npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts
```

Output:

```text
> test
> vitest run tests/no-cheating/observation-boundary.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness

 ❯ tests/no-cheating/observation-boundary.test.ts (1 test | 1 failed) 15ms
     × keeps private task data, page state, URLs, and bodies out of Gemini requests and persisted logs 15ms

AssertionError: persisted logs: expected ... not to contain 'responseBody'

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

### Boundary test after implementation

Command:

```bash
npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts
```

Output:

```text
> test
> vitest run tests/no-cheating/observation-boundary.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:49:16
   Duration  248ms (transform 55ms, setup 0ms, import 133ms, tests 11ms, environment 0ms)
```

### Scoped documentation/protocol residue check

Command:

```bash
rg -n "DONE|CLICK|MOVE|google-agent-platform|responseJsonSchema|OpenAI-compatible|rawPredict" agent_harness/src agent_harness/tests agent_harness/README.md
```

Output:

```text
agent_harness/tests/logging/run-logger.test.ts:26:      rawOutput: '{"type":"DONE"}',
agent_harness/tests/logging/run-logger.test.ts:32:    expect(eventText).toContain('"rawOutput":"{\\"type\\":\\"DONE\\"}"');
agent_harness/tests/prompts/public-instruction.test.ts:8:      "Complete the visual similarity experiment using only what is visible. Start or continue when prompted. Choose the candidate most visually similar to the reference after each trial is revealed. Return DONE only when the visible page says the experiment is complete or results were saved successfully; do not finish while it still says results are saving.",
agent_harness/tests/actions/contract.test.ts:15:    expect(validateComputerAction({ type: "DONE" }, viewport)).toMatchObject({ valid: false });
agent_harness/tests/actions/contract.test.ts:16:    expect(validateComputerAction({ type: "CLICK", x: 1, y: 2, purpose: "response" }, viewport)).toMatchObject({ valid: false });
```

### Focused logger verification

Command:

```bash
npm --prefix agent_harness test -- tests/logging/run-logger.test.ts
```

Output:

```text
> test
> vitest run tests/logging/run-logger.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:49:26
   Duration  130ms (transform 19ms, setup 0ms, import 28ms, tests 7ms, environment 0ms)
```

### Whitespace check

Command:

```bash
git diff --check -- agent_harness/tests/no-cheating/observation-boundary.test.ts agent_harness/src/logging/run-logger.ts agent_harness/README.md agent_harness/.env.example docs/superpowers/specs/2026-08-16-agent-harness-design.md docs/superpowers/plans/2026-08-16-agent-harness.md
```

Output:

```text
```

## Fix Round 2

### Review findings addressed

- `FakeEvaluatorSessionState` now evaluates private render and backend state
  from `privateTrial`, `internalTaskRecord`, `pageLikeObject`, and backend
  fixture fields. It stores raw canary-bearing values, renders the public
  screenshot from private state, and derives backend metadata in a separate
  public boundary method before emitting it.
- `RecordingRunLogger` recursively checks every event with
  `assertNoStructuralBoundaryLeak` before delegating to `RunLogger`, while
  retaining captured events and persisted-log assertions.

### Verification

Command:

```bash
npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts tests/logging/run-logger.test.ts
```

Output:

```text
Test Files  2 passed (2)
Tests       2 passed (2)
```

### Staged files

Command:

```bash
git diff --cached --name-only
```

Output:

```text
agent_harness/.env.example
agent_harness/README.md
agent_harness/src/logging/run-logger.ts
agent_harness/tests/no-cheating/observation-boundary.test.ts
docs/superpowers/plans/2026-08-16-agent-harness.md
docs/superpowers/specs/2026-08-16-agent-harness-design.md
```

### Commit

Command:

```bash
git commit -m "docs: document Gemini computer-use boundary"
```

Output:

```text
[master a9f139e] docs: document Gemini computer-use boundary
 6 files changed, 334 insertions(+), 132 deletions(-)
```

## Concerns

- The scoped `rg` check still reports stale protocol references in
  `agent_harness/tests/logging/run-logger.test.ts`,
  `agent_harness/tests/prompts/public-instruction.test.ts`, and
  `agent_harness/tests/actions/contract.test.ts`. Those files are outside the
  Task 6 modification scope, so I recorded the exact output and did not edit
  them.
- Pre-existing out-of-scope workspace state remains untouched:
  `docs/superpowers/specs/2026-08-17-gemini-computer-use-adapter-design.md`
  is modified, and `agent_harness/tmp/` plus
  `docs/superpowers/plans/2026-08-17-gemini-computer-use-adapter.md` are
  untracked.

## Fix Round 1

### Status

Addressed the three Important review findings:

- The no-cheating test now routes canary-bearing private trial fields,
  internal task records, page-like functions, backend request/response bodies,
  and provider body fields through evaluator-side fake setup.
- The fake agent and fake Gemini transport perform direct structural boundary
  checks on received observations, action results, and provider requests. The
  test also recursively checks persisted log events and backend events so
  function-valued or non-enumerable page-like leaks are not hidden by
  `JSON.stringify`.
- The superseded 2026-08-16 plan and design now contain only concise inactive
  notices and links to the 2026-08-17 Gemini design/plan.

### Commands and Output

Boundary test:

```bash
npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts
```

```text
> test
> vitest run tests/no-cheating/observation-boundary.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:56:19
   Duration  235ms (transform 56ms, setup 0ms, import 117ms, tests 12ms, environment 0ms)
```

Logger test:

```bash
npm --prefix agent_harness test -- tests/logging/run-logger.test.ts
```

```text
> test
> vitest run tests/logging/run-logger.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:56:22
   Duration  128ms (transform 19ms, setup 0ms, import 28ms, tests 7ms, environment 0ms)
```

Scoped protocol residue check:

```bash
rg -n "DONE|CLICK|MOVE|google-agent-platform|responseJsonSchema|OpenAI-compatible|rawPredict" agent_harness/src agent_harness/tests agent_harness/README.md
```

```text
agent_harness/tests/logging/run-logger.test.ts:26:      rawOutput: '{"type":"DONE"}',
agent_harness/tests/logging/run-logger.test.ts:32:    expect(eventText).toContain('"rawOutput":"{\\"type\\":\\"DONE\\"}"');
agent_harness/tests/prompts/public-instruction.test.ts:8:      "Complete the visual similarity experiment using only what is visible. Start or continue when prompted. Choose the candidate most visually similar to the reference after each trial is revealed. Return DONE only when the visible page says the experiment is complete or results were saved successfully; do not finish while it still says results are saving.",
agent_harness/tests/actions/contract.test.ts:15:    expect(validateComputerAction({ type: "DONE" }, viewport)).toMatchObject({ valid: false });
agent_harness/tests/actions/contract.test.ts:16:    expect(validateComputerAction({ type: "CLICK", x: 1, y: 2, purpose: "response" }, viewport)).toMatchObject({ valid: false });
```

Superseded-doc stale instruction check:

```bash
rg -n "REQUIRED SUB-SKILL|Google Agent Platform|ModelAdapter|CLICK|MOVE|DONE|OpenAI-compatible|rawPredict|google-agent-platform|responseJsonSchema" docs/superpowers/specs/2026-08-16-agent-harness-design.md docs/superpowers/plans/2026-08-16-agent-harness.md
```

```text
```

Whitespace check:

```bash
git diff --check -- agent_harness/tests/no-cheating/observation-boundary.test.ts agent_harness/src/logging/run-logger.ts agent_harness/README.md agent_harness/.env.example docs/superpowers/specs/2026-08-16-agent-harness-design.md docs/superpowers/plans/2026-08-16-agent-harness.md .superpowers/sdd/2026-08-17-gemini-computer-use-adapter/task-6-report.md
```

```text
```

### Concerns

- The scoped `rg` check still reports stale protocol references in
  out-of-scope tests. I left those files unchanged as instructed.
- Pre-existing out-of-scope workspace state remains untouched:
  `docs/superpowers/specs/2026-08-17-gemini-computer-use-adapter-design.md`
  is modified, and `agent_harness/tmp/` plus
  `docs/superpowers/plans/2026-08-17-gemini-computer-use-adapter.md` are
  untracked.

### Final Fix Round 1 Verification

Fresh checks requested before commit:

```bash
npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts
```

```text
> test
> vitest run tests/no-cheating/observation-boundary.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:58:01
   Duration  259ms (transform 57ms, setup 0ms, import 139ms, tests 12ms, environment 0ms)
```

```bash
npm --prefix agent_harness test -- tests/logging/run-logger.test.ts
```

```text
> test
> vitest run tests/logging/run-logger.test.ts


 RUN  v4.1.10 /Users/tonyfeng/GitHub/vibe/agent_harness


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:58:05
   Duration  131ms (transform 21ms, setup 0ms, import 30ms, tests 7ms, environment 0ms)
```

```bash
rg -n "DONE|CLICK|MOVE|google-agent-platform|responseJsonSchema|OpenAI-compatible|rawPredict" agent_harness/src agent_harness/tests agent_harness/README.md
```

```text
agent_harness/tests/logging/run-logger.test.ts:26:      rawOutput: '{"type":"DONE"}',
agent_harness/tests/logging/run-logger.test.ts:32:    expect(eventText).toContain('"rawOutput":"{\\"type\\":\\"DONE\\"}"');
agent_harness/tests/prompts/public-instruction.test.ts:8:      "Complete the visual similarity experiment using only what is visible. Start or continue when prompted. Choose the candidate most visually similar to the reference after each trial is revealed. Return DONE only when the visible page says the experiment is complete or results were saved successfully; do not finish while it still says results are saving.",
agent_harness/tests/actions/contract.test.ts:15:    expect(validateComputerAction({ type: "DONE" }, viewport)).toMatchObject({ valid: false });
agent_harness/tests/actions/contract.test.ts:16:    expect(validateComputerAction({ type: "CLICK", x: 1, y: 2, purpose: "response" }, viewport)).toMatchObject({ valid: false });
```

```bash
rg -n "REQUIRED SUB-SKILL|Google Agent Platform|ModelAdapter|CLICK|MOVE|DONE|OpenAI-compatible|rawPredict|google-agent-platform|responseJsonSchema" docs/superpowers/specs/2026-08-16-agent-harness-design.md docs/superpowers/plans/2026-08-16-agent-harness.md
```

```text
```

```bash
git diff --check -- agent_harness/tests/no-cheating/observation-boundary.test.ts agent_harness/src/logging/run-logger.ts agent_harness/README.md agent_harness/.env.example docs/superpowers/specs/2026-08-16-agent-harness-design.md docs/superpowers/plans/2026-08-16-agent-harness.md .superpowers/sdd/2026-08-17-gemini-computer-use-adapter/task-6-report.md
```

```text
```
