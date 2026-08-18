# Firestore Results Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export Firestore experiment sessions into a chosen folder and generate a self-contained HTML viewer that compares human and agent responses and trajectories side by side.

**Architecture:** `export_firestore.mjs` uses the already-installed Firebase Admin SDK under `functions/` and Application Default Credentials to read `experimentSessions` and its `results`/`trajectories` subcollections. `build_results_viewer.mjs` validates the exported JSON snapshot and embeds it into an offline HTML document with filters, paired summaries, response comparisons, and trajectory SVGs. The website and Firestore rules remain unchanged.

**Tech Stack:** Node.js 22 ESM, Firebase Admin SDK, vanilla HTML/CSS/JavaScript, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-18-firestore-results-viewer-design.md`

## Global Constraints

- The browser viewer receives only an exported snapshot.
- The viewer never contains Firestore credentials, performs network reads, or depends on Firestore client rules.
- Export failures stop with a non-zero exit code and do not produce a misleading success manifest.
- The comparison uses shared scales and labels human and agent series directly; it does not infer correctness or invent missing values.
- Trajectory rendering uses raw points with start/end markers and no smoothing.
- Existing local response/trajectory files and `results/scripts/plot_trajectories.py` remain unchanged.
- Tests use local snapshot fixtures and never contact Firestore.

---

### Task 1: Snapshot normalization and Firestore exporter

**Files:**
- Create: `results/scripts/export_firestore.mjs`
- Create: `results/scripts/export_firestore.test.mjs`
- Create: `results/scripts/fixtures/firestore-session.json`

**Interfaces:**
- `parseArgs(argv)` returns `{ project, database, output, sessions, task }` and rejects unknown/missing options.
- `toJsonSafe(value)` converts Firestore Timestamp, DocumentReference, GeoPoint, bytes, arrays, and plain objects to JSON-safe values.
- `flattenFirestoreSession(sessionId, sessionData, resultDocs, trajectoryDocs)` returns `{ session, results, trajectories }` with `sessionId` attached to every child record.
- `writeSnapshot(snapshot, outputDir)` writes `manifest.json`, `sessions.json`, `responses.json`, and `trajectories.json` atomically through temporary files.

- [ ] **Step 1: Write failing unit tests**

Test argument parsing, recursive timestamp/reference normalization, flattening of a fixture session, task/session filtering, and rejection of a malformed output directory argument. Assert that the snapshot contains no credentials or document-reference objects.

- [ ] **Step 2: Run the exporter tests and verify they fail**

Run: `node --test results/scripts/export_firestore.test.mjs`

Expected: FAIL because the exporter module and normalization functions do not exist.

- [ ] **Step 3: Implement the pure exporter helpers**

Implement strict CLI parsing, `toJsonSafe`, flattening, and deterministic snapshot writing. Use ISO timestamps, preserve raw response/trajectory fields, and add a manifest with `schemaVersion`, `exportedAt`, `project`, `database`, and record counts.

- [ ] **Step 4: Implement the credentialed Firestore read path**

Load Firebase Admin from `functions/node_modules/firebase-admin`, initialize with `applicationDefault()` and the requested project, read `experimentSessions`, then read each selected document’s `results` and `trajectories` subcollections. Apply `--session` before subcollection reads and `--task` to response records; include a session when it has a matching response. Do not log credential values.

- [ ] **Step 5: Run exporter tests and a help smoke test**

Run:

```bash
node --test results/scripts/export_firestore.test.mjs
node results/scripts/export_firestore.mjs --help
```

Expected: all fixture tests pass and help exits successfully without initializing Firestore.

- [ ] **Step 6: Commit**

```bash
git add -- results/scripts/export_firestore.mjs results/scripts/export_firestore.test.mjs results/scripts/fixtures/firestore-session.json
git commit -m "feat: add Firestore results exporter"
```

### Task 2: Offline human-agent comparison viewer

**Files:**
- Create: `results/scripts/build_results_viewer.mjs`
- Create: `results/scripts/build_results_viewer.test.mjs`
- Create: `results/scripts/fixtures/viewer-snapshot/manifest.json`
- Create: `results/scripts/fixtures/viewer-snapshot/sessions.json`
- Create: `results/scripts/fixtures/viewer-snapshot/responses.json`
- Create: `results/scripts/fixtures/viewer-snapshot/trajectories.json`

**Interfaces:**
- `loadSnapshot(inputDir)` returns validated `{ manifest, sessions, responses, trajectories }`.
- `pairSessions(snapshot, task)` returns human/agent session candidates without dropping unpaired records.
- `buildViewerHtml(snapshot)` returns a complete standalone HTML string with JSON embedded in a non-executable data script.
- `writeViewer(inputDir, outputPath)` creates parent directories and writes the HTML.

- [ ] **Step 1: Write failing viewer tests**

Test valid snapshot loading, malformed snapshot rejection, human/agent pairing by task, retention of an unpaired session, embedded dataset escaping, and generated HTML presence of filter controls, side-by-side panels, response comparison, and trajectory rendering hooks.

- [ ] **Step 2: Run viewer tests and verify they fail**

Run: `node --test results/scripts/build_results_viewer.test.mjs`

Expected: FAIL because the viewer module does not exist.

- [ ] **Step 3: Implement snapshot validation and pairing**

Validate that all four JSON files contain the expected arrays/object, attach child records to sessions by `sessionId`, group by task, and expose missing human/agent sides as `Unpaired` rather than synthesizing data.

- [ ] **Step 4: Implement the self-contained HTML**

Generate responsive vanilla HTML with:

- task, run mode, participant type, model, session, and trial controls;
- paired human/agent metadata and accuracy/reaction-time summaries;
- shared-scale response coordinate plot;
- raw trajectory SVG paths with start/end markers and no smoothing;
- trial detail table showing raw human and agent values and missing sides.

Embed data using `<script type="application/json" id="results-data">` with `<` escaped so record content cannot terminate the script element. Use no `fetch`, XHR, WebSocket, or external CDN dependency.

- [ ] **Step 5: Run viewer tests and generate a fixture HTML**

Run:

```bash
node --test results/scripts/build_results_viewer.test.mjs
node results/scripts/build_results_viewer.mjs \
  --input results/scripts/fixtures/viewer-snapshot \
  --output /tmp/experiment-results.html
```

Expected: tests pass and the generated file is non-empty, self-contained, and contains the fixture session IDs.

- [ ] **Step 6: Commit**

```bash
git add -- results/scripts/build_results_viewer.mjs results/scripts/build_results_viewer.test.mjs results/scripts/fixtures/viewer-snapshot
git commit -m "feat: add offline human-agent results viewer"
```

### Task 3: Documentation and full verification

**Files:**
- Modify: `results/README.md`
- Test: `results/scripts/export_firestore.test.mjs`, `results/scripts/build_results_viewer.test.mjs`

**Interfaces:**
- Operators run the exporter with a chosen output folder, then build and open the generated HTML.

- [ ] **Step 1: Document credentials and commands**

Document Application Default Credentials, `GOOGLE_APPLICATION_CREDENTIALS` as an alternative, the `(default)` database default, the export folder layout, and the viewer commands. State that the generated HTML is offline and contains no credentials.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
node --test results/scripts/export_firestore.test.mjs results/scripts/build_results_viewer.test.mjs
npm test -- --run
npm --prefix agent_harness test -- --run
npm --prefix agent_harness run typecheck
```

Expected: all relevant fixture, website, and harness tests pass; no Firestore or paid-model call is made.

- [ ] **Step 3: Commit documentation**

```bash
git add -- results/README.md
git commit -m "docs: document Firestore export and viewer"
```
