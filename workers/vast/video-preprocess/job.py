"""download → (BWF detect + encode_ranges | encode_full) → upload artifacts."""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import time
from collections.abc import Callable

import bwf
import io_util
import normalize
import worker_info

log = logging.getLogger("video-preprocess.job")

PREPROCESS_LOG_VERSION = 1


class JobFailed(RuntimeError):
    """Job failed after some work; extra fields go on the failed callback."""

    def __init__(self, message: str, extra: dict | None = None):
        super().__init__(message)
        self.extra = extra or {}


def _require_str(body: dict, key: str) -> str:
    val = body.get(key)
    if not isinstance(val, str) or not val:
        raise RuntimeError(f"{key} is required")
    return val


def _probe_fields(info: dict) -> dict:
    return {
        "width": info.get("width"),
        "height": info.get("height"),
        "fps": info.get("fps"),
        "duration": info.get("duration"),
        "codec": info.get("codec"),
        "audio_codec": info.get("audio_codec"),
        "pixel_fmt": info.get("pixel_fmt"),
        "file_size": info.get("file_size"),
        "is_vfr": info.get("is_vfr"),
    }


def _write_json(path: str, payload: dict) -> int:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    return os.path.getsize(path)


def _local_output_dir(body: dict) -> str | None:
    """Optional abs dir for local debug (no file:// URLs)."""
    d = body.get("local_output_dir")
    if d is None or d == "":
        return None
    if not isinstance(d, str):
        raise RuntimeError("local_output_dir must be a string path")
    return d


def _local_source(body: dict) -> str | None:
    p = body.get("local_source")
    if p is None or p == "":
        return None
    if not isinstance(p, str):
        raise RuntimeError("local_source must be a string path")
    if not os.path.isfile(p):
        raise RuntimeError(f"local_source not found: {p}")
    return p


