# Headed Browser Run Option

## Goal

Allow an operator to watch Chromium while running the existing agent harness,
without changing the default headless behavior used by tests and CI.

## Design

The CLI accepts an optional `--headed` flag alongside the required `--config`
path:

```text
npm --prefix agent_harness start -- --config /absolute/run.json --headed
```

Without `--headed`, Chromium is launched with `headless: true`, preserving the
current behavior. With the flag, the CLI passes `headless: false` to the
Playwright browser host.

The setting is confined to browser launch. It does not alter the task URL,
model prompt, screenshot-only information boundary, action policy, logging,
result persistence, or website code.

## Validation and errors

CLI parsing remains strict: `--config` is required exactly once, `--headed`
may appear at most once, and unknown arguments fail before a browser starts.
If a headed run is started in an environment without a graphical display, the
existing Playwright launch error is surfaced to the operator.

## Tests and documentation

Add parser tests for the default and headed forms, plus a browser-controller
test that verifies the launcher receives the requested headless value. Update
the agent harness README with both invocation forms. No paid model call is
needed for these tests.
