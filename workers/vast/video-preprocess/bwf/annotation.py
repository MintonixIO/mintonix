"""Map annotation.json → court-only detect config."""

from __future__ import annotations


def _points(value: object, *, n: int, name: str) -> list[list[float]] | None:
    if not (
        isinstance(value, list)
        and len(value) == n
        and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in value)
    ):
        return None
    try:
        return [[float(p[0]), float(p[1])] for p in value]
    except (TypeError, ValueError):
        return None


def config_from_annotation(annotation: dict) -> dict | None:
    """Require court.corners (4) + court.net_poles (2). Returns None if unusable."""
    if not isinstance(annotation, dict):
        return None
    court = annotation.get("court") or {}
    if not isinstance(court, dict):
        return None
    corners = _points(court.get("corners"), n=4, name="corners")
    net_poles = _points(court.get("net_poles"), n=2, name="net_poles")
    if corners is None or net_poles is None:
        return None
    return {
        "court_corners": corners,
        "net_poles": net_poles,
    }
