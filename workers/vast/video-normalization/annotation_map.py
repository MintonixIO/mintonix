"""Map annotation.json → valid_frames_config and validate simplified shapes.

annotation.json (supabase/README.md / annotate_and_ingest.py):
  {
    "court": {
      "corners": [[x,y]×4],                 // required for valid-frames
      "scoreboard_crop": {x,y,w,h},         // optional — pass-through only
      "score_sub_crop":  {x,y,w,h},         // optional — pass-through only
      "row_split_y": number                 // optional — pass-through only
    },
    "labels": [ { "display_name": "…", … }, … ]
  }

valid_frames_config (worker thin shape from jobs / annotation_to_valid_frames_config):
  court_corners, player_names
  + optional scoreboard_crop, score_sub_crop, row_split_y as stored
  (+ optional ncc_on/off, ocr_conf_min, min_valid_run)

Ownership: this module is the sole annotation → valid_frames_config mapper
(jobs passes raw annotation.json). Geometry
defaults (top-left quadrant, full-band sub-crop, row_split_y = h/2) are
filled only by apply_valid_frames_defaults after probe — worker is sole
defaulting/validation authority for valid_frames geometry.

Field renames:
  court.corners  → court_corners
  labels[].display_name or roster names → player_names
"""

from __future__ import annotations

from typing import Any


def _finite_number(v: Any) -> bool:
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return False
    # reject nan/inf
    return v == v and abs(v) != float("inf")


def _as_crop(obj: Any) -> dict | None:
    if not isinstance(obj, dict):
        return None
    if not all(_finite_number(obj.get(k)) for k in ("x", "y", "w", "h")):
        return None
    w, h = int(obj["w"]), int(obj["h"])
    if w <= 0 or h <= 0:
        return None
    return {
        "x": int(obj["x"]),
        "y": int(obj["y"]),
        "w": w,
        "h": h,
    }


def clamp_crop_to_frame(crop: dict, width: int, height: int) -> dict:
    """Clamp crop rectangle into the frame; ensure positive area."""
    x = max(0, min(int(crop["x"]), max(0, width - 1)))
    y = max(0, min(int(crop["y"]), max(0, height - 1)))
    w = max(1, min(int(crop["w"]), width - x))
    h = max(1, min(int(crop["h"]), height - y))
    return {"x": x, "y": y, "w": w, "h": h}


