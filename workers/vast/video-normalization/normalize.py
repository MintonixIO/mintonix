"""Provider-neutral video normalization core — stable import facade.

Pure transcode logic with no platform SDK dependency (no runpod, no vastai).
Imported by:
  - server.py      (the FastAPI "model server" the PyWorker proxies to)
  - worker.py      (only indirectly, via the backend)
  - test_*.py (unit + e2e tests run without any serverless SDK installed)

Implementation is split for maintainability:
  - io_util.py        download / upload (retries) / multipart / callback
  - ffmpeg_ops.py     probe, cmd build, run_ffmpeg, thumbnail, NVDEC windows
  - annotation_map.py annotation.json → valid_frames_config + validation
  - job.py            normalize_job orchestration
  - valid_frames.py   court NCC + scoreboard OCR (lazy)

Normalization target: <=1920x1080, <=30 fps, h264 / yuv420p, AAC audio.

Transcodes are GPU-only (NVDEC -> scale_cuda -> h264_nvenc). There is no CPU
encode path: the worker runs exclusively on rented GPU instances, and a job
that lands on a GPU-broken host fails fast so the queue retries it elsewhere.
Remux-copy (already-conformant source) needs no GPU.

BWF deliverable contract: cleaned cut (court ∧ scoreboard) is written to
normalized.mp4 (detect always consumes that key). Compact frame_ranges.csv
is the side manifest. No scores.csv (deferred / not implemented). BWF cleaned
video is silent (dropped frames desync source audio).
"""

from __future__ import annotations

# --- io ---
from io_util import (  # noqa: F401
    DL_CONNECTIONS,
    DL_MIN_PARALLEL_BYTES,
    MULTIPART_PART_SIZE,
    UL_CONNECTIONS,
    UPLOAD_ATTEMPTS,
    _redact,
    _session,
    download,
    download_youtube,
    is_youtube_url,
    post_callback,
    sanitize_error,
    upload,
    upload_multipart,
)

# --- ffmpeg ---
from ffmpeg_ops import (  # noqa: F401
    MAX_FPS,
    MAX_LONG_EDGE,
    MAX_SHORT_EDGE,
    SEGMENT_PARALLEL_N,
    SEGMENT_PARALLEL_THRESHOLD_SEC,
    TARGET_ACODEC,
    TARGET_PIXFMT,
    TARGET_VCODEC,
    THUMBNAIL_WIDTH,
    build_cfr_mezzanine_cmd,
    build_ffmpeg_cmd,
    build_window_encode_cmd,
    compute_is_vfr,
    concat_segments,
    delivery_fps,
    encode_frame_ranges_nvdec,
    encode_segment_parallel,
    encode_time_windows,
    extract_thumbnail,
    frame_ranges_to_windows,
    has_scale_cuda,
    is_vfr,
    needs_scale_cuda_path,
    needs_transcode,
    plan_segment_splits,
    probe,
    require_gpu_for_transcode,
    require_nvenc,
    run_ffmpeg,
    should_segment_parallel,
    split_long_windows,
    use_gpu,
)

# --- annotation mapping / validation ---
from annotation_map import (  # noqa: F401
    annotation_to_valid_frames_config,
    apply_valid_frames_defaults,
    player_names_from_annotation,
    validate_valid_frames_request,
)

# --- job ---
from job import normalize_job  # noqa: F401


if __name__ == "__main__":
    import json
    import logging
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if len(sys.argv) > 1:
        job = json.loads(sys.argv[1])
        inp = job.get("input", job)
        result = normalize_job(
            inp["input_url"], inp.get("output_upload_url"),
            inp.get("output_upload"), inp.get("thumbnail_upload_url"),
            inp.get("valid_frames_config"),
            inp.get("manifest_upload_url"),
            inp.get("original_upload_url"),
            original_upload=inp.get("original_upload"),
        )
        print(json.dumps(result, indent=2))
    else:
        sys.exit("usage: python normalize.py '{\"input_url\": \"file://...\", "
                 "\"output_upload_url\": \"file://...\"}'")
