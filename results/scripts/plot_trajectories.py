#!/usr/bin/env python3
"""Create one overlaid pointer-trajectory figure per recorded session."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import warnings
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import seaborn as sns


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.warn(f"Skipping {path}: could not read JSON ({exc})")
        return None
    if not isinstance(payload, dict):
        warnings.warn(f"Skipping {path}: payload is not an object")
        return None
    session = payload.get("session")
    session_id = session.get("sessionId") if isinstance(session, dict) else None
    if not isinstance(session_id, str) or not session_id:
        warnings.warn(f"Skipping {path}: missing session.sessionId")
        return None
    return payload


def discover_sessions(
    input_root: Path, task: str | None = None
) -> list[tuple[str, Path]]:
    """Return valid ``(task, json_path)`` pairs in deterministic order."""
    if not input_root.is_dir():
        return []
    task_dirs = [input_root / task] if task else sorted(p for p in input_root.iterdir() if p.is_dir())
    sessions: list[tuple[str, Path]] = []
    for task_dir in task_dirs:
        if not task_dir.is_dir():
            continue
        for path in sorted(task_dir.glob("*.json")):
            if _read_json(path) is not None:
                sessions.append((task_dir.name, path))
    return sessions


def _sample_index(point: dict[str, Any]) -> float:
    value = point.get("sampleIndex", 0)
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.inf


def _has_centered_coordinates(point: dict[str, Any]) -> bool:
    try:
        x = float(point["xCentered"])
        y = float(point["yCentered"])
    except (KeyError, TypeError, ValueError):
        return False
    return math.isfinite(x) and math.isfinite(y)


def group_trajectories(
    points: list[dict[str, Any]],
) -> list[tuple[str, list[dict[str, Any]]]]:
    """Group valid points by trial, preserving trial and sample order."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    trial_order: list[str] = []
    for point in points:
        trial_id = point.get("trialId")
        if not isinstance(trial_id, str) or not _has_centered_coordinates(point):
            continue
        if trial_id not in grouped:
            grouped[trial_id] = []
            trial_order.append(trial_id)
        grouped[trial_id].append(point)
    return [
        (trial_id, sorted(grouped[trial_id], key=_sample_index))
        for trial_id in trial_order
    ]


def _safe_filename(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return safe or "session"


def plot_session(payload: dict[str, Any], task: str, output_root: Path) -> Path | None:
    """Write an overlay PNG for one session, returning its path."""
    session = payload.get("session", {})
    session_id = session.get("sessionId") if isinstance(session, dict) else None
    if not isinstance(session_id, str) or not session_id:
        warnings.warn("Skipping payload with no session ID")
        return None
    points = payload.get("trajectories", [])
    groups = group_trajectories(points if isinstance(points, list) else [])
    if not groups:
        warnings.warn(f"Skipping {session_id}: no usable trajectory points")
        return None

    sns.set_theme(style="whitegrid", context="notebook")
    fig, ax = plt.subplots(figsize=(8.6, 6.4), constrained_layout=True)
    cmap = sns.color_palette("crest", as_cmap=True)
    color_values = range(len(groups))
    for index, (trial_id, trial_points) in enumerate(groups):
        x_values = [float(point["xCentered"]) for point in trial_points]
        y_values = [float(point["yCentered"]) for point in trial_points]
        color = cmap(index / max(len(groups) - 1, 1))
        ax.plot(x_values, y_values, color=color, alpha=0.66, linewidth=1.5)
        ax.scatter(x_values[0], y_values[0], color=color, s=18, alpha=0.9, edgecolor="white", linewidth=0.4)
        ax.scatter(x_values[-1], y_values[-1], color=color, s=30, marker="X", alpha=0.95, edgecolor="white", linewidth=0.4)

    ax.axhline(0, color="#9aa89f", linewidth=0.8, alpha=0.7, zorder=0)
    ax.axvline(0, color="#9aa89f", linewidth=0.8, alpha=0.7, zorder=0)
    ax.scatter([0], [0], color="#26352d", marker="+", s=62, linewidths=1.4, zorder=4)
    ax.set_aspect("equal", adjustable="datalim")
    ax.invert_yaxis()
    ax.set_xlabel("Centered x", labelpad=8)
    ax.set_ylabel("Centered y", labelpad=8)
    observer = session.get("observerType", "unknown") if isinstance(session, dict) else "unknown"
    pretty_task = task.replace("_", " ").title()
    ax.set_title(f"{pretty_task} · {str(observer).title()}", loc="left", pad=14, fontsize=16, fontweight="bold", color="#26352d")
    ax.text(1.0, 1.02, f"{len(groups)} trials", transform=ax.transAxes, ha="right", va="bottom", fontsize=10, color="#65756b")
    ax.grid(color="#dce5de", linewidth=0.8, alpha=0.8)
    sns.despine(ax=ax, offset=6, trim=True)

    output_path = output_root / task / f"trajectory_{_safe_filename(session_id)}.png"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=160)
    plt.close(fig)
    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, default=Path("results/trajectory"))
    parser.add_argument("--output-root", type=Path, default=Path("results/figure"))
    parser.add_argument("--task", help="Process only this task directory")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.input_root.is_dir():
        print(f"Input directory does not exist: {args.input_root}", file=sys.stderr)
        return 2

    created = 0
    for task, path in discover_sessions(args.input_root, args.task):
        payload = _read_json(path)
        if payload is None:
            continue
        output = plot_session(payload, task, args.output_root)
        if output is not None:
            created += 1
            print(output)
    if created == 0:
        print("No usable trajectory sessions found.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
