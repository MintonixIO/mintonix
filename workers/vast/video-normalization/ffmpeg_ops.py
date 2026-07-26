"""ffmpeg / ffprobe helpers: probe, cmd build, run, thumbnail, segment-parallel.

GPU-only encode policy (NVDEC → scale_cuda → h264_nvenc). Remux-copy when
the source already matches the delivery envelope needs no GPU.
"""

from __future__ import annotations

import concurrent.futures
import functools
import json
import logging
import os
import random
import subprocess
import tempfile
import time

log = logging.getLogger("video-normalization")

FFMPEG_PROGRESS_INTERVAL_SEC = 10.0

# Thumbnail: a single random frame, scaled to this width (aspect preserved).
THUMBNAIL_WIDTH = int(os.environ.get("THUMBNAIL_WIDTH", "640"))

# Segment-parallel encode (FINDINGS.md ~1.9× on 5080): auto when duration
# exceeds the threshold. Short clips stay single-stream.
SEGMENT_PARALLEL_THRESHOLD_SEC = float(
    os.environ.get("SEGMENT_PARALLEL_THRESHOLD_SEC", "600")
)
SEGMENT_PARALLEL_N = int(os.environ.get("SEGMENT_PARALLEL_N", "4"))

# Delivery spec — the single source of truth for the normalization target.
MAX_LONG_EDGE = 1920
MAX_SHORT_EDGE = 1080
MAX_FPS = 30
TARGET_VCODEC = "h264"
TARGET_PIXFMT = "yuv420p"
TARGET_ACODEC = "aac"


def _parse_fps(rate_str: str) -> float:
    num, den = rate_str.split("/")
    if float(den) == 0:
        return 0.0
    return float(num) / float(den)


def probe(path: str) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams", "-show_format",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    streams = data["streams"]
    fmt = data["format"]

    video = next(
        (s for s in streams
         if s["codec_type"] == "video"
         and not s.get("disposition", {}).get("attached_pic", 0)),
        None,
    )
    if video is None:
        raise RuntimeError("no video stream found")

    audio = next((s for s in streams if s["codec_type"] == "audio"), None)

    r_fps = _parse_fps(video.get("r_frame_rate", "0/1"))
    avg_fps = _parse_fps(video.get("avg_frame_rate", "0/1"))
    fps = r_fps if r_fps > 0 else avg_fps
    is_vfr_flag = compute_is_vfr(r_fps, avg_fps)

    duration = 0.0
    if "duration" in fmt:
        duration = float(fmt["duration"])
    elif video.get("duration"):
        duration = float(video["duration"])

    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": round(fps, 3),
        "audio_codec": audio["codec_name"] if audio else None,
        "duration": round(duration, 3),
        "codec": video["codec_name"],
        "pixel_fmt": video["pix_fmt"],
        "file_size": int(fmt.get("size") or 0),
        "is_vfr": is_vfr_flag,
        "r_frame_rate": video.get("r_frame_rate"),
        "avg_frame_rate": video.get("avg_frame_rate"),
    }


def compute_is_vfr(r_fps: float, avg_fps: float, rel_tol: float = 0.02) -> bool:
    """Pure VFR heuristic from r_frame_rate vs avg_frame_rate (unit-tested).

    True when they disagree by more than rel_tol, or avg is 0 while r is set
    (common container signal for variable rate). Not perfect — BWF VFR uses a
    same-resolution CFR mezzanine before detect (not fail-close) so frame-index
    and timestamp math agree under CFR.
    """
    if r_fps > 0 and avg_fps > 0:
        return abs(r_fps - avg_fps) / max(r_fps, avg_fps) > rel_tol
    if r_fps > 0 and avg_fps == 0:
        return True
    return False


def is_vfr(info: dict) -> bool:
    """True when the source should be force-CFR re-encoded for frame-index work."""
    if "is_vfr" in info:
        return bool(info["is_vfr"])
    return False


