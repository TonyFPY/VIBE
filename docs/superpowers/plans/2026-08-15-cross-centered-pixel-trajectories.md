# Compact Cross-Centered Trajectories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat cursor samples with compact, sampled, cross-centered pixel traces per testing trial.

**Architecture:** The shared experiment schema supplies a `TrialTrajectory` with a trial ID and integer tuples `[elapsedMs, xPx, yPx]`. Each renderer retains start and response tuples and applies a 16 ms / 2 px intermediate-sample gate. The plot script groups the nested records and consumes their tuples directly.

**Tech Stack:** TypeScript, Vitest, jsPsych, Python, pytest, Matplotlib, Seaborn.

## Global Constraints

- `SessionPayload.trajectories` is `TrialTrajectory[]`, not a flat point array.
- A tuple is `[elapsedMs, xPx, yPx]` in integer CSS pixels relative to the cross click.
- The start tuple is `[0, 0, 0]`; the response tuple is always retained.
- Intermediate samples require at least 16 ms and 2 px Euclidean displacement from the last stored tuple.
- No normalized or absolute per-point coordinates are saved.
- Only testing trials create trajectory records.

---

### Task 1: Define compact data and sampling helpers

**Files:**
- Modify: `tasks/shared/experiment/types.ts`
- Modify: `tasks/shared/experiment/geometry.ts`
- Modify: `tasks/visual_similarity/task.ts`
- Modify: `tasks/visual_similarity/tests/task.test.ts`

**Interfaces:**
- Produces: `TrialTrajectory { trialId: string; points: Array<[number, number, number]> }`.
- Produces: `pointerTupleAtCross(point, crossClick, elapsedMs): [number, number, number]`.
- Produces: `shouldSamplePointer(previous, next): boolean`.

- [ ] **Step 1: Write failing helper tests**

```ts
expect(pointerTupleAtCross({ x: 600.4, y: 300.4 }, { x: 540, y: 338 }, 16.8))
  .toEqual([17, 60, -38]);
expect(shouldSamplePointer([0, 0, 0], [16, 1, 1])).toBe(false);
expect(shouldSamplePointer([0, 0, 0], [16, 2, 0])).toBe(true);
```

- [ ] **Step 2: Run to verify red**

Run: `npm test -- tasks/visual_similarity/tests/task.test.ts`

Expected: FAIL because compact helpers do not exist.

- [ ] **Step 3: Implement the minimal contract**

```ts
export type PointerTuple = [elapsedMs: number, xPx: number, yPx: number];
export const pointerTupleAtCross = (...) => [Math.round(elapsedMs), ...];
export const shouldSamplePointer = (previous, next) =>
  next[0] - previous[0] >= 16 && Math.hypot(next[1] - previous[1], next[2] - previous[2]) >= 2;
```

- [ ] **Step 4: Run focused helper test to verify green**

Run: `npm test -- tasks/visual_similarity/tests/task.test.ts`

Expected: PASS.

### Task 2: Save compact trajectories from both tasks

**Files:**
- Modify: `tasks/visual_similarity/renderer.ts`
- Modify: `tasks/object_matching/renderer.ts`
- Modify: `tasks/visual_similarity/tests/task.test.ts`
- Modify: `tasks/object_matching/tests/task.test.ts`
- Modify: `tasks/shared/experiment/local-results.test.ts`

**Interfaces:**
- Consumes: `PointerTuple`, `pointerTupleAtCross`, and `shouldSamplePointer`.
- Produces: a one-element `TrialTrajectory[]` for each testing trial; training returns an empty list.

- [ ] **Step 1: Write failing nested-trajectory assertions**

```ts
expect(recorded).toEqual([{ trialId: trial.id, points: [[0, 0, 0], [0, 260, 0]] }]);
```

Use a 1 px pointer move to prove it is dropped; preserve the option click as the final tuple even at elapsed 0 in unit-test timing.

- [ ] **Step 2: Run renderer tests to verify red**

Run: `npm test -- tasks/visual_similarity/tests/task.test.ts tasks/object_matching/tests/task.test.ts`

Expected: FAIL because renderers return flat samples.

- [ ] **Step 3: Implement compact collection**

Create `[0, 0, 0]` at the cross, gate intermediate pointer tuples with `shouldSamplePointer`, append the response tuple without gating, and pass either `[{ trialId, points }]` or `[]` to `onComplete`.

- [ ] **Step 4: Update persistence fixture and verify green**

```ts
trajectories: [{ trialId: "4", points: [[0, 0, 0]] }]
```

Run: `npm test -- tasks/visual_similarity/tests/task.test.ts tasks/object_matching/tests/task.test.ts tasks/shared/experiment/local-results.test.ts`

Expected: PASS.

### Task 3: Plot and document compact traces

**Files:**
- Modify: `results/scripts/plot_trajectories.py`
- Modify: `results/scripts/test_plot_trajectories.py`
- Modify: `docs/agent_cursor_tracing.md`

**Interfaces:**
- Consumes: `{"trialId": str, "points": [[elapsedMs, xPx, yPx], ...]}`.
- Produces: cross-centered pixel-space PNG overlays.

- [ ] **Step 1: Write failing nested Python fixtures**

```python
"trajectories": [{"trialId": "1", "points": [[0, 0, 0], [16, 120, -40]]}]
```

- [ ] **Step 2: Run to verify red**

Run: `python -m pytest results/scripts/test_plot_trajectories.py -q`

Expected: FAIL because the script expects flat points.

- [ ] **Step 3: Implement nested tuple parsing and docs**

Accept only finite numeric triples, draw `xPx`/`yPx`, and change the documentation to state the compact tuple format and sampling rule.

- [ ] **Step 4: Run test to verify green**

Run: `python -m pytest results/scripts/test_plot_trajectories.py -q`

Expected: PASS.

### Task 4: Full regression verification

- [ ] **Step 1: Run all TypeScript tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Build production assets**

Run: `npm run build`

Expected: PASS.
