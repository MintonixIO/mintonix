"""Delivery encode: ≤1920×1080, ≤30fps, h264/yuv420p. Single-stream NVENC."""

from __future__ import annotations

import json
import logging
import os
import random
import subprocess
import tempfile

log = logging.getLogger("video-preprocess.normalize")

MAX_LONG, MAX_SHORT, MAX_FPS = 1920, 1080, 30

# One linear decode + select when range count is in this band.
_SINGLE_PASS_MIN_RANGES = 2
_SINGLE_PASS_MAX_RANGES = 500
_SINGLE_PASS_MAX_EXPR = 100_000
# Skip span head/tail trim when the saved amount is tiny.
_SPAN_MIN_SKIP_SEC = 1.0


def _run(cmd: list[str]) -> None:
    log.info("ffmpeg: %s", " ".join(cmd))
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({p.returncode}):\n{(p.stderr or '')[-2000:]}")


def _parse_fps(s: str) -> float:
    if "/" in s:
        a, b = s.split("/", 1)
        return float(a) / float(b) if float(b) else 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(out.stdout)
    video = next(
        s for s in data["streams"]
        if s["codec_type"] == "video"
        and not s.get("disposition", {}).get("attached_pic", 0)
    )
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    r = _parse_fps(video.get("r_frame_rate", "0/1"))
    avg = _parse_fps(video.get("avg_frame_rate", "0/1"))
    fps = r if r > 0 else avg
    is_vfr = bool(r > 0 and avg > 0 and abs(r - avg) / max(r, avg) > 0.02)
    duration = float(data["format"].get("duration") or video.get("duration") or 0)
    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": round(fps, 3),
        "duration": round(duration, 3),
        "codec": video["codec_name"],
        "pixel_fmt": video.get("pix_fmt"),
        "audio_codec": audio["codec_name"] if audio else None,
        "file_size": int(data["format"].get("size") or 0),
        "is_vfr": is_vfr,
    }


def is_vfr(info: dict) -> bool:
    return bool(info.get("is_vfr"))


def delivery_fps(src_fps: float) -> float:
    if not src_fps or src_fps <= 0:
        return float(MAX_FPS)
    return float(min(src_fps, MAX_FPS))


def use_gpu() -> bool:
    import glob
    if not glob.glob("/dev/nvidia[0-9]*"):
        return False
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=5,
        )
        return "h264_nvenc" in out.stdout
    except Exception:
        return False


def require_nvenc() -> None:
    """Hard-fail without an NVIDIA device + ffmpeg h264_nvenc."""
    import glob
    if not glob.glob("/dev/nvidia[0-9]*"):
        raise RuntimeError("no NVIDIA GPU present (/dev/nvidia*) — refusing to run")
    if not use_gpu():
        raise RuntimeError(
            "NVIDIA GPU present but ffmpeg has no h264_nvenc — refusing to run"
        )


def _needs_transcode(info: dict) -> bool:
    w, h = info["width"], info["height"]
    long_e, short_e = max(w, h), min(w, h)
    needs_scale = long_e > MAX_LONG or short_e > MAX_SHORT
    needs_fps = (info.get("fps") or 0) > MAX_FPS
    needs_pix = (info.get("pixel_fmt") or "") != "yuv420p"
    ac = info.get("audio_codec")
    needs_a = ac is not None and ac != "aac"
    return info.get("codec") != "h264" or needs_scale or needs_fps or needs_pix or needs_a


def _scale_parts(info: dict, *, force_cfr: bool, use_cuda_scale: bool) -> list[str]:
    """Scale/fps filter pieces. CUDA scale only when frames stay on GPU."""
    w, h, fps = info["width"], info["height"], info.get("fps") or MAX_FPS
    long_e, short_e = max(w, h), min(w, h)
    ratio = min(MAX_LONG / long_e, MAX_SHORT / short_e) if long_e else 1.0
    parts: list[str] = []
    if fps > MAX_FPS:
        parts.append(f"fps={MAX_FPS}")
    elif force_cfr:
        parts.append(f"fps={fps:g}")
    if ratio < 1.0:
        nw, nh = (int(w * ratio) // 2) * 2, (int(h * ratio) // 2) * 2
        if use_cuda_scale:
            parts.append(f"scale_cuda={nw}:{nh}:format=nv12")
        else:
            parts.append(f"scale={nw}:{nh}:flags=bicubic")
    elif (info.get("pixel_fmt") or "") != "yuv420p":
        if use_cuda_scale:
            parts.append("scale_cuda=iw:ih:format=nv12")
        else:
            parts.append("format=yuv420p")
    return parts


def _scale_vf(info: dict, force_cfr: bool) -> str:
    return ",".join(_scale_parts(info, force_cfr=force_cfr, use_cuda_scale=True))


def _nvenc_args() -> list[str]:
    return [
        "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq",
        "-rc", "vbr", "-cq", "23", "-b:v", "0",
    ]


def _nvenc_cmd(
    src: str, dst: str, info: dict, *, force_cfr: bool, strip_audio: bool,
    ss: float | None = None, t: float | None = None,
    input_seek: bool = True,
) -> list[str]:
    """Build NVENC encode command.

    When ``ss`` is set, prefer **input seek** (``-ss`` before ``-i``) so ffmpeg
    can skip to a keyframe without decoding the whole prefix. Critical for
    long AV1 sources with many range cuts.
    """
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "0",
    ]
    if input_seek and ss is not None:
        cmd += ["-ss", f"{ss:.6f}"]
    cmd += [
        "-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-hwaccel_device", "0",
        "-i", src,
    ]
    if not input_seek and ss is not None:
        cmd += ["-ss", f"{ss:.6f}"]
    if t is not None:
        cmd += ["-t", f"{t:.6f}"]
    cmd += _nvenc_args()
    vf = _scale_vf(info, force_cfr)
    if vf:
        cmd += ["-vf", vf]
    if strip_audio or not info.get("audio_codec"):
        cmd += ["-an"]
    else:
        cmd += ["-c:a", "aac", "-b:a", "128k"]
    cmd += ["-movflags", "+faststart", dst]
    return cmd