def delivery_fps(src_fps: float) -> float:
    """Output fps after normalize caps (≤ MAX_FPS)."""
    if not src_fps or src_fps <= 0:
        return float(MAX_FPS)
    return float(min(src_fps, MAX_FPS))


def _has_gpu() -> bool:
    """Detect a usable NVIDIA GPU at runtime.

    Two conditions must hold:
      1. A device node exists (e.g. /dev/nvidia0, or /dev/nvidia3 on a
         multi-GPU host where this container was assigned a non-zero index).
         Absent on CPU pods and CI runners. The glob matches /dev/nvidiaN for
         any index but not /dev/nvidiactl or /dev/nvidia-modeset.
      2. ffmpeg was compiled with h264_nvenc support.
    """
    import glob
    if not glob.glob("/dev/nvidia[0-9]*"):
        return False
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=5,
        )
        return "h264_nvenc" in result.stdout
    except Exception:
        return False


@functools.cache
def use_gpu() -> bool:
    return _has_gpu()


def _has_gpu_filter(name: str) -> bool:
    """Check if a CUDA filter (scale_cuda, etc.) is available at runtime."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True, text=True, timeout=5,
        )
        return name in result.stdout
    except Exception:
        return False


@functools.cache
def has_scale_cuda() -> bool:
    return _has_gpu_filter("scale_cuda")


def _scale_ratio(w: int, h: int) -> float | None:
    """Downscale ratio to fit the delivery envelope; >=1.0 means already fits.
    None when dimensions are unknown (treated as "needs scaling")."""
    long_edge, short_edge = max(w, h), min(w, h)
    if not long_edge:
        return None
    return min(MAX_LONG_EDGE / long_edge, MAX_SHORT_EDGE / short_edge)


def _scaled_dims(w: int, h: int, ratio: float) -> tuple[int, int]:
    """Even-rounded target dimensions (h264 requires even width/height)."""
    return (int(w * ratio) // 2) * 2, (int(h * ratio) // 2) * 2


def _needs_pixfmt_convert(info: dict) -> bool:
    """Shared pixfmt check: missing/unknown treated as needs conversion."""
    pf = info.get("pixel_fmt") or "unknown"
    return pf not in (TARGET_PIXFMT,)


def needs_transcode(info: dict) -> bool:
    """True if the source needs re-encoding; False means we can remux with -c copy."""
    ratio = _scale_ratio(info.get("width", 0), info.get("height", 0))
    needs_scale = ratio is None or ratio < 1.0
    needs_fps_cap = (info.get("fps", 0) or 0) > MAX_FPS
    needs_pixfmt = _needs_pixfmt_convert(info)
    ac = info.get("audio_codec")
    needs_audio = ac is not None and ac != TARGET_ACODEC
    return (info.get("codec", "unknown") != TARGET_VCODEC
            or needs_scale or needs_fps_cap or needs_pixfmt or needs_audio)


def needs_scale_cuda_path(info: dict, force_cfr: bool = False) -> bool:
    """True when the GPU filter chain needs scale_cuda (scale and/or pixfmt).

    force_cfr alone does not imply scale_cuda: a delivery-compatible source
    that only needs ``fps=`` (CFR pin / VFR mezzanine) returns False so
    preflight matches the actual command.
    """
    if not force_cfr and not needs_transcode(info):
        return False
    w, h = info.get("width", 0), info.get("height", 0)
    ratio = _scale_ratio(w, h)
    needs_scale = ratio is not None and ratio < 1.0
    return needs_scale or _needs_pixfmt_convert(info)


def build_cfr_mezzanine_cmd(input_path: str, output_path: str, info: dict) -> list[str]:
    """Force-CFR re-encode at the **same** resolution (no spatial scale).

    Used for VFR BWF: annotation geometry is source-native, so mezzanine must
    not change width/height. Detection then runs on the CFR mezzanine.

    When pixel_fmt is already delivery-compatible (yuv420p), vf is ``fps=``
    only — matching ``needs_scale_cuda_path`` / ``require_gpu_for_transcode``
    (do not require or inject scale_cuda for a pure CFR pin). scale_cuda is
    used only when pixfmt conversion is needed (``iw:ih:format=nv12``).
    """
    fps = info.get("fps") or MAX_FPS
    vf_parts = [f"fps={fps:g}"]
    # Same spatial size always; scale_cuda only for pixfmt → nv12 for NVENC.
    if _needs_pixfmt_convert(info):
        vf_parts.append("scale_cuda=iw:ih:format=nv12")
    return (
        ["ffmpeg", "-y", "-nostats", "-threads", "0",
         "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
         "-hwaccel_device", "0", "-i", input_path]
        + _video_encoder_args()
        + ["-vf", ",".join(vf_parts), "-an",
           "-movflags", "+faststart", "-progress", "pipe:2", output_path]
    )


def require_nvenc() -> None:
    """Fail fast when h264_nvenc is unavailable (pre-download BWF / known encode)."""
    if not use_gpu():
        raise RuntimeError(
            "no usable NVIDIA GPU (h264_nvenc) detected — this worker has "
            "no CPU transcode path; failing the job so the retry system "
            "reschedules it on a working GPU host"
        )


def require_gpu_for_transcode(info: dict, force_cfr: bool = False) -> None:
    """Fail fast when GPU pieces required for the job are missing.

    Call after probe with concrete `info`. Remux-copy needs no GPU.
    BWF / known-encode paths should call ``require_nvenc()`` pre-download
    and pass ``force_cfr=True`` here (always encodes).

    scale_cuda is required only when ``needs_scale_cuda_path`` is true (scale
    and/or pixfmt) — not merely because force_cfr / VFR mezzanine pins fps.
    """
    if not force_cfr and not needs_transcode(info):
        return  # remux-copy
    require_nvenc()
    if needs_scale_cuda_path(info, force_cfr=force_cfr) and not has_scale_cuda():
        raise RuntimeError(
            "scale_cuda filter not available in ffmpeg but this job needs "
            "scale and/or pixel-format conversion — failing fast so the "
            "queue can retry on a host with a CUDA-capable ffmpeg build"
        )


def _video_encoder_args() -> list[str]:
    """The one h264 encoder configuration, shared by the normalize encode and
    the valid-frames range encode. NVENC only — this worker has no CPU encode
    path: it runs exclusively on rented GPU instances, so a libx264 fallback
    would silently burn credit at a fraction of NVENC speed. A job that lands
    on a GPU-broken host fails instead, and the queue retries it elsewhere."""
    return ["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq",
            "-rc", "vbr", "-cq", "23", "-b:v", "0"]


def _vf_parts(info: dict, force_cfr: bool = False) -> list[str]:
    w, h, fps = info["width"], info["height"], info["fps"]
    ratio = _scale_ratio(w, h)
    needs_scale = ratio is not None and ratio < 1.0
    # Shared with needs_transcode / mezzanine: missing/unknown → convert.
    needs_pixfmt = _needs_pixfmt_convert(info)

    vf_parts: list[str] = []
    # The fps cap operates on the timestamp stream and passes CUDA hwframes
    # through untouched, so it sits ahead of scale_cuda.
    if fps > MAX_FPS:
        vf_parts.append(f"fps={MAX_FPS}")
    elif force_cfr:
        vf_parts.append(f"fps={fps or MAX_FPS}")

    if needs_scale:
        new_w, new_h = _scaled_dims(w, h, ratio)
        vf_parts.append(f"scale_cuda={new_w}:{new_h}:format=nv12")
    elif needs_pixfmt:
        vf_parts.append("scale_cuda=iw:ih:format=nv12")
    return vf_parts


def _audio_args(info: dict, *, strip: bool = False) -> list[str]:
    if strip or info.get("audio_codec") is None:
        return ["-an"]
    if info["audio_codec"] == TARGET_ACODEC:
        return ["-c:a", "copy"]
    return ["-c:a", TARGET_ACODEC, "-b:a", "128k"]


def build_ffmpeg_cmd(input_path: str, output_path: str, info: dict,
                     force_cfr: bool = False) -> list[str]:
    """force_cfr skips the remux-copy shortcut and always applies an `fps=`
    filter, so the output is constant-frame-rate: valid-frame extraction
    addresses frames by index and samples the scoreboard by timestamp, which
    only agree under CFR (a remuxed VFR source would desync them).

    Callers should only pass force_cfr=True when the source is actually VFR
    (or when building a cut that must be CFR). Do not force re-encode solely
    because valid_frames_config is set.

    Transcodes are GPU-only (NVDEC → scale_cuda → h264_nvenc); normalize_job
    fails the job up front when no usable GPU is present. Remux-copy needs no
    GPU."""
    if not force_cfr and not needs_transcode(info):
        return [
            "ffmpeg", "-y", "-nostats",
            "-threads", "0",
            "-i", input_path,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]

    input_opts = ["-threads", "0",
                  "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
                  "-hwaccel_device", "0",
                  "-i", input_path]

    vf_parts = _vf_parts(info, force_cfr=force_cfr)
    audio_args = _audio_args(info)

    cmd = ["ffmpeg", "-y", "-nostats"] + input_opts
    cmd += _video_encoder_args()
    if vf_parts:
        cmd += ["-vf", ",".join(vf_parts)]
    cmd += audio_args
    cmd += ["-movflags", "+faststart", "-progress", "pipe:2", output_path]
    return cmd


def run_ffmpeg(cmd: list[str], source_duration: float | None) -> None:
    log.info("ffmpeg(command): %s", " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    stats: dict[str, str] = {}
    last_emit = 0.0
    stderr_tail: list[str] = []

    assert proc.stderr is not None
    for line in proc.stderr:
        stderr_tail.append(line)
        if len(stderr_tail) > 200:
            stderr_tail.pop(0)

        stripped = line.strip()
        if "=" in stripped:
            key, _, val = stripped.partition("=")
            # -progress pipe:2 emits clean key=value pairs.  Human-readable
            # status lines (frame=    0 fps= ...) have spaces in the value;
            # skip those.
            if " " in val:
                continue
            if key in ("frame", "fps", "out_time_ms", "out_time_us", "total_size", "speed", "progress"):
                stats[key] = val
                now = time.time()
                is_end = key == "progress" and val == "end"
                if now - last_emit >= FFMPEG_PROGRESS_INTERVAL_SEC or is_end:
                    last_emit = now
                    raw = stats.get("out_time_us", stats.get("out_time_ms", "0"))
                    try:
                        t_us = int(raw)
                    except (ValueError, TypeError):
                        t_us = 0
                    t_sec = t_us / 1_000_000
                    pct = (t_sec / source_duration * 100) if source_duration else None
                    msg = (
                        f"ffmpeg: frame={stats.get('frame', '?')} "
                        f"fps={stats.get('fps', '?')} "
                        f"speed={stats.get('speed', '?')} "
                        f"time={t_sec:.1f}s"
                    )
                    if pct is not None:
                        msg += f" ({pct:.1f}%)"
                    log.info(msg)

    proc.stderr.close()
    proc.wait()
    rc = proc.returncode
    if rc != 0:
        tail = "".join(stderr_tail[-50:])
        log.error("ffmpeg(failed): exit=%d\n%s", rc, tail)
        raise RuntimeError(f"ffmpeg failed (exit {rc}):\n{tail}")

    log.info("ffmpeg(done): exit=%d", rc)


def extract_thumbnail(video_path: str, dest_path: str, duration: float) -> dict:
    """Grab one random frame as a JPEG thumbnail scaled to THUMBNAIL_WIDTH wide.

    JPEG over PNG/WebP: smallest universally-supported format for a single
    photographic frame — every browser, CDN and image pipeline handles it with
    no decode surprises, and a ~640px frame lands well under 100 KB.

    The frame is sampled from the *normalized output* (so the thumbnail matches
    the delivered asset) at a uniform-random point in the middle 90% of the
    timeline, dodging black intro/outro frames. `-ss` precedes `-i` for a fast
    keyframe seek. Returns {width, height, file_size, timestamp_sec}.
    """
    ts = random.uniform(0.05, 0.95) * duration if duration and duration > 0 else 0.0
    cmd = [
        "ffmpeg", "-y", "-nostats", "-loglevel", "error",
        "-ss", f"{ts:.3f}", "-i", video_path,
        "-frames:v", "1",
        "-vf", f"scale='min({THUMBNAIL_WIDTH},iw)':-2",
        "-q:v", "2",
        dest_path,
    ]
    log.info("thumbnail(extract): t=%.3fs width<=%d", ts, THUMBNAIL_WIDTH)
    subprocess.run(cmd, check=True, capture_output=True, text=True)

    # A single JPEG has no container duration, so probe() (which reads
    # format.duration) doesn't apply — read just the image dimensions.
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", dest_path],
        capture_output=True, text=True, check=True,
    )
    stream = json.loads(out.stdout)["streams"][0]
    size = os.path.getsize(dest_path)
    log.info("thumbnail(done): %dx%d %d bytes", stream["width"], stream["height"], size)
    return {
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "file_size": size,
        "timestamp_sec": round(ts, 3),
    }


def _keyframe_times(path: str) -> list[float]:
    """Return sorted keyframe timestamps (seconds).

    Uses frame metadata with keyframe skip rather than listing every packet
    (cheaper on multi-hour 4K masters).
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-skip_frame", "nokey",
         "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    times: list[float] = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            times.append(float(line.split(",")[0]))
        except ValueError:
            continue
    return times


