# Gemini Trial-Response Action Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gemini Computer Use harness operate at trial boundaries: the setup Start interaction may be short, while every trial response is one validated batch of 10–50 pointer actions with at least nine moves followed by one final click, and only one screenshot is captured per batch.

**Architecture:** Keep the Firebase website as the experiment and evaluator. The Playwright controller remains a screenshot/pointer execution boundary, the provider-neutral agent interface reports ordered action-result lists, the Gemini adapter translates native multi-call Interactions into shared actions, and the run loop owns setup/trial phase transitions, center fixation, backend completion, and batch validation.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Playwright, `@google/genai` Gemini API Interactions, Firebase-hosted experiment website.

**Spec:** `docs/superpowers/specs/2026-08-17-gemini-trial-action-batch-design.md`

## Global Constraints

- The agent receives screenshots and public task guidance only; never expose DOM, URL, task metadata, backend payloads, answer keys, source, filesystem paths, or Playwright objects.
- The fixed browser viewport is exactly `1080 x 675` CSS pixels at device scale factor `1`.
- Gemini coordinates are normalized `0..999` and are converted to fixed CSS pixels; invalid coordinates are rejected, never clamped.
- Accepted model actions are only `move` and a final `click`; `wait`, navigation, keyboard, scrolling, dragging, and extra clicks are rejected.
- The setup batch may contain `1..50` actions and must end in one click; each trial-response batch must contain `10..50` actions, with at least nine moves before its final click.
- Validate the full batch before browser execution; invalid batches execute nothing and preserve the current screenshot for retry.
- The final click is the trial response. Center fixation is controller-owned, not a model action, and is not sent as a provider result.
- Capture no screenshot between actions in a valid batch; attach one fresh screenshot to the next provider continuation.
- Website result-save success is the only successful run condition and takes precedence over further provider work.
- Paid Gemini calls remain opt-in and are excluded from CI.
- Preserve the existing human website, Firebase backend, data schema, and unrelated working-tree changes.

## Files and Responsibilities

- Modify `agent_harness/src/actions/policy.ts` to add phase-aware whole-batch validation and the 50-action/10-action constants.
- Modify `agent_harness/src/actions/executor.ts` to execute a validated batch sequentially without taking screenshots between actions.
- Modify `agent_harness/src/providers/computer-use-agent.ts` to replace singular action-result reporting with ordered result-list reporting.
- Modify `agent_harness/src/providers/gemini-computer-use.ts` to parse native multi-call Gemini interactions, retain all call IDs, add the batch policy text, and send one result per call with one screenshot.
- Modify `agent_harness/src/core/run-loop.ts` to implement instruction screenshot → setup batch → fixation → trial batch → fixation/next screenshot → saving/completion lifecycle.
- Modify `agent_harness/src/config/types.ts`, `agent_harness/src/config/load-config.ts`, and `agent_harness/src/cli.ts` to expose `mouseMoveSteps` with default `1` and pass it to Playwright.
- Modify `agent_harness/src/browser/playwright-controller.ts` so the default Playwright move uses `steps: 1`.
- Modify `agent_harness/README.md` to document trial batches, the setup exception, screenshot cadence, and `mouseMoveSteps`.
- Update unit, integration, and no-cheating tests under `agent_harness/tests/` to use the plural interface and assert the phase-specific lifecycle.

---

### Task 1: Add phase-aware batch policy and sequential batch execution

**Files:**

- Modify: `agent_harness/src/actions/policy.ts`
- Modify: `agent_harness/src/actions/executor.ts`
- Test: `agent_harness/tests/actions/policy.test.ts`
- Test: `agent_harness/tests/actions/executor.test.ts`

**Interfaces:**

- Produce `ActionBatchPhase = "setup" | "trial"`.
- Produce `MAX_BATCH_ACTIONS = 50` and `MIN_TRIAL_BATCH_ACTIONS = 10`.
- Produce `validateComputerActionBatch(actions, viewport, phase)`, returning `{ valid: true }` or `{ valid: false; error: string }`.
- Produce `executeComputerActionBatch(session, actions, sleep)`, returning the ordered `ActionResult[]` plus whether execution failed, while reusing `executeComputerAction` for each action.

- [ ] **Step 1: Write failing policy tests.** Add cases asserting that setup accepts a single move followed by a click, trial rejects nine total actions, trial accepts nine moves plus a click, 50 actions are accepted, 51 actions are rejected, click-before-final and non-move intermediates are rejected, and every action still uses the existing finite in-viewport checks.

- [ ] **Step 2: Run the policy tests and verify they fail.**

  Run: `npm --prefix agent_harness exec vitest run tests/actions/policy.test.ts`

  Expected: FAIL because the phase-aware batch validator and constants do not yet exist.

