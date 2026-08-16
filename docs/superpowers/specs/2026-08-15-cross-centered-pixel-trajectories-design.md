# Cross-Centered Pixel Trajectories

## Goal

Store each testing-trial cursor trajectory as a compact sequence of raw CSS
pixel offsets from the center-cross click. New trajectory records must not
contain viewport, normalized, trial-area-relative, or repeated per-point
metadata.

## Data contract

The session payload stores one trajectory record for each testing trial:

```ts
interface TrialTrajectory {
  trialId: string;
  points: Array<[elapsedMs: number, xPx: number, yPx: number]>;
}
```

For a cross click at `(crossClickX, crossClickY)`, a subsequent pointer event
at `(clientX, clientY)` becomes the integer tuple:

```text
[round(performance.now() - crossClickedAt), round(clientX - crossClickX), round(clientY - crossClickY)]
```

The first tuple is always `[0, 0, 0]`. Positive x is rightward and positive y
is downward, matching browser screen coordinates. The corresponding trial
result retains `crossClickedAt`, so individual points do not need absolute
timestamps.

## Sampling

Record testing trials only, beginning at the center-cross click and ending at
the first option click. Preserve the first and final tuples unconditionally.
For intermediate `pointermove` events, retain a point only when both at least
16 ms have elapsed and the Euclidean distance from the prior saved point is at
least 2 CSS pixels. This caps the stored path at roughly 60 Hz and drops
sub-pixel or one-pixel jitter without interpolating any movement.

## Scope

- Replace the flat `TrajectoryPoint[]` schema with `TrialTrajectory[]`.
- Use the shared calculation and sampling rule in both task renderers for
  start, move, and response tuples.
- Update renderer and geometry tests to assert compact pixel tuples and the
  absence of normalized fields.
- Update `results/scripts/plot_trajectories.py` and its tests to consume the
  nested tuple format, draw the origin at the cross, and label axes in pixels.
- Update trajectory documentation.

## Compatibility

This is a deliberate schema migration. Newly saved sessions and the plotting
script use only `TrialTrajectory.points`; legacy flat JSON trajectories are
not supported by the updated plotting script.

## Verification

Tests will cover the shared coordinate calculation, each task's start/move/end
trajectory, and plotting of pixel-coordinate data. The focused tests, full
test suite, and production build will run before completion.