def plan_segment_splits(duration: float, keyframe_times: list[float],
                        n: int | None = None) -> list[tuple[float, float]] | None:
    """Keyframe-aligned [start, end) time ranges covering [0, duration).

    Pure helper for unit tests — no ffmpeg. Returns None when keyframe list is
    empty so callers fall back to single-stream encode (equal wall splits are
    unsafe with -ss before -i).
    """
    n = n or SEGMENT_PARALLEL_N
    n = max(1, n)
    if duration <= 0:
        return [(0.0, 0.0)]
    if n == 1:
        return [(0.0, duration)]
    if not keyframe_times:
        return None

    targets = [duration * i / n for i in range(1, n)]
    cuts: list[float] = []
    kfs = sorted(t for t in keyframe_times if 0 < t < duration)
    if not kfs:
        return None
    for tgt in targets:
        best = min(kfs, key=lambda t: abs(t - tgt))
        if not cuts or best > cuts[-1] + 0.5:
            cuts.append(best)
        kfs = [t for t in kfs if abs(t - best) > 0.25]

    bounds = [0.0] + cuts + [duration]
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)
            if bounds[i + 1] > bounds[i] + 0.05]


def should_segment_parallel(duration: float) -> bool:
    return (duration or 0) >= SEGMENT_PARALLEL_THRESHOLD_SEC and SEGMENT_PARALLEL_N > 1


