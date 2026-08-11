"""download → (BWF detect + encode_ranges | encode_full) → upload artifacts."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time

import bwf
import io_util
import normalize
import worker_info

log = logging.getLogger("video-preprocess.job")

PREPROCESS_LOG_VERSION = 1


def _require_str(body: dict, key: str) -> str:
    val = body.get(key)
    if not isinstance(val, str) or not val:
        raise RuntimeError(f"{key} is required")
    return val


def _write_preprocess_log(path: str, payload: dict) -> int:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    return os.path.getsize(path)


def run_preprocess_job(body: dict) -> dict:
    """Returns delivery metadata. Uploads normalized.mp4 + thumb + preprocess-log."""
    t0 = time.time()
    timings: dict[str, float] = {}

    def mark(name: str, t_start: float) -> None:
        dt = round(time.time() - t_start, 2)
        timings[name] = dt
        log.info("job(timing): %s=%.2fs", name, dt)

    input_url = body.get("input_url")
    if not input_url or not isinstance(input_url, str):
        raise RuntimeError("input_url is required")

    output_upload = body.get("output_upload")
    if output_upload is None:
        raise RuntimeError(
            "output_upload is required "
            "(multipart spec, or file:// for local debug)"
        )

    thumbnail_upload_url = _require_str(body, "thumbnail_upload_url")
    preprocess_log_upload_url = _require_str(body, "preprocess_log_upload_url")

    annotation = body.get("annotation")
    if not isinstance(annotation, dict):
        raise RuntimeError("annotation is required (object with court.corners + court.net_poles)")
    vf_cfg = bwf.config_from_annotation(annotation)
    if vf_cfg is None:
        raise RuntimeError(
            "annotation unusable (need court.corners[4] and court.net_poles[2])"
        )

    # Mode from input URL (not annotation presence).
    path_mode = io_util.resolve_path_mode(input_url)
    bwf_path = path_mode == "bwf"

    # GPU required for encode + BWF NVDEC trial path.
    normalize.require_nvenc()
    worker = worker_info.collect_worker_info()

    log.info("job(start): path=%s", path_mode)

    with tempfile.TemporaryDirectory(prefix="preprocess-") as tmp:
        t = time.time()
        if io_util.is_youtube_url(input_url):
            src = io_util.download_youtube(input_url, tmp)
        else:
            src = os.path.join(tmp, "source")
            io_util.download(input_url, src)
        mark("download_sec", t)

        t = time.time()
        info = normalize.probe(src)
        mark("probe_sec", t)

        dst = os.path.join(tmp, "normalized.mp4")
        bwf_meta = None
        frame_shifts: list[dict] | None = None

        if bwf_path:
            if normalize.is_vfr(info):
                t = time.time()
                mez = os.path.join(tmp, "cfr.mp4")
                info = normalize.build_cfr_mezzanine(src, mez, info)
                src = mez
                mark("vfr_mezzanine_sec", t)

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
            # Keep source audio through the court cut.
            out = normalize.encode_ranges(
                src, dst, det["ranges"], info, strip_audio=False,
            )
            mark("encode_sec", t)

            frame_shifts = det["frame_map"]
            bwf_meta = {
                "num_ranges": len(det["ranges"]),
                "source_frame_count": det["source_frame_count"],
                "kept_frames": det["kept_frames"],
                "frame_map": det["frame_map"],
                "mode": "court_only",
            }
        else:
            t = time.time()
            out = normalize.encode_full(src, dst, info)
            mark("encode_sec", t)
            # Full-timeline encode: no court-driven frame shifts.
            frame_shifts = []

        t = time.time()
        io_util.put_object(dst, output_upload)
        mark("upload_sec", t)

        t = time.time()
        thumb_path = os.path.join(tmp, "thumbnail.jpg")
        thumb_info = normalize.extract_thumbnail(
            dst, thumb_path, float(out.get("duration") or 0),
        )
        io_util.upload(thumb_path, thumbnail_upload_url)
        mark("thumbnail_sec", t)

        timings["total_sec"] = round(time.time() - t0, 2)

        preprocess_log = {
            "version": PREPROCESS_LOG_VERSION,
            "request_id": body.get("request_id"),
            "path": path_mode,
            "frame_shifts": frame_shifts,
            "timings": timings,
            "worker": worker,
            "annotation": {
                "court_corners": vf_cfg["court_corners"],
                "net_poles": vf_cfg["net_poles"],
            },
            "source": {
                "width": info.get("width"),
                "height": info.get("height"),
                "fps": info.get("fps"),
                "duration": info.get("duration"),
                "codec": info.get("codec"),
                "audio_codec": info.get("audio_codec"),
                "pixel_fmt": info.get("pixel_fmt"),
                "file_size": info.get("file_size"),
                "is_vfr": info.get("is_vfr"),
            },
            "delivery": {
                "width": out.get("width"),
                "height": out.get("height"),
                "fps": out.get("fps"),
                "duration": out.get("duration"),
                "codec": out.get("codec"),
                "audio_codec": out.get("audio_codec"),
                "pixel_fmt": out.get("pixel_fmt"),
                "file_size": out.get("file_size"),
            },
        }
        if bwf_meta is not None:
            preprocess_log["bwf"] = {
                "num_ranges": bwf_meta["num_ranges"],
                "source_frame_count": bwf_meta["source_frame_count"],
                "kept_frames": bwf_meta["kept_frames"],
                "mode": bwf_meta["mode"],
            }

        t = time.time()
        log_path = os.path.join(tmp, "preprocess-log.json")
        _write_preprocess_log(log_path, preprocess_log)
        io_util.upload(log_path, preprocess_log_upload_url)
        mark("upload_preprocess_log_sec", t)
        timings["total_sec"] = round(time.time() - t0, 2)
        preprocess_log["timings"] = timings

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
            "source": preprocess_log["source"],
            "stage_timings": timings,
            "elapsed_sec": timings["total_sec"],
            "thumbnail": thumb_info,
            "preprocess_log": {
                "version": PREPROCESS_LOG_VERSION,
                "file_size": os.path.getsize(log_path),
            },
        }
        if bwf_meta is not None:
            result["bwf"] = bwf_meta

        log.info(
            "job(done): path=%s elapsed=%.2fs stages=%s",
            result["path"], result["elapsed_sec"], timings,
        )
        return result


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    print(json.dumps(run_preprocess_job(json.loads(sys.argv[1])), indent=2))
