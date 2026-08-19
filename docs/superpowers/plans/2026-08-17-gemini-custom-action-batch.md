# Gemini Custom Action Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini return one schema-constrained setup click or one 9–49-move trial path plus final click for each screenshot.

**Architecture:** Keep the provider-neutral `ComputerUseAgent` interface and existing Playwright/run-loop execution. Replace reliance on native Gemini pointer calls with two Gemini client-side custom functions; the adapter expands a trial function into the existing ordered action list and groups execution results back into provider-call results.

**Tech Stack:** TypeScript, `@google/genai` Interactions API, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-gemini-custom-action-batch-design.md`

## Global Constraints

- The model receives screenshots plus public instruction only; never pass DOM, accessibility data, URL, task configuration, source code, filesystem paths, backend payloads, answer keys, or hidden state.
- Use normalized Gemini coordinates in `0..999`; map to the fixed `1080 x 675` CSS viewport with existing floor conversion.
- A trial batch has 9 through 49 moves followed by exactly one click; total executable actions are 10 through 50.
- Setup/navigation uses one `click_visible` action and is exempt from the trial minimum.
- Invalid batches execute no browser actions and remain visible to the existing rejected-result retry path.
- Native predefined pointer actions, waits, navigation, keyboard, scrolling, dragging, and model-requested screenshots remain excluded.
- No paid Gemini call is required by unit, boundary, typecheck, or local integration tests.

### Task 1: Add custom Gemini function contracts and grouped adapter parsing

**Files:**
- Modify: `agent_harness/src/providers/gemini-computer-use.ts`
- Modify: `agent_harness/tests/providers/gemini-computer-use.test.ts`

**Interfaces:**
- Preserve `GeminiComputerUseAgent.next(observation, signal)` and `reportActionResults(observation, results, signal)`.
- Add request tools named `click_visible` and `submit_trial_actions`.
- Represent pending provider calls as `{ id, name, actionCount }` internally.

- [ ] **Step 1: Write failing tests.** Assert the initial request excludes native `click` and `move`, includes both custom function declarations, parses `click_visible` into one click, parses a 9-move trial function into 10 ordered actions, rejects 8 moves/50 moves plus click, rejects malformed coordinates, and reports one grouped function result for one custom batch call.

- [ ] **Step 2: Run the focused provider test.**

Run: `npm --prefix agent_harness test -- tests/providers/gemini-computer-use.test.ts`

Expected: FAIL because the request advertises native Computer Use pointer actions and the adapter does not recognize custom batch arguments.

- [ ] **Step 3: Implement the minimum adapter change.** Define the custom tool schemas, exclude native `click` and `move`, parse `click_visible` and `submit_trial_actions`, flatten custom trial actions, and group `ActionResult` entries by each pending provider call when constructing continuation results.

- [ ] **Step 4: Run focused tests and typecheck.**

Run: `npm --prefix agent_harness test -- tests/providers/gemini-computer-use.test.ts && npm --prefix agent_harness run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the adapter change.**

```bash
git add -- agent_harness/src/providers/gemini-computer-use.ts agent_harness/tests/providers/gemini-computer-use.test.ts
git commit -m "feat: use Gemini custom pointer batch tool"
```

### Task 2: Migrate boundary and integration fixtures to the custom function protocol

**Files:**
- Modify: `agent_harness/tests/no-cheating/observation-boundary.test.ts`
- Modify: `agent_harness/tests/integration/mock-run.test.ts`

**Interfaces:**
- Fake Gemini responses use `click_visible` for setup and `submit_trial_actions` for trial response.
- Existing `AgentTurn.actions` and run-loop batch lifecycle remain unchanged.

- [ ] **Step 1: Write failing fixture expectations.** Change the fake provider response shapes and assert the serialized requests contain custom tools but no native pointer-function names, while existing canary assertions remain active.

- [ ] **Step 2: Run focused boundary and integration tests.**

Run: `npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts tests/integration/mock-run.test.ts`

Expected: FAIL until the fixtures match the custom function parser and request shape.

- [ ] **Step 3: Update the fixtures without weakening boundary assertions.** Use a setup `click_visible` call and a trial `submit_trial_actions` call with literal normalized coordinates; keep evaluator-private values only inside the fake evaluator.

- [ ] **Step 4: Run focused tests and typecheck.**

Run: `npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts tests/integration/mock-run.test.ts && npm --prefix agent_harness run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the fixture migration.**

```bash
git add -- agent_harness/tests/no-cheating/observation-boundary.test.ts agent_harness/tests/integration/mock-run.test.ts
git commit -m "test: cover Gemini custom action batches"
```

### Task 3: Document the custom batch contract and update the local run configuration

**Files:**
- Modify: `agent_harness/README.md`
- Modify: `agent_harness/tmp/gemini-run.json`
- Modify: `docs/superpowers/specs/2026-08-17-gemini-trial-action-batch-design.md`

- [ ] **Step 1: Update documentation.** Replace claims that Gemini is guaranteed to return native ordered pointer batches with the custom function contract, explain one screenshot per batch, and state that `settleDelayMs` allows stimulus preparation before fixation.

- [ ] **Step 2: Add the tested local delay.** Keep `settleDelayMs` at `2000` in the repository run example so the deployed stimulus has time to prepare.

- [ ] **Step 3: Run markdown/config checks.**

Run: `node -e "JSON.parse(require('fs').readFileSync('agent_harness/tmp/gemini-run.json','utf8'))" && git diff --check -- agent_harness/README.md agent_harness/tmp/gemini-run.json docs/superpowers/specs/2026-08-17-gemini-trial-action-batch-design.md`

Expected: PASS for JSON parsing and no whitespace errors in the scoped files.

- [ ] **Step 4: Commit documentation.**

```bash
git add -- agent_harness/README.md agent_harness/tmp/gemini-run.json docs/superpowers/specs/2026-08-17-gemini-trial-action-batch-design.md
git commit -m "docs: describe Gemini custom action batches"
```

### Task 4: Verify the complete harness

**Files:**
- Verify: all files changed by Tasks 1–3.

- [ ] **Step 1: Run the unit suite.**

Run: `npm --prefix agent_harness test`

Expected: all required tests pass; the existing opt-in live suite remains skipped.

- [ ] **Step 2: Run typecheck and integration.**

Run: `npm --prefix agent_harness run typecheck && npm --prefix agent_harness run test:integration`

Expected: both commands exit successfully.

- [ ] **Step 3: Review boundary and diff status.**

Run: `git diff --check -- agent_harness && git status --short`

Expected: no scoped whitespace errors and only intended harness/spec/plan changes are present; unrelated user changes remain untouched.
