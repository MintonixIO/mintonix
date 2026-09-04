"""Detect-only retry: download normalized.mp4 → VideoDetector → upload detections.json."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path

from detect.output import (
    build_segments_for_video,
    probe_video,
    write_detections_json,
)
from io_util import download, sanitize_error, upload_file

log = logging.getLogger("video-preprocess.detect_job")


def _require_str(body: dict, key: str) -> str:
    val = body.get(key)
    if not isinstance(val, str) or not val:
        raise RuntimeError(f"{key} is required")
    return val


def _download_json(url: str | None, *, label: str) -> dict | None:
    """GET a small JSON sidecar. Missing URL → None. Present URL: fail closed."""
    if not url or not isinstance(url, str):
        return None
    fd, name = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    tmp = Path(name)
    try:
        download(url, tmp, max_bytes=32 * 1024 * 1024)
        data = json.loads(tmp.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("expected JSON object")
        return data
    except Exception as e:
        raise RuntimeError(
            f"{label} download failed: {sanitize_error(e)}"
        ) from None
    finally:
        tmp.unlink(missing_ok=True)


def run_detect_on_local_video(
    detector,
    video_path: str | Path,
    dest_json: str | Path,
    *,
    request_id: str | None,
    annotation: dict | None,
    preprocess_log: dict | None,
) -> dict:
    """Write Engine detections.json from a local mp4. Returns frame_count."""
    video_path = Path(video_path)
    dest_json = Path(dest_json)
    meta = probe_video(video_path)
    segments = build_segments_for_video(
        video_path=video_path,
        annotation=annotation,
        preprocess_log=preprocess_log,
        frame_count_hint=int(meta.get("frame_count_hint") or 0),
    )
    frame_count = write_detections_json(
        dest_json,
        request_id=request_id,
        video_path=video_path,
        frame_chunks=detector.run(video_path),
        segments=segments,
        fps=float(meta.get("fps") or 0.0),
        width=int(meta.get("width") or 0),
        height=int(meta.get("height") or 0),
    )
    if frame_count == 0:
        raise RuntimeError("no frames decoded from video")
    return {
        "frame_count": frame_count,
        "width": meta.get("width"),
        "height": meta.get("height"),
        "fps": meta.get("fps"),
        "segments": len(segments),
    }


def run_detect_job(body: dict, detector) -> dict:
    """Retry envelope: input_url + output_upload_url (+ optional sidecars)."""
    t0 = time.monotonic()
    request_id = body.get("request_id")
    input_url = _require_str(body, "input_url")
    output_upload_url = _require_str(body, "output_upload_url")

    annotation = body.get("annotation") if isinstance(body.get("annotation"), dict) else None
    preprocess_log = (
        body.get("preprocess_log")
        if isinstance(body.get("preprocess_log"), dict)
        else None
    )
    annotation_url = body.get("annotation_url")
    preprocess_log_url = body.get("preprocess_log_url")

    video_fd, video_name = tempfile.mkstemp(suffix=".mp4")
    os.close(video_fd)
    video_tmp = Path(video_name)
    json_fd, json_name = tempfile.mkstemp(suffix=".json")
    os.close(json_fd)
    json_tmp = Path(json_name)

    try:
        download(input_url, video_tmp)
        if annotation is None:
            annotation = _download_json(annotation_url, label="annotation.json")
        if preprocess_log is None:
            preprocess_log = _download_json(
                preprocess_log_url, label="preprocess-log.json"
            )
        if isinstance(annotation_url, str) and annotation_url and annotation is None:
            raise RuntimeError("annotation.json download failed: missing object")
        if (
            isinstance(preprocess_log_url, str)
            and preprocess_log_url
            and preprocess_log is None
        ):
            raise RuntimeError("preprocess-log.json download failed: missing object")

        result = run_detect_on_local_video(
            detector,
            video_tmp,
            json_tmp,
            request_id=request_id,
            annotation=annotation,
            preprocess_log=preprocess_log,
        )
        upload_file(json_tmp, output_upload_url, content_type="application/json")
        elapsed = time.monotonic() - t0
        log.info(
            "detect(done): request_id=%s frames=%d segments=%d elapsed=%.1fs",
            request_id,
            result["frame_count"],
            result["segments"],
            elapsed,
        )
        return {
            "frame_count": result["frame_count"],
            "elapsed_sec": round(elapsed, 3),
        }
    finally:
        video_tmp.unlink(missing_ok=True)
        json_tmp.unlink(missing_ok=True)