def build_window_encode_cmd(
    input_path: str,
    output_path: str,
    info: dict,
    start: float,
    end: float,
    *,
    force_cfr: bool = False,
    strip_audio: bool = False,
    accurate_seek: bool = False,
) -> list[str]:
    """Encode one time window [start, end) via NVDEC → scale_cuda → h264_nvenc.

    accurate_seek=False (default for keyframe-aligned full-timeline splits):
      ``-ss`` before ``-i`` (fast).
    accurate_seek=True (BWF frame-range cuts):
      ``-ss`` after ``-i`` so cuts match detection frame indices under CFR.

    strip_audio=True for BWF cleaned cut (dropped frames desync source audio).
    Otherwise AAC re-encode for concat-safe multi-segment full normalize.
    """
    length = max(0.0, end - start)
    cmd = ["ffmpeg", "-y", "-nostats", "-threads", "0"]
    if not accurate_seek:
        cmd += ["-ss", f"{start:.6f}"]
    cmd += [
        "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
        "-hwaccel_device", "0",
        "-i", input_path,
    ]
    if accurate_seek:
        cmd += ["-ss", f"{start:.6f}"]
    cmd += ["-t", f"{length:.6f}"]
    cmd += _video_encoder_args()
    vf_parts = _vf_parts(info, force_cfr=force_cfr)
    if vf_parts:
        cmd += ["-vf", ",".join(vf_parts)]
    if strip_audio or info.get("audio_codec") is None:
        cmd += ["-an"]
    else:
        # Force AAC re-encode for concat safety (never stream-copy across segs).
        cmd += ["-c:a", TARGET_ACODEC, "-b:a", "128k"]
    cmd += ["-movflags", "+faststart", "-progress", "pipe:2", output_path]
    return cmd