def encode_full(src: str, dst: str, src_info: dict | None = None) -> dict:
    info = src_info or probe(src)
    force_cfr = is_vfr(info)
    if not force_cfr and not _needs_transcode(info):
        _run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", src, "-c", "copy", "-movflags", "+faststart", dst,
        ])
    else:
        require_nvenc()
        _run(_nvenc_cmd(src, dst, info, force_cfr=force_cfr, strip_audio=False))
    return probe(dst)


def _select_expr(ranges: list[tuple[int, int]]) -> str:
    """ffmpeg select expression: keep inclusive frame indices (stream-local n)."""
    # between(n,a,b) is inclusive; escape commas for -vf filtergraph.
    return "+".join(f"between(n\\,{a}\\,{b})" for a, b in ranges)


def _span_window(
    ranges: list[tuple[int, int]],
) -> tuple[int, int, list[tuple[int, int]]]:
    """Bounding window over keep ranges + ranges rebased to window start.

    Returns ``(start_frame, end_frame, relative_ranges)`` where
    ``relative_ranges`` use frame indices with 0 == ``start_frame`` (inclusive
    source indices).
    """
    start_f = min(a for a, _b in ranges)
    end_f = max(b for _a, b in ranges)
    rel = [(a - start_f, b - start_f) for a, b in ranges]
    return start_f, end_f, rel


def _can_single_pass(ranges: list[tuple[int, int]]) -> bool:
    n = len(ranges)
    if n < _SINGLE_PASS_MIN_RANGES or n > _SINGLE_PASS_MAX_RANGES:
        return False
    expr = _select_expr(ranges)
    return len(expr) <= _SINGLE_PASS_MAX_EXPR


def _encode_ranges_single_pass(
    src: str,
    dst: str,
    ranges: list[tuple[int, int]],
    info: dict,
    *,
    strip_audio: bool,
) -> None:
    """One linear decode over the keep span: select → setpts → NVENC.

    Decodes only ``[first_keep, last_keep]`` (input ``-ss`` + ``-t``) with
    ``select`` indices rebased into that window. Skips long intros/outros.
    """
    fps = float(info.get("fps") or MAX_FPS)
    out_fps = delivery_fps(fps)
    start_f, end_f, rel_ranges = _span_window(ranges)
    src_dur = float(info.get("duration") or 0.0)
    src_frames_est = (
        int(round(src_dur * fps)) if src_dur > 0 and fps > 0 else end_f + 1
    )

    head_sec = start_f / fps if fps > 0 else 0.0
    tail_sec = (
        max(0.0, src_dur - (end_f + 1) / fps)
        if src_dur > 0 and fps > 0
        else 0.0
    )
    use_span = head_sec >= _SPAN_MIN_SKIP_SEC or tail_sec >= _SPAN_MIN_SKIP_SEC

    if use_span:
        select_ranges = rel_ranges
        span_frames = end_f - start_f + 1
        ss = start_f / fps
        t_dur = span_frames / fps
    else:
        select_ranges = ranges
        ss = None
        t_dur = None
        span_frames = src_frames_est

    parts = [
        f"select='{_select_expr(select_ranges)}'",
        "setpts=N/FRAME_RATE/TB",
    ]
    scale_parts = _scale_parts(info, force_cfr=True, use_cuda_scale=False)
    scale_parts = [p for p in scale_parts if not p.startswith("fps=")]
    scale_parts.insert(0, f"fps={out_fps:g}")
    parts.extend(scale_parts)
    if not any(p.startswith("scale=") or p.startswith("format=") for p in parts):
        parts.append("format=yuv420p")
    vf = ",".join(parts)

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "0",
    ]
    if ss is not None and ss > 0:
        cmd += ["-ss", f"{ss:.6f}"]
    cmd += [
        "-hwaccel", "cuda", "-hwaccel_device", "0",
        "-i", src,
    ]
    if t_dur is not None:
        cmd += ["-t", f"{t_dur:.6f}"]
    cmd += ["-vf", vf, *_nvenc_args()]
    if strip_audio or not info.get("audio_codec"):
        cmd += ["-an"]
    else:
        cmd += ["-c:a", "aac", "-b:a", "128k"]
    cmd += ["-movflags", "+faststart", dst]

    kept = sum(b - a + 1 for a, b in ranges)
    if use_span:
        log.info(
            "encode_ranges: span-trim n_ranges=%d kept≈%d "
            "span_frames=%d (src≈%d) skip_head=%.1fs skip_tail=%.1fs",
            len(ranges), kept, span_frames, src_frames_est, head_sec, tail_sec,
        )
    else:
        log.info(
            "encode_ranges: full-timeline n_ranges=%d kept≈%d",
            len(ranges), kept,
        )
    _run(cmd)