- [ ] **Step 3: Implement the minimal whole-batch validator.** Check the total count first, require the final action to be `click`, require all preceding actions to be `move`, apply `validateComputerAction` to every action, and require `actions.length >= 10` only when `phase === "trial"`. Return an error that identifies the violated batch rule without modifying the action list.

- [ ] **Step 4: Write failing executor tests.** Add a batch containing multiple moves and a final click and assert exact execution order, one `ActionResult` per action, and no screenshot method is involved. Add a browser failure case asserting execution stops at the failed action and later actions are not silently executed.

- [ ] **Step 5: Run the executor tests and verify they fail.**

  Run: `npm --prefix agent_harness exec vitest run tests/actions/executor.test.ts`

  Expected: FAIL because the batch executor does not yet exist.

- [ ] **Step 6: Implement sequential batch execution.** Execute actions in array order, append each result, stop immediately after a `failed` result, and return the results collected so far with a failure flag. Do not add interpolation, screenshots, DOM access, or action repair.

- [ ] **Step 7: Run both action test files.**

  Run: `npm --prefix agent_harness exec vitest run tests/actions/policy.test.ts tests/actions/executor.test.ts`

  Expected: PASS.

- [ ] **Step 8: Commit the scoped action-policy and executor changes.**

  Run: `git add -- agent_harness/src/actions/policy.ts agent_harness/src/actions/executor.ts agent_harness/tests/actions/policy.test.ts agent_harness/tests/actions/executor.test.ts && git commit -m "feat: validate and execute pointer action batches"`

### Task 2: Make the provider-neutral interface and Gemini adapter batch-aware

**Files:**

- Modify: `agent_harness/src/providers/computer-use-agent.ts`
- Modify: `agent_harness/src/providers/gemini-computer-use.ts`
- Test: `agent_harness/tests/providers/gemini-computer-use.test.ts`

**Interfaces:**

- Replace `reportActionResult(observation, result, signal)` with `reportActionResults(observation, results: readonly ActionResult[], signal)`.
- Keep `AgentTurn.actions` as an ordered `readonly ComputerAction[]`; phase-specific minimum validation remains in the run loop because the provider does not know whether a batch is setup or trial.
- Store `PendingFunctionCall[]` for every parsed native call and require one returned `ActionResult` for each pending call in original order.

- [ ] **Step 1: Write failing adapter tests.** Add native interaction fixtures containing ordered `move`, `move`, `click` calls and assert all actions are returned in order. Add 50-call acceptance and 51-call rejection. Add rejection tests for a non-pointer call, malformed coordinates, click before the final call, a non-click final call, and a second click. Add a continuation assertion that a result list produces one `function_result` per call and exactly one image part on the final result.

- [ ] **Step 2: Run the adapter tests and verify they fail.**

  Run: `npm --prefix agent_harness exec vitest run tests/providers/gemini-computer-use.test.ts`

  Expected: FAIL because the adapter still accepts exactly one call and exposes singular reporting.

- [ ] **Step 3: Update the provider interface and pending-call state.** Change every method and field to plural results, replace the singular pending call with an ordered array, and reject a continuation when no batch is pending or when the result count does not match the pending call count.

- [ ] **Step 4: Parse and normalize all native calls.** Filter function-call steps in their original order, parse only `move` and `click`/legacy pointer equivalents, reject unsupported or malformed calls as one provider turn, reject a batch over 50, and require every call before the last to be `move` with the last call `click`. Do not enforce the 10-action minimum in this adapter because the initial Start batch is exempt.

- [ ] **Step 5: Build one continuation request per batch.** Add one `function_result` object for each pending call, preserve each call ID and name, serialize only `{ status, error }` as text, attach the current screenshot only to the final function result, and keep the existing native `previous_interaction_id` flow.

- [ ] **Step 6: Add the provider interaction policy to the initial Gemini text input.** Keep the task instruction as the public task goal and append only public harness guidance: click Start without padding during setup; after the task starts, emit at least nine separate moves followed by one final click per trial; use at most 50 actions; use no waits or other excluded controls. The harness remains authoritative if the model violates the policy.

- [ ] **Step 7: Run the adapter tests.**

  Run: `npm --prefix agent_harness exec vitest run tests/providers/gemini-computer-use.test.ts`

  Expected: PASS.

- [ ] **Step 8: Commit the provider changes.**

  Run: `git add -- agent_harness/src/providers/computer-use-agent.ts agent_harness/src/providers/gemini-computer-use.ts agent_harness/tests/providers/gemini-computer-use.test.ts && git commit -m "feat: support Gemini multi-call computer-use batches"`

### Task 3: Change the run loop to trial-level observations and results

**Files:**

- Modify: `agent_harness/src/core/run-loop.ts`
- Test: `agent_harness/tests/core/run-loop.test.ts`