def concat_segments(segment_paths: list[str], output_path: str) -> None:
    """Lossless concat demuxer join of same-codec segments."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        list_path = f.name
        for p in segment_paths:
            # Escape single quotes for concat demuxer.
            esc = p.replace("'", r"'\''")
            f.write(f"file '{esc}'\n")
    try:
        cmd = [
            "ffmpeg", "-y", "-nostats", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c", "copy", "-movflags", "+faststart", output_path,
        ]
        run_ffmpeg(cmd, None)
    finally:
        try:
            os.unlink(list_path)
        except OSError:
            pass


def encode_time_windows(
    input_path: str,
    output_path: str,
    info: dict,
    windows: list[tuple[float, float]],
    *,
    force_cfr: bool = False,
    strip_audio: bool = False,
    accurate_seek: bool = False,
    n: int | None = None,
) -> None:
    """Encode ordered time windows with NVDEC and concat (single parallel primitive).

    Used by full-timeline segment-parallel and BWF cleaned range encode so both
    paths hit fixed-function decode + NVENC instead of software concat demux.
    """
    n = max(1, n or SEGMENT_PARALLEL_N)
    windows = [(float(a), float(b)) for a, b in windows if b > a + 1e-6]
    if not windows:
        raise RuntimeError("encode_time_windows: no non-empty windows")

    if len(windows) == 1:
        start, end = windows[0]
        run_ffmpeg(
            build_window_encode_cmd(
                input_path, output_path, info, start, end,
                force_cfr=force_cfr, strip_audio=strip_audio,
                accurate_seek=accurate_seek,
            ),
            end - start,
        )
        return

    log.info(
        "encode_time_windows: %d windows NVDEC parallel (workers=%d, accurate=%s)",
        len(windows), min(len(windows), n), accurate_seek,
    )
    with tempfile.TemporaryDirectory() as tmp:
        seg_paths: list[str] = []
        work: list[tuple[list[str], float, str]] = []
        for i, (start, end) in enumerate(windows):
            sp = os.path.join(tmp, f"win_{i:04d}.mp4")
            seg_paths.append(sp)
            work.append((
                build_window_encode_cmd(
                    input_path, sp, info, start, end,
                    force_cfr=force_cfr, strip_audio=strip_audio,
                    accurate_seek=accurate_seek,
                ),
                end - start,
                sp,
            ))

        def _run(item: tuple[list[str], float, str]) -> None:
            cmd, dur, path = item
            run_ffmpeg(cmd, dur)
            if not os.path.isfile(path) or os.path.getsize(path) < 32:
                raise RuntimeError(f"encode_time_windows: empty/missing {path}")

        workers = min(len(work), n)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(_run, work))
        for sp in seg_paths:
            if not os.path.isfile(sp) or os.path.getsize(sp) < 32:
                raise RuntimeError(f"encode_time_windows: refusing concat; bad {sp}")
        concat_segments(seg_paths, output_path)


def frame_ranges_to_windows(
    ranges: list[tuple[int, int]],
    fps: float,
) -> list[tuple[float, float]]:
    """Inclusive frame ranges → half-open time windows [t0, t1) seconds."""
    if fps <= 0:
        raise RuntimeError("frame_ranges_to_windows: fps must be > 0")
    out: list[tuple[float, float]] = []
    for start, end in ranges:
        if end < start:
            continue
        out.append((start / fps, (end + 1) / fps))
    return out


def split_long_windows(
    windows: list[tuple[float, float]],
    n: int,
    total_dur: float | None = None,
) -> list[tuple[float, float]]:
    """Split windows longer than ~total/n so a multi-hour keep parallelizes.

    Pure helper (unit-tested). Preserves chronological order.
    """
    n = max(1, n)
    if not windows or n == 1:
        return list(windows)
    if total_dur is None:
        total_dur = sum(b - a for a, b in windows)
    target = (total_dur / n) if n else total_dur
    target = max(target, 1.0)
    out: list[tuple[float, float]] = []
    for a, b in windows:
        dur = b - a
        if n > 1 and dur > target * 1.25:
            t = a
            while t < b - 1e-9:
                u = min(b, t + target)
                if u > t + 1e-6:
                    out.append((t, u))
                t = u
        else:
            out.append((a, b))
    return out


def encode_frame_ranges_nvdec(
    input_path: str,
    output_path: str,
    info: dict,
    ranges: list[tuple[int, int]],
    fps: float,
    *,
    force_cfr: bool = True,
    strip_audio: bool = True,
    n: int | None = None,
) -> None:
    """BWF cleaned encode: frame keep-ranges → NVDEC time windows → concat.

    Detection indexes source frames; under CFR (mezzanine when VFR) timestamps
    agree. Long keeps are split for concurrent NVDEC; short multi-range keeps
    encode each window with accurate seek.
    """
    n = max(1, n or SEGMENT_PARALLEL_N)
    windows = frame_ranges_to_windows(ranges, fps)
    kept_dur = sum(b - a for a, b in windows)
    if should_segment_parallel(kept_dur) or (len(windows) > 1 and kept_dur >= 30):
        # Parallelize long keeps and multi-rally cuts that are worth the overhead.
        windows = split_long_windows(windows, n, kept_dur)
    log.info(
        "encoder: BWF NVDEC ranges (%d windows, %.1fs keep) force_cfr=%s",
        len(windows), kept_dur, force_cfr,
    )
    encode_time_windows(
        input_path, output_path, info, windows,
        force_cfr=force_cfr, strip_audio=strip_audio,
        accurate_seek=True, n=n,
    )


def encode_segment_parallel(input_path: str, output_path: str, info: dict,
                            force_cfr: bool = False,
                            n: int | None = None) -> None:
    """Keyframe-aligned split → concurrent NVDEC/NVENC → concat (FINDINGS ~1.9×).

    If keyframe probe fails or yields no cuts, falls back to single-stream
    encode (equal wall splits are unsafe with -ss-before-i).
    """
    duration = float(info.get("duration") or 0)
    n = n or SEGMENT_PARALLEL_N
    try:
        kfs = _keyframe_times(input_path)
    except Exception as e:  # noqa: BLE001
        log.warning("segment-parallel: keyframe probe failed (%s); single-stream", e)
        kfs = []
    ranges = plan_segment_splits(duration, kfs, n=n)
    if not ranges or len(ranges) <= 1:
        log.info("segment-parallel: falling back to single-stream encode")
        run_ffmpeg(
            build_ffmpeg_cmd(input_path, output_path, info, force_cfr=force_cfr),
            duration,
        )
        return

    log.info("segment-parallel: %d segments over %.1fs", len(ranges), duration)
    encode_time_windows(
        input_path, output_path, info, ranges,
        force_cfr=force_cfr, strip_audio=False, accurate_seek=False, n=n,
    )
