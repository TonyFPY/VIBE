# Trajectory Overlay Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python script that creates one overlaid trajectory PNG per recorded session and task.

**Architecture:** Keep plotting logic in `results/scripts/plot_trajectories.py`. The script will discover task directories and JSON sessions, group points by trial, plot centered coordinates in screen-space orientation, and write figures under `results/figure/<task>/`. Tests will exercise pure discovery/grouping/output behavior using temporary directories and a headless Matplotlib backend.

**Tech Stack:** Python 3.10+, Matplotlib, standard-library `argparse`, `json`, `pathlib`, and `pytest`.

## Global Constraints

- Preserve the existing trajectory JSON schema.
- Use `x_centered` and `y_centered` for viewport-independent plots.
- Write one figure per input session at `results/figure/<task>/trajectory_<session_id>.png`.
- Do not require paid services or browser access.
- Use the `tony` conda environment for verification.

---

### Task 1: Add failing tests for discovery, grouping, and figure output

**Files:**
- Create: `results/scripts/test_plot_trajectories.py`

**Interfaces:**
- Tests import `discover_sessions`, `group_trajectories`, and `plot_session` from `plot_trajectories.py`.

- [x] **Step 1: Write the failing tests**

Create temporary task directories containing two session JSON files. Assert that discovery returns both task/session pairs, grouping sorts points by `sampleIndex` within each trial and preserves trial order by first appearance, and `plot_session` writes the expected PNG under the task output directory.

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
conda run -n tony pytest results/scripts/test_plot_trajectories.py -q
```

Expected: collection or import failure because the plotting module does not exist yet.

### Task 2: Implement the plotting script

**Files:**
- Create: `results/scripts/plot_trajectories.py`

**Interfaces:**
- `discover_sessions(input_root: Path, task: str | None = None) -> list[tuple[str, Path]]`
- `group_trajectories(points: list[dict]) -> list[tuple[str, list[dict]]]`
- `plot_session(payload: dict, task: str, output_root: Path) -> Path | None`
- CLI: `python results/scripts/plot_trajectories.py [--input-root PATH] [--output-root PATH] [--task TASK]`

- [x] **Step 1: Implement JSON discovery and validation**

Discover `*.json` files one level below task directories, parse the payload, require a string session ID, and skip malformed/empty files with warnings. If `--task` is provided, restrict discovery to that task.

- [x] **Step 2: Implement deterministic trajectory grouping**

Group by `trialId`, sort points by numeric `sampleIndex` when present, and preserve trial ordering by the first point encountered. Use only points containing finite numeric `xCentered` and `yCentered` values.

- [x] **Step 3: Implement one overlay figure per session**

Create one Matplotlib axes, plot each trial as a semi-transparent line, add the origin marker, equal aspect, inverted y-axis, labels, title metadata, and a trial-order colorbar. Save as `trajectory_<session_id>.png` under `<output_root>/<task>/` and close the figure.

- [x] **Step 4: Implement the CLI**

Default to `results/trajectory` and `results/figure`, process all tasks, print each created path, and return a nonzero exit code only when the input root is missing or no usable sessions are found.

### Task 3: Verify the implementation and real outputs

**Files:**
- Modify: `results/scripts/plot_trajectories.py` only if verification exposes a defect.
- Create: `results/figure/<task>/trajectory_<session_id>.png` as generated analysis output.

- [x] **Step 1: Run focused tests**

```bash
conda run -n tony pytest results/scripts/test_plot_trajectories.py -q
```

- [x] **Step 2: Run the repository’s existing tests**

```bash
npm test
```

- [x] **Step 3: Generate figures from checked-in data**

```bash
conda run -n tony python results/scripts/plot_trajectories.py
```

- [x] **Step 4: Verify generated files**

Confirm there are four PNGs, one for each checked-in task/session pair, and that each file is non-empty.
