# Trajectory Overlay Visualization

## Goal

Add a reproducible analysis script that visualizes all recorded pointer
trajectories overlaid for each participant/run and task.

## Inputs

The script reads trajectory JSON files from:

```text
results/trajectory/<task>/*.json
```

Each file contains session metadata and a flat `trajectories` array with
normalized and centered coordinates. The existing trajectory schema is kept
unchanged.

## Outputs

For every input session, write one PNG figure:

```text
results/figure/<task>/trajectory_<session_id>.png
```

The output directory is created when absent. Session IDs are treated as
filesystem names because they are already generated using the repository's
filesystem-safe convention.

## Figure design

- Overlay one path per trial in a single axes.
- Use `x_centered` and `y_centered` for viewport-independent comparison.
- Preserve screen geometry with equal x/y aspect ratio.
- Invert the y-axis so the plot follows browser screen coordinates.
- Mark the fixation origin at `(0, 0)`.
- Color paths by trial order and include a compact trial-order colorbar.
- Include task, observer type, and session ID in the title.
- Skip empty trajectories with a clear warning rather than producing a
  misleading empty plot.

## Command-line interface

Run from the repository root:

```bash
python results/scripts/plot_trajectories.py
```

Optional arguments select alternate input/output roots and one task. By
default, all task directories beneath `results/trajectory/` are processed.

## Verification

Tests will cover trajectory grouping/order, centered-coordinate plotting input,
filesystem-safe output naming, and processing multiple tasks. The test suite
will use a non-interactive plotting backend and temporary directories.
