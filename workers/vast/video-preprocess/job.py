"""download → (BWF detect + encode_ranges | encode_full) → upload video."""

from __future__ import annotations

import logging
import os
import tempfile
import time

import bwf
import io_util
import normalize

log = logging.getLogger("video-preprocess.job")


def run_preprocess_job(body: dict, progress: dict | None = None) -> dict:
    """Returns metadata for the delivery video. Uploads only normalized.mp4.

    progress is unused (kept for server callback signature compatibility).
    """
    _ = progress
    t0 = time.time()
    timings: dict[str, float] = {}

    def mark(name: str, t_start: float) -> None:
        dt = round(time.time() - t_start, 2)
        timings[name] = dt
        log.info("job(timing): %s=%.2fs", name, dt)

    input_url = body.get("input_url")
    if not input_url:
        raise RuntimeError("input_url is required")
    output_upload = body.get("output_upload")
    output_upload_url = body.get("output_upload_url")
    if not output_upload and not output_upload_url:
        raise RuntimeError("output_upload or output_upload_url is required")

    # BWF is annotation-only (no bare valid_frames_config).
    if body.get("valid_frames_config") is not None and body.get("annotation") is None:
        raise RuntimeError(
            "BWF requires annotation; valid_frames_config alone is not accepted"
        )

    annotation = body.get("annotation")
    roster = body.get("roster") if isinstance(body.get("roster"), dict) else None
    vf_cfg = None
    if annotation is not None:
        vf_cfg = bwf.config_from_annotation(
            annotation if isinstance(annotation, dict) else {}, roster=roster,
        )
        if vf_cfg is None:
            raise RuntimeError(
                "annotation unusable (need court.corners)"
            )

    bwf_path = vf_cfg is not None
    # Encode (and BWF detect NVDEC) require a GPU; fail before download.
    normalize.require_nvenc()

    log.info("job(start): bwf=%s", bwf_path)

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

        if bwf_path:
            if normalize.is_vfr(info):
                t = time.time()
                mez = os.path.join(tmp, "cfr.mp4")
                info = normalize.build_cfr_mezzanine(src, mez, info)
                src = mez
                mark("vfr_mezzanine_sec", t)

            cfg = bwf.apply_defaults(vf_cfg, info["width"], info["height"])
            fps = float(info.get("fps") or 30)
            if info.get("duration") and fps > 0:
                cfg = {
                    **cfg,
                    "source_frame_count": int(round(float(info["duration"]) * fps)),
                }

            t = time.time()
            det = bwf.detect_ranges(
                src, cfg, fps=fps, width=info["width"], height=info["height"],
            )
            mark("detect_sec", t)
            for k, v in (det.get("detect_timings") or {}).items():
                timings[f"detect_{k}" if not str(k).startswith("detect_") else k] = v

            t = time.time()
            out = normalize.encode_ranges(
                src, dst, det["ranges"], info, strip_audio=True,
            )
            mark("encode_sec", t)

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
            bwf_meta = None

        t = time.time()
        io_util.put_object(dst, url=output_upload_url, multipart=output_upload)
        mark("upload_sec", t)

        timings["total_sec"] = round(time.time() - t0, 2)

        # Metadata returned to dispatcher / callback (not a separate B2 object).
        result = {
            "request_id": body.get("request_id"),
            "status": "ok",
            "path": "bwf" if bwf_path else "user",
            "width": out.get("width"),
            "height": out.get("height"),
            "fps": out.get("fps"),
            "duration": out.get("duration"),
            "codec": out.get("codec"),
            "audio_codec": out.get("audio_codec"),
            "pixel_fmt": out.get("pixel_fmt"),
            "file_size": out.get("file_size"),
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
            "stage_timings": timings,
            "elapsed_sec": timings["total_sec"],
        }
        if bwf_meta is not None:
            result["bwf"] = bwf_meta

        log.info(
            "job(done): path=%s elapsed=%.2fs stages=%s",
            result["path"], result["elapsed_sec"], timings,
        )
        return result


if __name__ == "__main__":
    import json
    import sys

    logging.basicConfig(level=logging.INFO)
    print(json.dumps(run_preprocess_job(json.loads(sys.argv[1])), indent=2))