**Interfaces:**

- Consume `validateComputerActionBatch`, `executeComputerActionBatch`, `reportActionResults`, and `ActionBatchPhase` from Tasks 1–2.
- Preserve `RunSummary.actionCount` as executed model-action count, `observationCount` as captured screenshot count, and `stepCount` as provider-interaction count.

- [ ] **Step 1: Rewrite the run-loop fixture for plural provider calls.** Store provider calls as either `{ method: "next", observation }` or `{ method: "reportActionResults", observation, results }`; make the fake agent return the next scripted turn from both methods; retain backend-event, screenshot, sleep, and cleanup controls.

- [ ] **Step 2: Write failing lifecycle tests.** Assert the first screenshot is captured before any center fixation and is sent with the setup `next` request. Script a short Start batch, assert the harness executes it, performs one controller-owned center move/click, captures one trial screenshot, and reports all Start results together. Script a 10-action trial batch and assert all moves and the final click execute before exactly one next screenshot/continuation. Assert no screenshot occurs between actions.

- [ ] **Step 3: Add completion and invalid-batch tests.** Assert a successful backend event from the final trial click stops the run before fixation or another provider request. Assert a short trial batch is logged/reported as rejected per action, leaves browser state and screenshot unchanged, and can retry. Assert an invalid setup batch can retry without applying actions. Assert a browser failure stops a batch and does not execute later actions.

- [ ] **Step 4: Implement the setup-first lifecycle.** After opening and subscribing to backend events, capture the instructions screenshot before calling `agent.next`. Validate the returned actions with phase `setup`. Do not call `beginFixation` before this first observation.

- [ ] **Step 5: Implement whole-batch validation and retry.** Replace `validateSingleAction` with phase-aware validation. On invalid shape or phase count, increment the existing invalid-batch counter once, create a rejected result for each returned action (using the existing safe wait placeholder only when the returned list is empty), log every rejected action with batch index/size, and call `reportActionResults` with the unchanged observation. Execute nothing.

- [ ] **Step 6: Implement setup continuation.** Execute the accepted Start batch in order, log each action with its batch index and total size, increment `actionCount` for each executed action, wait once for the configured settle delay, then check backend terminal state. If still active, perform controller-owned center fixation, capture the first trial screenshot, and call `reportActionResults` once with all Start results and that screenshot.

- [ ] **Step 7: Implement trial continuation.** For each accepted trial batch, execute all actions without screenshots, log and count them, wait once after the batch, and check backend completion before fixation. If incomplete, perform center fixation, capture the next trial screenshot, and call `reportActionResults` once with the ordered result list and that screenshot. Preserve timeout, provider-blocked, provider-finished, invalid-limit, step-limit, and cleanup precedence.

- [ ] **Step 8: Run the run-loop tests.**

  Run: `npm --prefix agent_harness exec vitest run tests/core/run-loop.test.ts`

  Expected: PASS, including the new setup/trial lifecycle and all existing terminal-state coverage.

- [ ] **Step 9: Commit the run-loop changes.**

  Run: `git add -- agent_harness/src/core/run-loop.ts agent_harness/tests/core/run-loop.test.ts && git commit -m "feat: run Gemini actions at trial boundaries"`

### Task 4: Expose deterministic mouse movement configuration and update CLI documentation

**Files:**

- Modify: `agent_harness/src/config/types.ts`
- Modify: `agent_harness/src/config/load-config.ts`
- Modify: `agent_harness/src/cli.ts`
- Modify: `agent_harness/src/browser/playwright-controller.ts`
- Modify: `agent_harness/README.md`
- Test: `agent_harness/tests/config/load-config.test.ts`
- Test: `agent_harness/tests/browser/playwright-controller.test.ts`
- Test: `agent_harness/tests/cli.test.ts`

**Interfaces:**

- Add `mouseMoveSteps: number` to `HarnessConfig`, parsed as an integer from `1` through `100`, default `1`.
- Pass `config.mouseMoveSteps` into `PlaywrightBrowserHost`.
- Keep `BrowserSession.move` pointer-only and use Playwright `{ steps: configuredValue }` for both model moves and center fixation.

- [ ] **Step 1: Write failing config and browser assertions.** Assert the parsed default is `mouseMoveSteps: 1`, custom values are accepted, zero and values above 100 are rejected, CLI construction forwards the value to the browser host, and the browser fixture sees `{ steps: 1 }` by default.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail.**

  Run: `npm --prefix agent_harness exec vitest run tests/config/load-config.test.ts tests/browser/playwright-controller.test.ts tests/cli.test.ts`

  Expected: FAIL because configuration and CLI forwarding do not yet expose the setting and Playwright defaults to 10 steps.

