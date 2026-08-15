import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

from plot_trajectories import (
    discover_sessions,
    group_trajectories,
    plot_session,
)


def _write_session(path: Path, session_id: str) -> None:
    payload = {
        "session": {"sessionId": session_id, "observerType": "human"},
        "trajectories": [
            {"trialId": "b", "sampleIndex": 1, "xCentered": 0.2, "yCentered": 0.3},
            {"trialId": "a", "sampleIndex": 1, "xCentered": -0.2, "yCentered": 0.1},
            {"trialId": "b", "sampleIndex": 0, "xCentered": 0.1, "yCentered": 0.2},
            {"trialId": "a", "sampleIndex": 0, "xCentered": -0.1, "yCentered": 0.0},
        ],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_discover_sessions_finds_all_task_session_pairs(tmp_path: Path) -> None:
    trajectory_root = tmp_path / "trajectory"
    _write_session(trajectory_root / "visual_similarity" / "one.json", "session-one")
    _write_session(trajectory_root / "object_matching" / "two.json", "session-two")

    assert discover_sessions(trajectory_root) == [
        ("object_matching", trajectory_root / "object_matching" / "two.json"),
        ("visual_similarity", trajectory_root / "visual_similarity" / "one.json"),
    ]


def test_group_trajectories_orders_trials_by_first_seen_and_points_by_sample() -> None:
    points = [
        {"trialId": "second", "sampleIndex": 1},
        {"trialId": "first", "sampleIndex": 1},
        {"trialId": "second", "sampleIndex": 0},
        {"trialId": "first", "sampleIndex": 0},
    ]

    groups = group_trajectories(points)

    assert [trial_id for trial_id, _ in groups] == ["second", "first"]
    assert [point["sampleIndex"] for point in groups[0][1]] == [0, 1]
    assert [point["sampleIndex"] for point in groups[1][1]] == [0, 1]


def test_plot_session_writes_one_overlay_png(tmp_path: Path) -> None:
    payload = {
        "session": {"sessionId": "session/unsafe?", "observerType": "agent"},
        "trajectories": [
            {"trialId": "1", "sampleIndex": 0, "xCentered": 0.0, "yCentered": 0.0},
            {"trialId": "1", "sampleIndex": 1, "xCentered": 0.2, "yCentered": 0.1},
        ],
    }

    output = plot_session(payload, "visual_similarity", tmp_path / "figure")

    assert output == tmp_path / "figure" / "visual_similarity" / "trajectory_session_unsafe.png"
    assert output.is_file()
    assert output.stat().st_size > 0
