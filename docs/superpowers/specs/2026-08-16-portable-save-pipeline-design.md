# Portable Save Pipeline and Feedback Design

## Goal

Refine the shared experiment save path so either task can save a completed
human or agent session through an optional HTTP API, while preserving a clear
manual-download fallback when automatic saving is unavailable. Firestore is a
possible server-side adapter, not a browser dependency or a required runtime.

## Scope

This change applies only to the shared browser persistence and completion UI
under `tasks/shared`. It preserves the existing one-payload HTTP contract,
session identity, local-recovery behavior, response schema, and task renderers.
It does not add a Firebase SDK, Cloud Function, Firestore rules, credentials,
or Firestore-specific code to the browser bundle.

## Architecture

The browser keeps one compact `SessionPayload` consisting of session metadata,
testing results, and compact testing trajectories. It checkpoints this payload
in session-namespaced browser recovery storage after each recorded trial.

At completion, the browser uses a configured results endpoint:

```text
recorded trial → recovery checkpoint
completion → saving state → optional POST to configured API
                              ├─ success → remove recovery → saved state
                              └─ unavailable/failure → retain recovery → downloads
```

`VITE_RESULTS_ENDPOINT` is the explicit API configuration for full runs. A
development run automatically uses the same-origin
`/api/experiments/sessions` endpoint so local smoke tests exercise saving
without extra configuration. For full runs, when the variable is absent or
blank, the browser makes no request and proceeds directly to the manual save
state. When an endpoint is selected, the browser sends the existing JSON payload with
`Content-Type: application/json` and `Idempotency-Key: <session_id>`.

An API is considered connected only after a successful HTTP response. A
future Firestore adapter may validate this payload and write documents keyed
by the session ID. A different storage provider must implement the same HTTP
contract; neither option changes task code or browser data format.

## Save State UI

The completion experience is modeled as explicit states:

- `saving`: display an accessible busy indicator, a visible animation, and
  attempt progress such as “Saving results (attempt 2 of 3).” Manual downloads
  are not shown while a request is active.
- `saved`: show an accessible success state with a check animation. Clear
  recovery only after this point, then retain the existing short automatic
  window-close attempt.
- `manual`: show a warning and the existing separate result and trajectory
  download actions. Recovery remains intact. This state is used immediately
  when no endpoint is configured.
- `failed`: show the same recovery/download actions with a concise explanation
  that automatic saving did not complete. Recovery remains intact. This state
  is used after configured-endpoint retries are exhausted.

The state content remains visible to screenshot-only agents and is semantic
for human assistive technologies. Status effects are CSS-only; they must honor
`prefers-reduced-motion`.

## Reliability and Memory

Each request has a finite timeout. Configured endpoints receive a bounded
number of attempts with exponential backoff. Every retry uses the unchanged
payload and session ID, so a compliant backend can safely deduplicate it.

The client stores no separate copy for request attempts and does not retain
attempt histories, response bodies, screenshots, or additional trajectory
caches. The only durable browser copy is the existing recovery payload, which
is removed only after confirmed success. Results and trajectories continue to
be downloaded separately to preserve existing analysis layout.

## API Adapter Contract

Adapters accept:

```text
POST <results endpoint>
Content-Type: application/json
Idempotency-Key: <session_id>
body: SessionPayload
```

They must validate the payload, enforce request-size and authorization limits,
and implement idempotency using the session ID. A Firestore adapter may store
a session document plus bounded result/trajectory subdocuments or blobs, but
that storage shape is outside the browser contract. Providers must not expose
credentials in `VITE_*` browser configuration.

## Testing

Shared persistence and completion-state tests will verify:

- no configured endpoint skips network submission and enters manual save;
- a successful configured submission clears recovery and enters saved state;
- timeouts, network failures, and non-success responses retry within bounds,
  retain recovery, and enter failed/manual save;
- repeated submission uses the same `Idempotency-Key` and payload;
- UI states expose the expected status text and download actions;
- the browser build contains no Firebase SDK, Firebase configuration, service
  credentials, or Firestore-specific browser logic.

Existing local Vite result persistence remains available by configuring the
same-origin development endpoint. Existing tasks continue to share the same
payload, API path, local recovery, and fallback downloads.
