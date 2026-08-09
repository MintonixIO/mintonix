"""Map annotation.json → court-only detect config."""

from __future__ import annotations


def config_from_annotation(annotation: dict) -> dict | None:
    """Require court.corners (4 points). Returns None if unusable."""
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
