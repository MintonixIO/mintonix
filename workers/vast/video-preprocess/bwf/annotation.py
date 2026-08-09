"""Map annotation.json → valid_frames_config; apply geometry defaults."""

from __future__ import annotations

from typing import Any


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def annotation_to_valid_frames_config(
    annotation: dict,
    *,
    roster: dict | None = None,
) -> dict | None:
    """Court-only config. Requires court.corners; roster/names optional (ignored)."""
    _ = roster  # kept for API compatibility with job callers
    if not isinstance(annotation, dict):
        return None
    court = annotation.get("court") or {}
    if not isinstance(court, dict):
        return None
    corners = court.get("corners")
    if not (
        isinstance(corners, list)
        and len(corners) == 4
        and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in corners)
    ):
        return None

    return {
        "court_corners": [[float(p[0]), float(p[1])] for p in corners],
    }


def apply_valid_frames_defaults(config: dict, width: int, height: int) -> dict:
    """Pass-through with optional tunables; no scoreboard geometry."""
    _ = width, height
    return dict(config)
