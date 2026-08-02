"""Job orchestration: download → (detect-then-encode | normalize) → upload.

BWF deliverable contract:
  - Primary cleaned asset is always `normalized.mp4` (detect always reads it).
  - Non-BWF: full-timeline normalize → normalized.mp4
  - BWF with valid_frames_config: court ∧ scoreboard keep-ranges are detected
    on the *source* (cheap pass), then ONE GPU encode of kept ranges writes
    normalized.mp4 (NVDEC time-window encode, same primitive as segment-parallel).
    Side artifact: frame_ranges.csv (compact ranges in source-old / delivery-new
    frame indices). Audio stripped (dropped frames desync source track).
  - No triple pass (full normalize → detect-decode → re-encode cut).
  - VFR BWF: same-resolution CFR mezzanine → detect → cleaned encode.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time

from annotation_map import (
    apply_valid_frames_defaults,
    validate_valid_frames_request,
)
from ffmpeg_ops import (
    MAX_FPS,
    build_ffmpeg_cmd,
    delivery_fps,
    encode_frame_ranges_nvdec,
    encode_segment_parallel,
    extract_thumbnail,
    has_scale_cuda,
    is_vfr,
    needs_transcode,
    probe,
    require_gpu_for_transcode,
    require_nvenc,
    run_ffmpeg,
    should_segment_parallel,
    use_gpu,
)
from io_util import (
    _redact,
    download,
    download_youtube,
    is_youtube_url,
    sanitize_error,
    upload,
    upload_multipart,
)

log = logging.getLogger("video-normalization")


class StageTimer:
    """Wall-clock stage timer for job progress logs and result.stage_timings.

    Log lines use a stable ``job(stage=NAME): …`` prefix so serverless
    operators / PyWorker on_info can grep progress without parsing free text.
    """

    def __init__(self) -> None:
        self.t0 = time.time()
        self._mark = self.t0
        self.timings: dict[str, float] = {}

    def elapsed(self) -> float:
        return time.time() - self.t0

    def begin(self, name: str, **extra) -> None:
        """Mark stage start (does not close the previous stage)."""
        self._mark = time.time()
        extras = " ".join(f"{k}={v}" for k, v in extra.items())
        log.info(
            "job(stage=%s,start): t+%.1fs%s",
            name,
            self.elapsed(),
            f" {extras}" if extras else "",
        )

    def end(self, name: str, **extra) -> float:
        """Close stage ``name``; return stage duration seconds."""
        dt = time.time() - self._mark
        self.timings[name] = round(dt, 2)
        extras = " ".join(f"{k}={v}" for k, v in extra.items())
        log.info(
            "job(stage=%s,done): stage_sec=%.1f total_sec=%.1f%s",
            name,
            dt,
            self.elapsed(),
            f" {extras}" if extras else "",
        )
        self._mark = time.time()
        return dt

    def heartbeat(self, name: str, **extra) -> None:
        """In-stage progress line (does not end the stage)."""
        extras = " ".join(f"{k}={v}" for k, v in extra.items())
        log.info(
            "job(stage=%s,progress): stage_sec=%.1f total_sec=%.1f%s",
            name,
            time.time() - self._mark,
            self.elapsed(),
            f" {extras}" if extras else "",
        )


def _put_object(
    local_path: str,
    *,
    multipart: dict | None = None,
    url: str | None = None,
    label: str = "upload",
) -> None:
    """Upload via parallel multipart when a session is provided, else single PUT."""
    if multipart:
        upload_multipart(local_path, multipart)
        return
    if url:
        upload(local_path, url)
        return
    raise RuntimeError(f"{label}: no destination (multipart or url)")


def _env_debug_snapshot() -> dict:
    """Non-secret runtime knobs useful when diagnosing slow BWF jobs."""
    keys = (
        "NCC_FPS", "OCR_DEVICE", "OCR_WORKERS", "OCR_DET_MODEL", "OCR_REC_MODEL",
        "MAX_INFLIGHT", "SEGMENT_PARALLEL_N", "SEGMENT_PARALLEL_THRESHOLD_SEC",
        "DL_CONNECTIONS", "UL_CONNECTIONS", "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK",
    )
    out = {k: os.environ.get(k, "") for k in keys}
    # Presence-only for secrets/prefixes (never values).
    out["CALLBACK_URL_PREFIX_set"] = bool(
        (os.environ.get("CALLBACK_URL_PREFIX") or os.environ.get("SUPABASE_URL") or "").strip()
    )
    return out


def normalize_job(input_url: str, output_upload_url: str | None = None,
                  output_upload: dict | None = None,
                  thumbnail_upload_url: str | None = None,
                  valid_frames_config: dict | None = None,
                  manifest_upload_url: str | None = None,
                  original_upload_url: str | None = None,
                  original_upload: dict | None = None,
                  progress: dict | None = None) -> dict:
    """Download -> normalize -> upload. Provider-neutral orchestrator.

    See module docstring for the BWF deliverable contract. Primary cleaned
    asset always goes to `output_upload` (multipart, production) or
    `output_upload_url` (single PUT / local file://).
    """
    bwf_path = valid_frames_config is not None
    has_primary = bool(output_upload or output_upload_url)
    if bwf_path:
        err = validate_valid_frames_request(
            valid_frames_config,
            has_destination=has_primary,
            has_manifest=bool(manifest_upload_url),
        )
        if err:
            raise RuntimeError(err)
    elif not has_primary:
        raise RuntimeError("no output destination (output_upload or output_upload_url)")

    # Early NVENC gate for paths that will definitely re-encode (BWF always
    # encodes; avoids burning a large YouTube download on a GPU-broken host).
    if bwf_path:
        require_nvenc()

    out_redacted = (
        _redact(output_upload["complete_url"]) if output_upload
        else _redact(output_upload_url or "")
    )
    stages = StageTimer()
    log.info(
        "job(start): input=%s output=%s bwf=%s multipart=%s youtube=%s "
        "thumb=%s manifest=%s archive=%s env=%s",
        _redact(input_url),
        out_redacted,
        bwf_path,
        bool(output_upload),
        is_youtube_url(input_url),
        bool(thumbnail_upload_url),
        bool(manifest_upload_url),
        bool(original_upload or original_upload_url),
        json.dumps(_env_debug_snapshot(), sort_keys=True),
    )

    with tempfile.TemporaryDirectory() as tmp:
        dst = os.path.join(tmp, "normalized.mp4")

        stages.begin("download", kind="youtube" if is_youtube_url(input_url) else "http")
        if is_youtube_url(input_url):
            src = download_youtube(input_url, tmp)
        else:
            src = os.path.join(tmp, "source")
            download(input_url, src)
        src_bytes = os.path.getsize(src)
        stages.end("download", bytes=src_bytes, mb=round(src_bytes / 1024 / 1024, 1))

        stages.begin("probe")
        src_info = probe(src)
        stages.end(
            "probe",
            codec=src_info.get("codec"),
            wh=f"{src_info.get('width')}x{src_info.get('height')}",
            fps=src_info.get("fps"),
            duration=round(float(src_info.get("duration") or 0), 1),
            gpu=use_gpu(),
            vfr=is_vfr(src_info),
        )
        log.info("probe(source): %s gpu=%s", json.dumps(src_info), use_gpu())

        if original_upload or original_upload_url:
            stages.begin("archive_original", bytes=src_bytes)
            _put_object(
                src,
                multipart=original_upload,
                url=original_upload_url,
                label="original archive",
            )
            if progress is not None:
                progress["original_archived"] = True
            stages.end("archive_original", bytes=src_bytes)
            log.info("upload(original): archived pristine source (%d bytes)",
                     src_bytes)

        # force_cfr only when source is VFR — not merely because valid_frames
        # is requested. BWF VFR uses a same-resolution CFR mezzanine first.
        if is_vfr(src_info):
            log.info("source is VFR (r=%s avg=%s)",
                     src_info.get("r_frame_rate"), src_info.get("avg_frame_rate"))

        if bwf_path:
            # BWF always encodes (cleaned ranges); force_cfr for CFR delivery.
            require_gpu_for_transcode(src_info, force_cfr=True)
            dst_info, vf_meta = _bwf_detect_and_encode(
                src, dst, src_info, valid_frames_config, tmp, stages=stages,
            )
        else:
            force_cfr = is_vfr(src_info)
            require_gpu_for_transcode(src_info, force_cfr=force_cfr)
            stages.begin("full_normalize", force_cfr=force_cfr)
            dst_info = _full_normalize(src, dst, src_info, force_cfr=force_cfr)
            stages.end(
                "full_normalize",
                out_bytes=os.path.getsize(dst),
                duration=round(float(dst_info.get("duration") or 0), 1),
            )
            vf_meta = None

        # Primary upload: cleaned/normalized.mp4 (multipart in production).
        stages.begin(
            "upload_primary",
            bytes=os.path.getsize(dst),
            multipart=bool(output_upload),
        )
        _put_object(
            dst,
            multipart=output_upload,
            url=output_upload_url,
            label="primary output",
        )
        stages.end("upload_primary", bytes=os.path.getsize(dst))

        if bwf_path and manifest_upload_url and vf_meta:
            stages.begin("upload_manifest", bytes=vf_meta.get("manifest_file_size"))
            upload(vf_meta["manifest_path"], manifest_upload_url)
            stages.end("upload_manifest")

        result: dict = {**dst_info, "source": src_info}
        if thumbnail_upload_url:
            try:
                stages.begin("thumbnail")
                thumb = os.path.join(tmp, "thumbnail.jpg")
                thumb_info = extract_thumbnail(dst, thumb, dst_info["duration"])
                upload(thumb, thumbnail_upload_url)
                result["thumbnail"] = thumb_info
                stages.end("thumbnail", **{k: thumb_info.get(k) for k in ("width", "height", "file_size") if k in thumb_info})
            except Exception as e:  # noqa: BLE001 — thumbnail is non-fatal
                detail = sanitize_error(getattr(e, "stderr", None) or e)
                log.warning("thumbnail(failed): %s", detail)
                result["thumbnail"] = None
                result["thumbnail_error"] = detail
                stages.end("thumbnail", failed=True)

        if vf_meta:
            result["valid_frames"] = {
                **{k: vf_meta[k] for k in (
                    "source_frame_count", "valid_frame_count", "num_ranges",
                    "manifest_file_size", "src_fps", "out_fps",
                    "detect_sec", "encode_sec",
                ) if k in vf_meta},
                "width": dst_info.get("width"),
                "height": dst_info.get("height"),
                "fps": dst_info.get("fps"),
                "duration": dst_info.get("duration"),
                "file_size": dst_info.get("file_size"),
                "primary_asset": "normalized.mp4",
            }

        elapsed = round(stages.elapsed(), 1)
        result["elapsed_sec"] = elapsed
        result["stage_timings"] = dict(stages.timings)
        log.info(
            "job(done): elapsed=%ss stages=%s",
            elapsed,
            json.dumps(stages.timings, sort_keys=True),
        )
        return result


def _full_normalize(src: str, dst: str, src_info: dict, *, force_cfr: bool) -> dict:
    """Full-timeline normalize (non-BWF). Segment-parallel for long sources."""
    if not needs_transcode(src_info) and not force_cfr:
        log.info("remux(copy): source already matches spec, no re-encode needed")
        run_ffmpeg(build_ffmpeg_cmd(src, dst, src_info, force_cfr=False),
                   src_info["duration"])
    elif should_segment_parallel(src_info.get("duration") or 0):
        log.info(
            "encoder: segment-parallel h264_nvenc source: %s pixfmt=%s scale_cuda=%s",
            src_info["codec"], src_info["pixel_fmt"], has_scale_cuda(),
        )
        encode_segment_parallel(src, dst, src_info, force_cfr=force_cfr)
    else:
        log.info(
            "encoder: h264_nvenc source: %s pixfmt=%s scale_cuda=%s",
            src_info["codec"], src_info["pixel_fmt"], has_scale_cuda(),
        )
        run_ffmpeg(
            build_ffmpeg_cmd(src, dst, src_info, force_cfr=force_cfr),
            src_info["duration"],
        )
    dst_info = probe(dst)
    log.info("probe(output): %s", json.dumps(dst_info))
    return dst_info


def _bwf_detect_and_encode(
    src: str,
    dst: str,
    src_info: dict,
    valid_frames_config: dict,
    tmp: str,
    stages: StageTimer | None = None,
) -> tuple[dict, dict]:
    """Detect keep-ranges on source, NVDEC encode of kept ranges → dst.

    Coordinates in config are source-native (annotation). No full pre-normalize
    for CFR sources. VFR: same-resolution CFR mezzanine first (preserves
    geometry), then detect + cleaned encode.
    """
    import valid_frames  # deferred: cv2/numpy/paddle only when BWF path runs
    from ffmpeg_ops import build_cfr_mezzanine_cmd

    stages = stages or StageTimer()

    if is_vfr(src_info):
        log.info(
            "BWF VFR: building same-resolution CFR mezzanine before detect "
            "(r=%s avg=%s)",
            src_info.get("r_frame_rate"), src_info.get("avg_frame_rate"),
        )
        stages.begin("vfr_mezzanine")
        mez = os.path.join(tmp, "cfr_mezzanine.mp4")
        run_ffmpeg(
            build_cfr_mezzanine_cmd(src, mez, src_info),
            src_info.get("duration"),
        )
        src = mez
        src_info = probe(mez)
        stages.end(
            "vfr_mezzanine",
            bytes=os.path.getsize(mez),
            duration=round(float(src_info.get("duration") or 0), 1),
        )
        log.info("probe(cfr_mezzanine): %s", json.dumps(src_info))

    cfg = apply_valid_frames_defaults(
        valid_frames_config, src_info["width"], src_info["height"],
    )
    det_fps = float(src_info["fps"] or MAX_FPS)
    out_fps = delivery_fps(det_fps)
    # Hint full timeline length so subsampled NCC expands to correct frame indices.
    if src_info.get("duration") and det_fps > 0:
        cfg = {
            **cfg,
            "source_frame_count": int(round(float(src_info["duration"]) * det_fps)),
        }

    crop = cfg.get("scoreboard_crop") or {}
    sub = cfg.get("score_sub_crop") or {}
    log.info(
        "job(stage=valid_frames_detect,config): duration=%.1fs fps=%.3f n_src=%s "
        "scoreboard=%sx%s@%s,%s sub=%sx%s@%s,%s row_split=%s names=%d ncc_on=%s "
        "ncc_off=%s",
        float(src_info.get("duration") or 0),
        det_fps,
        cfg.get("source_frame_count"),
        crop.get("w"), crop.get("h"), crop.get("x"), crop.get("y"),
        sub.get("w"), sub.get("h"), sub.get("x"), sub.get("y"),
        cfg.get("row_split_y"),
        len(cfg.get("player_names") or []),
        cfg.get("ncc_on"),
        cfg.get("ncc_off"),
    )

    stages.begin(
        "valid_frames_detect",
        duration_sec=round(float(src_info.get("duration") or 0), 1),
        n_src=cfg.get("source_frame_count"),
    )
    t_detect = time.time()
    ranges, total_frames = valid_frames.detect_valid_ranges(
        src, cfg, fps=det_fps,
        width=src_info["width"], height=src_info["height"],
    )
    detect_sec = round(time.time() - t_detect, 2)
    # Manifest: old_* = source/mezzanine frames; new_* = cleaned after fps cap.
    range_manifest = valid_frames.build_range_manifest(
        ranges, src_fps=det_fps, out_fps=out_fps,
    )
    kept_src = valid_frames.count_kept_frames(ranges)
    kept_out = valid_frames.count_kept_frames(
        ranges, src_fps=det_fps, out_fps=out_fps,
    )
    manifest_path = os.path.join(tmp, "frame_ranges.csv")
    valid_frames.write_range_manifest_csv(range_manifest, manifest_path)

    kept_dur = valid_frames.kept_duration_sec(ranges, det_fps)
    stages.end(
        "valid_frames_detect",
        detect_sec=detect_sec,
        ranges=len(ranges),
        kept_src=kept_src,
        kept_out=kept_out,
        kept_sec=round(kept_dur, 1),
        total_frames=total_frames,
    )
    log.info(
        "encoder: BWF ranges→normalized (%d ranges, %d src frames → %d out @ "
        "%.3ffps, %.1fs keep) NVDEC+h264_nvenc scale_cuda=%s",
        len(ranges), kept_src, kept_out, out_fps, kept_dur, has_scale_cuda(),
    )

    stages.begin(
        "encode_ranges",
        ranges=len(ranges),
        kept_sec=round(kept_dur, 1),
        scale_cuda=has_scale_cuda(),
    )
    t_enc = time.time()
    encode_frame_ranges_nvdec(
        src, dst, dict(src_info), ranges, det_fps,
        force_cfr=True, strip_audio=True,
    )
    encode_sec = round(time.time() - t_enc, 2)
    dst_info = probe(dst)
    stages.end(
        "encode_ranges",
        encode_sec=encode_sec,
        out_bytes=os.path.getsize(dst),
        out_duration=round(float(dst_info.get("duration") or 0), 1),
    )

    log.info("probe(output/bwf-cleaned): %s", json.dumps(dst_info))

    meta = {
        "source_frame_count": total_frames,
        "valid_frame_count": kept_out,  # output-space (matches cleaned.mp4)
        "num_ranges": len(ranges),
        "manifest_file_size": os.path.getsize(manifest_path),
        "manifest_path": manifest_path,
        "ranges": ranges,
        "src_fps": det_fps,
        "out_fps": out_fps,
        "detect_sec": detect_sec,
        "encode_sec": encode_sec,
    }
    return dst_info, meta
