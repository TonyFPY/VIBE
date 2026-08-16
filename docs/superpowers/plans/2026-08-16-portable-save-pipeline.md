# Portable Save Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the shared experiment completion flow use an optional HTTP API with bounded, memory-safe retries and a visible animated save state, falling back to manual downloads when no API is configured or saving fails.

**Architecture:** Keep `SessionPayload` and the existing idempotent POST contract. Move request policy into a small persistence helper that can skip unconfigured endpoints, time out, retry with bounded backoff, and preserve the payload. Keep completion-state DOM rendering in the shared app, with CSS animation and reduced-motion support; do not add Firebase or provider SDK code.

**Tech Stack:** TypeScript, Vite, jsdom, Vitest, browser `fetch`, CSS.

## Global Constraints

- `VITE_RESULTS_ENDPOINT` is optional for full runs; development runs default to `/api/experiments/sessions`.
- A save is successful only after an HTTP 2xx response.
- Retries reuse the same payload and `Idempotency-Key`.
- Recovery is cleared only after confirmed success.
- Do not retain attempt histories, screenshots, response bodies, or duplicate payload copies.
- Manual downloads always contain the current `results` and `trajectories` data.
- No Firebase SDK, Firestore credentials, or provider-specific browser code.
- Human and agent task renderers continue to share the same persistence path.

---

### Task 1: Add provider-neutral save policy

**Files:**
- Modify: `tasks/shared/experiment/persistence.ts`
- Test: `tasks/shared/experiment/persistence.test.ts`

**Interfaces:**
- Produce `SaveAttemptError` with `kind: "timeout" | "network" | "http"` and optional `status`.
- Produce `submitSession(payload, options?)` where `options` supports `endpoint`, `fetchImpl`, `timeoutMs`, `maxAttempts`, `sleep`, and `onAttempt(attempt, maxAttempts)` for deterministic tests and UI progress.
- Preserve `resultsEndpoint(environment)` and the existing request headers/body contract.

- [ ] **Step 1: Write failing tests for endpoint gating and success**

Add tests that call `submitSession` with injected `fetchImpl` and assert that an empty endpoint makes zero requests, while a 201 response sends one JSON body with `Idempotency-Key` equal to the session ID.

- [ ] **Step 2: Write failing tests for timeout, bounded retry, and stable payload**

Use a rejecting or never-resolving mock fetch, a no-op `sleep`, and `maxAttempts: 3`. Assert three calls, identical serialized request bodies, identical idempotency headers, and a typed error after exhaustion.

- [ ] **Step 3: Implement the minimal request policy**

Add a default timeout of 10 seconds, default attempts of 3, and exponential delays of 500 ms then 1,000 ms. Use `AbortController` per attempt, call `fetchImpl` with the same serialized payload, return immediately for 2xx, classify failures, and throw the last typed error after the bound.

- [ ] **Step 4: Run persistence tests**

Run `npm test -- tasks/shared/experiment/persistence.test.ts` and expect all endpoint, request-contract, timeout, and retry tests to pass.

- [ ] **Step 5: Commit the persistence helper**

```sh
git add tasks/shared/experiment/persistence.ts tasks/shared/experiment/persistence.test.ts
git commit -m "feat: add bounded optional session submission"
```

### Task 2: Add completion save-state rendering

**Files:**
- Create: `tasks/shared/app/save-status.ts`
- Create: `tasks/shared/app/save-status.test.ts`

**Interfaces:**
- Produce `renderSaveState(root, state)` for `state` values `saving`, `saved`, `manual`, and `failed`.
- `saving` accepts `attempt` and `maxAttempts`; `manual` and `failed` accept a message and render download button IDs `download-results` and `download-trajectories`.

- [ ] **Step 1: Write failing jsdom tests for each state**

Assert that saving includes a busy status and attempt text, saved includes a success marker, and manual/failed include explanatory text plus both download buttons. Assert download buttons are absent during saving.

- [ ] **Step 2: Implement focused state renderer**

Replace `root.innerHTML` through one escaped, static template per state. Set `role="status"`/`aria-live="polite"` for saving and `role="alert"` for manual/failed. Do not include payload data in the status markup.

- [ ] **Step 3: Run save-state tests**

Run `npm test -- tasks/shared/app/save-status.test.ts` and expect all state assertions to pass.

- [ ] **Step 4: Commit the renderer**

```sh
git add tasks/shared/app/save-status.ts tasks/shared/app/save-status.test.ts
git commit -m "feat: add accessible save status states"
```

### Task 3: Integrate save policy and UI into the shared app

**Files:**
- Modify: `tasks/shared/app/main.ts`
- Modify: `tasks/shared/app/styles.css`
- Create: `tasks/shared/app/save-flow.ts`
- Test: `tasks/shared/app/save-flow.test.ts`

**Interfaces:**
- Consume `submitSession`, `resultsEndpoint`, `SaveAttemptError`, and `renderSaveState`.
- Preserve existing completion download IDs and the `window.close()` behavior after confirmed success.

- [ ] **Step 1: Write an integration test for finish behavior**

Cover unconfigured endpoint (manual state without fetch), successful API save (recovery cleared and saved state), and failed API save (recovery retained and both download handlers available). Use mocked timers/fetch and keep the test independent of task datasets.

- [ ] **Step 2: Refactor `finish()` to use explicit states**

Checkpoint once before saving. If `resultsEndpoint()` is blank, render manual state and wire downloads. Otherwise render saving, pass `onAttempt` to `submitSession`, render saved only after success and then clear recovery, or render failed after bounded retry exhaustion. Keep the payload object shared and avoid cloning it per attempt.

- [ ] **Step 3: Add visual save effects**

Add a centered save panel, animated spinner/checkmark, progress text, and button styling. Add `@media (prefers-reduced-motion: reduce)` to disable transitions/rotation while preserving visible status.

- [ ] **Step 4: Run app and full test suites**

Run `npm test` and `npm run build`. Expect TypeScript compilation, existing task tests, persistence tests, and save-state/integration tests to pass.

- [ ] **Step 5: Commit the integrated behavior**

```sh
git add tasks/shared/app/main.ts tasks/shared/app/styles.css tasks/shared/app/launch.test.ts
git commit -m "feat: add resilient save feedback and fallback"
```

### Task 4: Document provider-neutral deployment behavior

**Files:**
- Modify: `docs/deployment.md`
- Modify: `README.md` only where the save behavior is described

- [ ] **Step 1: Update deployment documentation**

Document that unset `VITE_RESULTS_ENDPOINT` intentionally skips the API and shows downloads, while configured endpoints use the idempotent POST and retain local recovery on failure. State that Firestore or another provider is implemented behind the API contract.

- [ ] **Step 2: Verify documentation and repository safety**

Run `git diff --check` and search changed files for Firebase credentials, `apiKey`, or Firestore SDK imports. Expect no matches.

- [ ] **Step 3: Commit documentation**

```sh
git add docs/deployment.md README.md
git commit -m "docs: describe optional API save fallback"
```

### Task 5: Final verification

**Files:**
- Verify all changed files and test outputs.

- [ ] **Step 1: Run the complete verification commands**

```sh
npm test
npm run build
git diff --check
git status --short
```

- [ ] **Step 2: Confirm acceptance criteria**

Verify manually from the implementation that no endpoint performs no fetch and exposes downloads, a successful API response clears recovery, failures retain recovery, retries are bounded, and the save animation respects reduced-motion preferences.
