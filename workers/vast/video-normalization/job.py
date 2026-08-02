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
    log.info("job(start): input=%s output=%s bwf=%s multipart=%s",
             _redact(input_url), out_redacted, bwf_path, bool(output_upload))

    t_start = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        dst = os.path.join(tmp, "normalized.mp4")

        if is_youtube_url(input_url):
            src = download_youtube(input_url, tmp)
        else:
            src = os.path.join(tmp, "source")
            download(input_url, src)

        src_info = probe(src)
        log.info("probe(source): %s gpu=%s", json.dumps(src_info), use_gpu())

        if original_upload or original_upload_url:
            _put_object(
                src,
                multipart=original_upload,
                url=original_upload_url,
                label="original archive",
            )
            if progress is not None:
                progress["original_archived"] = True
            log.info("upload(original): archived pristine source (%d bytes)",
                     os.path.getsize(src))

        # force_cfr only when source is VFR — not merely because valid_frames
        # is requested. BWF VFR uses a same-resolution CFR mezzanine first.
        if is_vfr(src_info):
            log.info("source is VFR (r=%s avg=%s)",
                     src_info.get("r_frame_rate"), src_info.get("avg_frame_rate"))

        if bwf_path:
            # BWF always encodes (cleaned ranges); force_cfr for CFR delivery.
            require_gpu_for_transcode(src_info, force_cfr=True)
            dst_info, vf_meta = _bwf_detect_and_encode(
                src, dst, src_info, valid_frames_config, tmp,
            )
        else:
            force_cfr = is_vfr(src_info)
            require_gpu_for_transcode(src_info, force_cfr=force_cfr)
            dst_info = _full_normalize(src, dst, src_info, force_cfr=force_cfr)
            vf_meta = None

        # Primary upload: cleaned/normalized.mp4 (multipart in production).
        _put_object(
            dst,
            multipart=output_upload,
            url=output_upload_url,
            label="primary output",
        )

        if bwf_path and manifest_upload_url and vf_meta:
            upload(vf_meta["manifest_path"], manifest_upload_url)

        result: dict = {**dst_info, "source": src_info}
        if thumbnail_upload_url:
            try:
                thumb = os.path.join(tmp, "thumbnail.jpg")
                thumb_info = extract_thumbnail(dst, thumb, dst_info["duration"])
                upload(thumb, thumbnail_upload_url)
                result["thumbnail"] = thumb_info
            except Exception as e:  # noqa: BLE001 — thumbnail is non-fatal
                detail = sanitize_error(getattr(e, "stderr", None) or e)
                log.warning("thumbnail(failed): %s", detail)
                result["thumbnail"] = None
                result["thumbnail_error"] = detail

        if vf_meta:
            result["valid_frames"] = {
                **{k: vf_meta[k] for k in (
                    "source_frame_count", "valid_frame_count", "num_ranges",
                    "manifest_file_size", "src_fps", "out_fps",
                ) if k in vf_meta},
                "width": dst_info.get("width"),
                "height": dst_info.get("height"),
                "fps": dst_info.get("fps"),
                "duration": dst_info.get("duration"),
                "file_size": dst_info.get("file_size"),
                "primary_asset": "normalized.mp4",
            }

        elapsed = round(time.time() - t_start, 1)
        log.info("job(done): elapsed=%ss", elapsed)
        result["elapsed_sec"] = elapsed
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
) -> tuple[dict, dict]:
    """Detect keep-ranges on source, NVDEC encode of kept ranges → dst.

    Coordinates in config are source-native (annotation). No full pre-normalize
    for CFR sources. VFR: same-resolution CFR mezzanine first (preserves
    geometry), then detect + cleaned encode.
    """
    import valid_frames  # deferred: cv2/numpy/paddle only when BWF path runs
    from ffmpeg_ops import build_cfr_mezzanine_cmd

    if is_vfr(src_info):
        log.info(
            "BWF VFR: building same-resolution CFR mezzanine before detect "
            "(r=%s avg=%s)",
            src_info.get("r_frame_rate"), src_info.get("avg_frame_rate"),
        )
        mez = os.path.join(tmp, "cfr_mezzanine.mp4")
        run_ffmpeg(
            build_cfr_mezzanine_cmd(src, mez, src_info),
            src_info.get("duration"),
        )
        src = mez
        src_info = probe(mez)
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

    ranges, total_frames = valid_frames.detect_valid_ranges(
        src, cfg, fps=det_fps,
        width=src_info["width"], height=src_info["height"],
    )
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
    log.info(
        "encoder: BWF ranges→normalized (%d ranges, %d src frames → %d out @ "
        "%.3ffps, %.1fs keep) NVDEC+h264_nvenc scale_cuda=%s",
        len(ranges), kept_src, kept_out, out_fps, kept_dur, has_scale_cuda(),
    )

    encode_frame_ranges_nvdec(
        src, dst, dict(src_info), ranges, det_fps,
        force_cfr=True, strip_audio=True,
    )
    dst_info = probe(dst)

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
    }
    return dst_info, meta