def run_preprocess_job(body: dict, detector=None) -> dict:
    """Download → encode → optional local detect. Uploads stage artifacts."""
    t0 = time.time()
    timings: dict[str, float] = {}

    def mark(name: str, t_start: float) -> None:
        dt = round(time.time() - t_start, 2)
        timings[name] = dt
        log.info("job(timing): %s=%.2fs", name, dt)

    input_url = body.get("input_url")
    cb_url = body.get("callback_url")

    # Production settlement cannot skip B2 uploads (check before path existence).
    raw_local_src = body.get("local_source")
    raw_local_out = body.get("local_output_dir")
    if cb_url and (
        (isinstance(raw_local_src, str) and raw_local_src)
        or (isinstance(raw_local_out, str) and raw_local_out)
    ):
        raise RuntimeError(
            "local_source/local_output_dir cannot be used with callback_url"
        )
    if not (
        (isinstance(raw_local_src, str) and raw_local_src)
        or (isinstance(raw_local_out, str) and raw_local_out)
    ) and not body.get("detections_upload_url"):
        raise RuntimeError("detections_upload_url is required")

    local_src = _local_source(body)
    local_out = _local_output_dir(body)

    if not local_src and (not input_url or not isinstance(input_url, str)):
        raise RuntimeError("input_url is required (or local_source for debug)")

    output_upload: dict | None = None
    thumbnail_upload_url: str | None = None
    preprocess_log_upload_url: str | None = None

    if local_out:
        os.makedirs(local_out, exist_ok=True)
    else:
        output_upload = io_util.validate_multipart(body.get("output_upload"))
        thumbnail_upload_url = _require_str(body, "thumbnail_upload_url")
        preprocess_log_upload_url = _require_str(body, "preprocess_log_upload_url")
        io_util.reject_file_url(thumbnail_upload_url, "thumbnail_upload_url")
        io_util.reject_file_url(preprocess_log_upload_url, "preprocess_log_upload_url")

    def emit(path: str, name: str, remote: Callable[[str], None] | None) -> None:
        """Copy to local_output_dir or run the remote upload callback."""
        if local_out:
            shutil.copy2(path, os.path.join(local_out, name))
        elif remote is not None:
            remote(path)
        else:
            raise RuntimeError(f"no destination for {name}")

    annotation = body.get("annotation")
    if not isinstance(annotation, dict):
        raise RuntimeError(
            "annotation is required (object with court.corners + court.net_poles)"
        )
    vf_cfg = bwf.config_from_annotation(annotation)
    if vf_cfg is None:
        raise RuntimeError(
            "annotation unusable (need court.corners[4] and court.net_poles[2])"
        )

    # Path mode from input URL when present (YouTube → bwf). local_source alone → user.
    # YouTube URL + local_source is allowed for offline BWF debug of a local copy.
    if input_url and isinstance(input_url, str):
        path_mode = io_util.resolve_path_mode(input_url)
    else:
        path_mode = "user"

    normalize.require_nvenc()
    worker = worker_info.collect_worker_info()

    log.info("job(start): path=%s local=%s", path_mode, bool(local_src or local_out))

    with tempfile.TemporaryDirectory(prefix="preprocess-") as tmp:
        t = time.time()
        if local_src:
            src = os.path.join(tmp, "source" + os.path.splitext(local_src)[1])
            shutil.copy2(local_src, src)
            mark("download_sec", t)
        elif io_util.is_youtube_url(input_url):
            src = io_util.download_youtube(input_url, tmp)
            mark("download_sec", t)
        else:
            src = os.path.join(tmp, "source")
            io_util.download(input_url, src)
            mark("download_sec", t)

        t = time.time()
        info = normalize.probe(src)
        mark("probe_sec", t)

        dst = os.path.join(tmp, "normalized.mp4")
        bwf_summary: dict | None = None
        frame_shifts: list[dict] = []
        encode_meta: dict = {"mode": "full"}

        if path_mode == "bwf":
            if normalize.is_vfr(info):
                t = time.time()
                mez = os.path.join(tmp, "cfr.mp4")
                info = normalize.build_cfr_mezzanine(src, mez, info)
                src = mez
                mark("vfr_mezzanine_sec", t)
                encode_meta["vfr_mezzanine"] = True

            cfg = dict(vf_cfg)
            fps = float(info.get("fps") or 30)
            if info.get("duration") and fps > 0:
                cfg["source_frame_count"] = int(round(float(info["duration"]) * fps))

            t = time.time()
            det = bwf.detect_ranges(
                src, cfg, fps=fps, width=info["width"], height=info["height"],
                codec=info.get("codec"),
            )
            mark("detect_sec", t)
            for k, v in (det.get("detect_timings") or {}).items():
                timings[f"detect_{k}"] = v

            t = time.time()
            out = normalize.encode_ranges(src, dst, det["ranges"], info)
            mark("encode_sec", t)

            frame_shifts = det["frame_map"]
            bwf_summary = {
                "num_ranges": len(det["ranges"]),
                "source_frame_count": det["source_frame_count"],
                "kept_frames": det["kept_frames"],
                "mode": "court_only",
                "src_fps": det.get("src_fps"),
                "out_fps": det.get("out_fps"),
            }
            encode_meta = {
                "mode": "ranges",
                "num_ranges": bwf_summary["num_ranges"],
                "kept_frames": bwf_summary["kept_frames"],
                "source_frame_count": bwf_summary["source_frame_count"],
                "audio_kept": bool(out.get("audio_codec")),
            }
        else:
            t = time.time()
            out = normalize.encode_full(src, dst, info)
            mark("encode_sec", t)
            encode_meta = {
                "mode": "full",
                "audio_kept": bool(out.get("audio_codec")),
            }

        # Video + thumb first so a later detect failure still leaves B2
        # artifacts for ops set-stage detect.
        t = time.time()
        emit(
            dst, "normalized.mp4",
            (lambda p: io_util.upload_multipart(p, output_upload))
            if output_upload is not None else None,
        )
        mark("upload_sec", t)

        t = time.time()
        thumb_path = os.path.join(tmp, "thumbnail.jpg")
        thumb_info = normalize.extract_thumbnail(
            dst, thumb_path, float(out.get("duration") or 0),
        )
        emit(
            thumb_path, "thumbnail.jpg",
            (lambda p: io_util.upload(p, thumbnail_upload_url))
            if thumbnail_upload_url is not None else None,
        )
        mark("thumbnail_sec", t)

        source_fields = _probe_fields(info)
        delivery_fields = _probe_fields(out)
        delivery_fields.pop("is_vfr", None)

        def build_preprocess_log() -> dict:
            payload = {
                "version": PREPROCESS_LOG_VERSION,
                "request_id": body.get("request_id"),
                "path": path_mode,
                "frame_shifts": frame_shifts,
                "timings": dict(timings),
                "worker": worker,
                "annotation": {
                    "court_corners": vf_cfg["court_corners"],
                    "net_poles": vf_cfg["net_poles"],
                },
                "source": source_fields,
                "output": {
                    **delivery_fields,
                    "basename": "normalized.mp4",
                    "encode": encode_meta,
                    "thumbnail": thumb_info,
                },
            }
            if bwf_summary is not None:
                payload["bwf"] = bwf_summary
            return payload

        timings["total_sec"] = round(time.time() - t0, 2)
        preprocess_log = build_preprocess_log()
        log_path = os.path.join(tmp, "preprocess-log.json")
        log_size = _write_json(log_path, preprocess_log)
        t = time.time()
        emit(
            log_path, "preprocess-log.json",
            (lambda p: io_util.upload(p, preprocess_log_upload_url))
            if preprocess_log_upload_url is not None else None,
        )
        mark("upload_preprocess_log_sec", t)

        det_result: dict | None = None
        detect_error: BaseException | None = None
        det_path: str | None = None
        det_url = body.get("detections_upload_url")
        want_detect = bool(det_url) or (bool(local_out) and detector is not None)
        try:
            if want_detect:
                if detector is None:
                    raise RuntimeError("models not loaded")
                if not local_out:
                    if not isinstance(det_url, str) or not det_url:
                        raise RuntimeError("detections_upload_url is required")
                    io_util.reject_file_url(det_url, "detections_upload_url")
                t = time.time()
                import detect_job
                det_path = os.path.join(tmp, "detections.json")
                try:
                    det_result = detect_job.run_detect_on_local_video(
                        detector,
                        dst,
                        det_path,
                        request_id=body.get("request_id"),
                        annotation=annotation,
                        preprocess_log=preprocess_log,
                    )
                    mark("gpu_detect_sec", t)
                    timings["total_sec"] = round(time.time() - t0, 2)
                    preprocess_log = build_preprocess_log()
                    log_size = _write_json(log_path, preprocess_log)
                    emit(
                        log_path, "preprocess-log.json",
                        (lambda p: io_util.upload(p, preprocess_log_upload_url))
                        if preprocess_log_upload_url is not None else None,
                    )
                except Exception as e:
                    detect_error = e
                    log.error(
                        "job(detect failed): request_id=%s error=%s",
                        body.get("request_id"),
                        io_util.safe_error_message(e),
                    )
            if detect_error is None and det_result is not None and det_path is not None:
                emit(
                    det_path,
                    "detections.json",
                    (
                        (lambda p: io_util.upload_file(
                            p, det_url, content_type="application/json",
                        ))
                        if isinstance(det_url, str) and det_url else None
                    ),
                )
        finally:
            if detect_error is not None:
                raise JobFailed(
                    io_util.safe_error_message(detect_error),
                    extra={
                        "duration": out.get("duration"),
                        "width": out.get("width"),
                        "height": out.get("height"),
                        "fps": out.get("fps"),
                    },
                ) from detect_error

        timings["total_sec"] = round(time.time() - t0, 2)

        result = {
            "request_id": body.get("request_id"),
            "status": "ok",
            "path": path_mode,
            "width": out.get("width"),
            "height": out.get("height"),
            "fps": out.get("fps"),
            "duration": out.get("duration"),
            "codec": out.get("codec"),
            "audio_codec": out.get("audio_codec"),
            "pixel_fmt": out.get("pixel_fmt"),
            "file_size": out.get("file_size"),
            "source": source_fields,
            "stage_timings": timings,
            "elapsed_sec": timings["total_sec"],
            "thumbnail": thumb_info,
            "preprocess_log": {
                "version": PREPROCESS_LOG_VERSION,
                "file_size": log_size,
            },
        }
        if det_result is not None:
            result["frame_count"] = det_result["frame_count"]
        # Thin settle payload — full frame_shifts live only in preprocess-log.
        if bwf_summary is not None:
            result["bwf"] = {
                "num_ranges": bwf_summary["num_ranges"],
                "source_frame_count": bwf_summary["source_frame_count"],
                "kept_frames": bwf_summary["kept_frames"],
                "mode": bwf_summary["mode"],
            }

        log.info(
            "job(done): path=%s elapsed=%.2fs stages=%s",
            result["path"], result["elapsed_sec"], timings,
        )
        return result


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    print(json.dumps(run_preprocess_job(json.loads(sys.argv[1])), indent=2))
