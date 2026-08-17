# Headed Browser Run Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional `--headed` CLI flag that shows Chromium during an agent run while preserving headless-by-default behavior.

**Architecture:** Parse `--headed` beside the existing required `--config` argument. Pass the resulting boolean into `PlaywrightBrowserHost`, whose launcher will use `headless: false` only for headed runs. No task, model, action, persistence, or website code changes are involved.

**Tech Stack:** TypeScript, Playwright, Vitest, npm scripts.

## Global Constraints

- Keep headless mode as the default for tests and CI.
- Keep the setting confined to browser launch.
- Preserve the screenshot-only model boundary and all existing run behavior.
- Do not make paid model calls in tests.
- Modify implementation code only under `agent_harness/`; update the harness README only.

---

### Task 1: Parse the headed CLI flag

**Files:**
- Modify: `agent_harness/src/cli.ts` (`CliArgs`, `parseCliArgs`, `runCli`)
- Test: `agent_harness/tests/cli.test.ts`

**Interfaces:**
- `parseCliArgs(args)` returns `{ configPath: string; headed: boolean }`.
- `runCli` passes `headless: !headed` to `PlaywrightBrowserHost`.

- [ ] **Step 1: Write failing parser tests**

Add assertions that the default is `{ configPath: "runs/dev.json", headed: false }`, that `--headed` returns `headed: true`, and that duplicate `--headed` and unknown arguments throw.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix agent_harness test -- --run tests/cli.test.ts`

Expected: FAIL because `parseCliArgs` currently rejects `--headed` and does not return `headed`.

- [ ] **Step 3: Implement strict flag parsing**

Initialize `headed = false`; accept `--headed` exactly once; continue accepting `--config <path>` exactly once; reject every other argument; return both fields. Destructure both fields in `runCli` and construct the host with `headless: !headed`.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm --prefix agent_harness test -- --run tests/cli.test.ts && npm --prefix agent_harness run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add agent_harness/src/cli.ts agent_harness/tests/cli.test.ts
git commit -m "feat: add headed browser CLI flag"
```

### Task 2: Make Playwright launch mode configurable

**Files:**
- Modify: `agent_harness/src/browser/browser-types.ts` (`BrowserLauncherPort`)
- Modify: `agent_harness/src/browser/playwright-controller.ts` (`PlaywrightBrowserHostOptions`, `browser`)
- Test: `agent_harness/tests/browser/playwright-controller.test.ts`

**Interfaces:**
- `BrowserLauncherPort.launch` accepts `{ headless: boolean }`.
- `PlaywrightBrowserHostOptions` accepts optional `headless?: boolean`, defaulting to `true`.

- [ ] **Step 1: Write failing launcher-mode tests**

Add one test that constructs the host without `headless` and expects the recorded launch event to be `{ headless: true }`, and another that passes `headless: false` and expects `{ headless: false }`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix agent_harness test -- --run tests/browser/playwright-controller.test.ts`

Expected: FAIL because the controller currently always launches with `{ headless: true }` and the launcher type only permits the literal `true`.

- [ ] **Step 3: Implement the minimal browser option**

Change the launcher type to `headless: boolean`; add `headless?: boolean` to host options; use `this.options.headless ?? true` when launching Chromium. Keep context viewport, JPEG screenshots, pointer actions, and cleanup unchanged.

- [ ] **Step 4: Run browser tests and typecheck**

Run: `npm --prefix agent_harness test -- --run tests/browser/playwright-controller.test.ts && npm --prefix agent_harness run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add agent_harness/src/browser/browser-types.ts agent_harness/src/browser/playwright-controller.ts agent_harness/tests/browser/playwright-controller.test.ts
git commit -m "feat: configure Playwright headed mode"
```

### Task 3: Document and verify the complete option

**Files:**
- Modify: `agent_harness/README.md` (Run section)
- Test: `agent_harness/tests/cli.test.ts` and `agent_harness/tests/browser/playwright-controller.test.ts` from Tasks 1–2

**Interfaces:**
- Operators use `--config <path>` for the existing headless run and append `--headed` to watch Chromium.

- [ ] **Step 1: Update the README**

Document both commands:

```bash
npm --prefix agent_harness start -- --config /absolute/path/to/run.json
npm --prefix agent_harness start -- --config /absolute/path/to/run.json --headed
```

State that headless is the default and headed mode requires a graphical display.

- [ ] **Step 2: Run the complete verification suite**

Run: `npm --prefix agent_harness test -- --run && npm --prefix agent_harness run typecheck`

Expected: all existing tests pass and TypeScript reports no errors; no live provider test is required.

- [ ] **Step 3: Commit documentation**

```bash
git add agent_harness/README.md
git commit -m "docs: document headed harness runs"
```
