"""Delivery encode: ≤1920×1080, ≤30fps, h264/yuv420p. Single-stream NVENC."""

from __future__ import annotations

import json
import logging
import os
import random
import subprocess

log = logging.getLogger("video-preprocess.normalize")

MAX_LONG, MAX_SHORT, MAX_FPS = 1920, 1080, 30


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


_gpu_ok: bool | None = None


def use_gpu() -> bool:
    """True when an NVIDIA device exists and ffmpeg exposes h264_nvenc.

    Cached for the process lifetime — capability does not change mid-job.
    """
    global _gpu_ok
    if _gpu_ok is not None:
        return _gpu_ok
    import glob
    if not glob.glob("/dev/nvidia[0-9]*"):
        _gpu_ok = False
        return False
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=5,
        )
        _gpu_ok = "h264_nvenc" in out.stdout
    except Exception:
        _gpu_ok = False
    return _gpu_ok


def require_nvenc() -> None:
    """Hard-fail without NVIDIA + h264_nvenc (product invariant for this worker)."""
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
    # Default p4 matched baseline quality; override via NVENC_PRESET / NVENC_CQ.
    preset = (os.environ.get("NVENC_PRESET") or "p4").strip() or "p4"
    cq = (os.environ.get("NVENC_CQ") or "23").strip() or "23"
    return [
        "-c:v", "h264_nvenc", "-preset", preset, "-tune", "hq",
        "-rc", "vbr", "-cq", cq, "-b:v", "0",
    ]


def _nvenc_cmd(
    src: str, dst: str, info: dict, *, force_cfr: bool, strip_audio: bool,
    ss: float | None = None, t: float | None = None,
    faststart: bool = True,
) -> list[str]:
    """NVENC encode. Prefer input ``-ss`` so long AV1 prefixes skip decode."""
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "0",
    ]
    if ss is not None:
        cmd += ["-ss", f"{ss:.6f}"]
    cmd += [
        "-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-hwaccel_device", "0",
        "-i", src,
    ]
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
    if faststart:
        cmd += ["-movflags", "+faststart"]
    cmd += [dst]
    return cmd


def encode_full(src: str, dst: str, src_info: dict | None = None) -> dict:
    """Full-timeline delivery encode (or remux-copy when already compliant).

    GPU is still required at job start (see ``require_nvenc``); remux is only
    a fast path when the source already matches the delivery spec.
    """
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


def _concat_copy(paths: list[str], dst: str) -> None:
    """Lossless concat of same-codec MP4 segments."""
    import tempfile

    if not paths:
        raise RuntimeError("no segments to concat")
    if len(paths) == 1:
        import shutil
        shutil.copyfile(paths[0], dst)
        return
    with tempfile.NamedTemporaryFile(
        "w", suffix=".ffconcat", delete=False, encoding="utf-8",
    ) as f:
        f.write("ffconcat version 1.0\n")
        for p in paths:
            esc = p.replace("'", r"'\''")
            f.write(f"file '{esc}'\n")
        list_path = f.name
    try:
        _run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c", "copy", "-movflags", "+faststart", dst,
        ])
    finally:
        try:
            os.unlink(list_path)
        except OSError:
            pass


def _encode_segment(
    src: str,
    dst: str,
    a: int,
    b: int,
    info: dict,
    *,
    fps: float,
    strip_audio: bool,
    faststart: bool,
) -> None:
    """NVENC one keep-range via input seek (decode keep frames only)."""
    log.info("encode_segment: frames=%d-%d (%.2fs)", a, b, (b - a + 1) / fps)
    _run(_nvenc_cmd(
        src, dst, info, force_cfr=True, strip_audio=strip_audio,
        ss=a / fps, t=(b - a + 1) / fps, faststart=faststart,
    ))


def encode_ranges(
    src: str,
    dst: str,
    ranges: list[tuple[int, int]],
    src_info: dict | None = None,
    *,
    strip_audio: bool = False,
) -> dict:
    """Encode keep ranges: one NVENC seek per range, then concat-copy.

    Decodes only keep frames (no hole fill, no span-select). Multiple ranges
    write temp segments without faststart; the final concat adds it once.
    """
    import tempfile

    info = dict(src_info or probe(src))
    require_nvenc()
    fps = float(info.get("fps") or MAX_FPS)
    if fps <= 0:
        raise RuntimeError("invalid fps")
    work = [(a, b) for a, b in ranges if b >= a]
    if not work:
        raise RuntimeError("no ranges to encode")

    kept = sum(b - a + 1 for a, b in work)
    log.info("encode_ranges: ranges=%d kept≈%d", len(work), kept)

    if len(work) == 1:
        a, b = work[0]
        _encode_segment(
            src, dst, a, b, info, fps=fps, strip_audio=strip_audio, faststart=True,
        )
        return probe(dst)

    with tempfile.TemporaryDirectory(prefix="enc-seg-") as tmp:
        parts: list[str] = []
        for i, (a, b) in enumerate(work):
            part = os.path.join(tmp, f"part_{i:04d}.mp4")
            _encode_segment(
                src, part, a, b, info, fps=fps, strip_audio=strip_audio,
                faststart=False,
            )
            parts.append(part)
        _concat_copy(parts, dst)
    return probe(dst)


def build_cfr_mezzanine(src: str, dst: str, src_info: dict) -> dict:
    """VFR → same-res CFR mezzanine before BWF detect."""
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
