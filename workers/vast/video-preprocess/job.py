"""download → (BWF detect + encode_ranges | encode_full) → upload artifacts."""

from __future__ import annotations

import logging
import os
import tempfile
import time

import bwf
import io_util
import normalize

log = logging.getLogger("video-preprocess.job")


def run_preprocess_job(body: dict) -> dict:
    """Returns delivery metadata. Uploads normalized.mp4 (+ thumb, BWF CSV)."""
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

    thumbnail_upload_url = body.get("thumbnail_upload_url")
    manifest_upload_url = body.get("manifest_upload_url")

    if body.get("valid_frames_config") is not None and body.get("annotation") is None:
        raise RuntimeError(
            "BWF requires annotation; valid_frames_config alone is not accepted"
        )

    annotation = body.get("annotation")
    vf_cfg = None
    if annotation is not None:
        if not isinstance(annotation, dict):
            raise RuntimeError("annotation must be an object")
        vf_cfg = bwf.config_from_annotation(annotation)
        if vf_cfg is None:
            raise RuntimeError("annotation unusable (need court.corners)")

    bwf_path = vf_cfg is not None
    # GPU required for encode + BWF NVDEC trial path.
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
        bwf_meta = None

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

            if manifest_upload_url:
                t = time.time()
                man_path = os.path.join(tmp, "frame_ranges.csv")
                bwf.write_manifest_csv(det["frame_map"], man_path)
                io_util.upload(man_path, manifest_upload_url)
                mark("upload_manifest_sec", t)
        else:
            t = time.time()
            out = normalize.encode_full(src, dst, info)
            mark("encode_sec", t)

        t = time.time()
        io_util.put_object(dst, url=output_upload_url, multipart=output_upload)
        mark("upload_sec", t)

        thumb_info = None
        if thumbnail_upload_url:
            t = time.time()
            try:
                thumb_path = os.path.join(tmp, "thumbnail.jpg")
                thumb_info = normalize.extract_thumbnail(
                    dst, thumb_path, float(out.get("duration") or 0),
                )
                io_util.upload(thumb_path, thumbnail_upload_url)
            except Exception as e:  # noqa: BLE001 — thumbnail is non-fatal
                log.warning("thumbnail(failed): %s", io_util.sanitize_error(e))
                thumb_info = None
            mark("thumbnail_sec", t)

        timings["total_sec"] = round(time.time() - t0, 2)

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
        if thumb_info is not None:
            result["thumbnail"] = thumb_info

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