def _encode_ranges_segmented(
    src: str,
    dst: str,
    ranges: list[tuple[int, int]],
    info: dict,
    *,
    strip_audio: bool,
    fps: float,
) -> None:
    """Fallback: one NVENC process per range with input ``-ss`` seek."""
    with tempfile.TemporaryDirectory() as tmp:
        segs: list[str] = []
        for i, (a, b) in enumerate(ranges):
            seg = os.path.join(tmp, f"s{i:04d}.mp4")
            _run(_nvenc_cmd(
                src, seg, info, force_cfr=True, strip_audio=strip_audio,
                ss=a / fps, t=(b - a + 1) / fps, input_seek=True,
            ))
            segs.append(seg)
        if len(segs) == 1:
            os.replace(segs[0], dst)
            return
        list_path = os.path.join(tmp, "list.txt")
        with open(list_path, "w") as f:
            for p in segs:
                f.write(f"file '{p}'\n")
        _run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c", "copy", "-movflags", "+faststart", dst,
        ])


def encode_ranges(
    src: str,
    dst: str,
    ranges: list[tuple[int, int]],
    src_info: dict | None = None,
    *,
    strip_audio: bool = True,
) -> dict:
    """Encode keep ranges: span-trim single-pass select + NVENC (best one-shot)."""
    info = dict(src_info or probe(src))
    require_nvenc()
    fps = float(info.get("fps") or MAX_FPS)
    if fps <= 0:
        raise RuntimeError("invalid fps")
    work = [(a, b) for a, b in ranges if b >= a]
    if not work:
        raise RuntimeError("no ranges to encode")

    if len(work) == 1:
        a, b = work[0]
        log.info("encode_ranges: single segment frames=%d-%d", a, b)
        _run(_nvenc_cmd(
            src, dst, info, force_cfr=True, strip_audio=strip_audio,
            ss=a / fps, t=(b - a + 1) / fps, input_seek=True,
        ))
        return probe(dst)

    if _can_single_pass(work):
        try:
            _encode_ranges_single_pass(
                src, dst, work, info, strip_audio=strip_audio,
            )
            return probe(dst)
        except Exception as e:  # noqa: BLE001
            log.warning("encode_ranges: single-pass failed (%s); segmented", e)

    log.info("encode_ranges: segmented n_ranges=%d", len(work))
    _encode_ranges_segmented(
        src, dst, work, info, strip_audio=strip_audio, fps=fps,
    )
    return probe(dst)


def build_cfr_mezzanine(src: str, dst: str, src_info: dict) -> dict:
    """VFR → same-res CFR mezzanine (job path only; not BWF range encode)."""
    require_nvenc()
    fps = src_info.get("fps") or MAX_FPS
    vf = f"fps={fps:g}"
    if (src_info.get("pixel_fmt") or "") != "yuv420p":
        vf += ",scale_cuda=iw:ih:format=nv12"
    _run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-hwaccel_device", "0",
        "-i", src,
        *_nvenc_args(),
        "-vf", vf, "-an", "-movflags", "+faststart", dst,
    ])
    return probe(dst)


def extract_thumbnail(video_path: str, dest_path: str, duration: float) -> dict:
    ts = random.uniform(0.05, 0.95) * duration if duration > 0 else 0.0
    _run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{ts:.3f}", "-i", video_path,
        "-frames:v", "1", "-vf", "scale='min(640,iw)':-2",
        "-q:v", "2", dest_path,
    ])
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", dest_path],
        capture_output=True, text=True, check=True,
    )
    s = json.loads(out.stdout)["streams"][0]
    return {
        "width": int(s["width"]),
        "height": int(s["height"]),
        "file_size": os.path.getsize(dest_path),
        "timestamp_sec": round(ts, 3),
    }