def _top_left_quadrant(width: int, height: int) -> dict:
    return {"x": 0, "y": 0, "w": max(1, width // 2), "h": max(1, height // 2)}


def player_names_from_annotation(
    annotation: dict,
    roster: dict | None = None,
) -> list[str]:
    """Prefer label display_name strings; fall back to match roster columns."""
    names: list[str] = []
    labels = annotation.get("labels") or []
    if isinstance(labels, list):
        for lab in labels:
            if not isinstance(lab, dict):
                continue
            n = lab.get("display_name")
            if isinstance(n, str) and n.strip():
                names.append(n.strip())
    if names:
        return names
    roster = roster or {}
    for key in ("team1_player1", "team1_player2", "team2_player1", "team2_player2"):
        n = roster.get(key)
        if isinstance(n, str) and n.strip():
            names.append(n.strip())
    return names


def annotation_to_valid_frames_config(
    annotation: dict,
    *,
    roster: dict | None = None,
) -> dict | None:
    """Sole annotation → valid_frames_config mapper (production + CLI/tests).

    jobs edge passes raw ``annotation.json`` + roster; this function owns the
    mapping. Requires court.corners (4 points) + non-empty player names
    (labels or roster). Passes scoreboard_crop / score_sub_crop / row_split_y
    only if present — does **not** invent geometry. Missing scoreboard fields
    are filled later by apply_valid_frames_defaults after probe.
    Returns None when annotation is unusable.
    """
    if not isinstance(annotation, dict):
        return None
    court = annotation.get("court") or {}
    if not isinstance(court, dict):
        return None
    corners = court.get("corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in corners)):
        return None

    names = player_names_from_annotation(annotation, roster)
    if not names:
        return None

    cfg: dict[str, Any] = {
        "court_corners": [[float(p[0]), float(p[1])] for p in corners],
        "player_names": names,
    }
    crop = _as_crop(court.get("scoreboard_crop"))
    if crop is not None:
        cfg["scoreboard_crop"] = crop
    sub = _as_crop(court.get("score_sub_crop"))
    if sub is not None:
        cfg["score_sub_crop"] = sub
    row_split = court.get("row_split_y")
    if isinstance(row_split, (int, float)) and not isinstance(row_split, bool) \
            and _finite_number(row_split):
        cfg["row_split_y"] = float(row_split)
    return cfg


def apply_valid_frames_defaults(config: dict, width: int, height: int) -> dict:
    """Sole geometry defaulting authority. Fill optional fields after probe.

    Missing scoreboard_crop → top-left quadrant of the frame. score_sub_crop is
    **relative to the band JPEG** (0,0 origin inside scoreboard_crop), not
    absolute frame coordinates. Missing sub-crop defaults to the full band
    `{0,0,crop.w,crop.h}`. When annotation set sub equal to the absolute
    scoreboard_crop (annotate BWF convention), normalize to relative.
    Missing/non-finite row_split_y → sub_crop.h / 2.
    """
    out = dict(config)
    crop = _as_crop(out.get("scoreboard_crop"))
    if crop is None:
        crop = _top_left_quadrant(width, height)
    crop = clamp_crop_to_frame(crop, width, height)
    out["scoreboard_crop"] = crop

    sub = _as_crop(out.get("score_sub_crop"))
    if sub is None:
        # Full band OCR window in band-relative coordinates.
        sub = {"x": 0, "y": 0, "w": crop["w"], "h": crop["h"]}
    elif (sub["x"] == crop["x"] and sub["y"] == crop["y"]
          and sub["w"] == crop["w"] and sub["h"] == crop["h"]):
        # Absolute-equal-to-crop → full-band relative form.
        sub = {"x": 0, "y": 0, "w": crop["w"], "h": crop["h"]}
    else:
        # Clamp relative sub-crop into the band.
        sub = {
            "x": max(0, min(sub["x"], max(0, crop["w"] - 1))),
            "y": max(0, min(sub["y"], max(0, crop["h"] - 1))),
            "w": max(1, min(sub["w"], crop["w"] - max(0, sub["x"]))),
            "h": max(1, min(sub["h"], crop["h"] - max(0, sub["y"]))),
        }
    out["score_sub_crop"] = sub

    row_split = out.get("row_split_y")
    if not _finite_number(row_split):
        out["row_split_y"] = float(sub["h"]) / 2.0
    else:
        out["row_split_y"] = float(max(0.0, min(float(row_split), float(sub["h"]))))

    # Reject non-finite corners if present.
    corners = out.get("court_corners")
    if isinstance(corners, list):
        for p in corners:
            if not (isinstance(p, (list, tuple)) and len(p) == 2
                    and _finite_number(p[0]) and _finite_number(p[1])):
                raise RuntimeError(
                    "valid_frames_config.court_corners must be finite [x,y] points"
                )
    return out


def validate_valid_frames_request(
    config,
    has_destination: bool,
    has_manifest: bool,
    *,
    allow_missing_geometry: bool = True,
) -> str | None:
    """Cheap shape check. Stdlib-only so server.py can call without cv2/paddle.

    When allow_missing_geometry is True (default), scoreboard_crop /
    score_sub_crop / row_split_y may be omitted — apply_valid_frames_defaults
    fills them after probe. court_corners + non-empty player_names remain
    required.
    """
    if not isinstance(config, dict):
        return "valid_frames_config must be an object"
    if not has_destination:
        return ("valid_frames_config given but no output_upload / "
                "output_upload_url destination")
    if not has_manifest:
        return "valid_frames_config given but no manifest_upload_url"
    corners = config.get("court_corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, (list, tuple)) and len(p) == 2
                    and _finite_number(p[0]) and _finite_number(p[1])
                    for p in corners)):
        return "valid_frames_config.court_corners must be four finite [x,y] points"
    for key in ("scoreboard_crop", "score_sub_crop"):
        if key not in config or config.get(key) is None:
            if allow_missing_geometry:
                continue
            return f"valid_frames_config.{key} must be {{x, y, w, h}}"
        c = config.get(key)
        if _as_crop(c) is None:
            return f"valid_frames_config.{key} must be finite {{x, y, w, h}} with w,h>0"
    if "row_split_y" in config and config.get("row_split_y") is not None:
        if not _finite_number(config.get("row_split_y")):
            return "valid_frames_config.row_split_y must be a finite number"
    elif not allow_missing_geometry:
        return "valid_frames_config.row_split_y must be a number"
    names = config.get("player_names")
    if not (isinstance(names, list) and names
            and all(isinstance(n, str) and n.strip() for n in names)):
        # an empty name list/string would compile to a match-everything regex,
        # silently degrading validity to court-only
        return "valid_frames_config.player_names must be a non-empty list of non-empty strings"
    return None