- [ ] **Step 3: Implement configuration and forwarding.** Parse the bounded top-level value, pass it from `runCli` to the host, and change the host fallback to `1` without changing viewport or device-scale behavior.

- [ ] **Step 4: Update the README.** Explain that one Gemini interaction returns a setup or trial batch, trial responses require at least nine moves plus a final click, the Start batch is exempt from that minimum, screenshots are captured only at batch boundaries, and `mouseMoveSteps` defaults to `1` with an optional JSON example.

- [ ] **Step 5: Run the focused tests.**

  Run: `npm --prefix agent_harness exec vitest run tests/config/load-config.test.ts tests/browser/playwright-controller.test.ts tests/cli.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit the configuration, controller, and documentation changes.**

  Run: `git add -- agent_harness/src/config/types.ts agent_harness/src/config/load-config.ts agent_harness/src/cli.ts agent_harness/src/browser/playwright-controller.ts agent_harness/README.md agent_harness/tests/config/load-config.test.ts agent_harness/tests/browser/playwright-controller.test.ts agent_harness/tests/cli.test.ts && git commit -m "feat: configure non-interpolated pointer movement"`

### Task 5: Migrate integration and no-cheating coverage to batch semantics

**Files:**

- Modify: `agent_harness/tests/integration/mock-run.test.ts`
- Modify: `agent_harness/tests/no-cheating/observation-boundary.test.ts`

**Interfaces:**

- Consume the plural provider interface and the completed run-loop lifecycle from Tasks 2–3.
- Keep canary values evaluator-side and assert they never occur in observations, Gemini requests, action-result arrays, backend events, or persisted logs.

- [ ] **Step 1: Update the deterministic integration agent.** Return a one-action Start batch from `next`, then one trial batch with nine move actions and a final click from the first continuation. Keep the fixture’s public pointer events and result endpoint assertion.

- [ ] **Step 2: Update the no-cheating Gemini transport fixture.** Make its first interaction a setup click and its second interaction a 10-action trial batch, preserving canary-free public screenshots. Update the recording wrapper to record `ActionResult[]` and assert one screenshot-bearing function result only on each continuation’s final result.

- [ ] **Step 3: Add batch-boundary assertions.** Assert provider requests contain the public instruction plus screenshots only, continuation result IDs stay ordered, no canary or structural Playwright value appears in any result, and evaluator-side private values remain visible only inside the fake evaluator.

- [ ] **Step 4: Run integration and no-cheating tests.**

  Run: `npm --prefix agent_harness test -- tests/no-cheating/observation-boundary.test.ts`

  Run: `npm --prefix agent_harness run test:integration`

  Expected: PASS; the integration test is enabled by its existing environment gate and remains skipped otherwise.

- [ ] **Step 5: Commit the boundary and integration test migration.**

  Run: `git add -- agent_harness/tests/integration/mock-run.test.ts agent_harness/tests/no-cheating/observation-boundary.test.ts && git commit -m "test: verify screenshot-only trial batches"`

### Task 6: Verify the complete harness and review the branch

**Files:**

- Verify: all modified files under `agent_harness/`
- Verify: `docs/superpowers/specs/2026-08-17-gemini-trial-action-batch-design.md`
- Verify: `docs/superpowers/plans/2026-08-17-gemini-trial-action-batch.md`

- [ ] **Step 1: Run the full unit suite.**

  Run: `npm --prefix agent_harness test`

  Expected: all unit tests pass; the paid live test remains skipped unless explicitly enabled.

- [ ] **Step 2: Run TypeScript validation.**

  Run: `npm --prefix agent_harness run typecheck`

  Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run the deterministic Playwright integration suite.**

  Run: `npm --prefix agent_harness run test:integration`

  Expected: the public fixture completes through setup, fixation, one trial batch, and the Firebase-style result endpoint without a paid model call.

- [ ] **Step 4: Run boundary and residue checks.**

  Run: `rg -n "reportActionResult\\b|exactly one action|screenshot after each|SECRET_ANSWER_CANARY|responseBody|requestBody|page\\.evaluate|page\\.locator|page\\.content" agent_harness/src agent_harness/tests`

  Expected: no stale singular interface or privileged model-facing access remains; canary references appear only in boundary-test fixtures/assertions.

- [ ] **Step 5: Inspect the final diff and ensure unrelated edits are untouched.**

  Run: `git diff --check && git status --short && git diff --stat`

  Expected: only the scoped harness/spec/plan changes are attributable to this feature; pre-existing user changes remain intact.

- [ ] **Step 6: Perform a whole-branch review against the spec.** Check specifically that Start is not padded, trial batches enforce the 10-action minimum, batches execute atomically with no intermediate screenshot, exactly one screenshot is sent per continuation, center fixation is controller-only, completion prevents another provider call, and no privileged Firebase information crosses the observation boundary.

