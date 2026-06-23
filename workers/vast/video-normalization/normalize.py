"""Provider-neutral video normalization core.

Pure transcode logic with no platform SDK dependency (no runpod, no vastai).
Imported by:
  - server.py      (the FastAPI "model server" the PyWorker proxies to)
  - worker.py      (only indirectly, via the backend)
  - test_handler.py (unit + e2e tests run without any serverless SDK installed)

Normalization target: <=1920x1080, <=30 fps, h264 / yuv420p, AAC audio.
"""

import json
import logging
import os
import shutil
import subprocess
import time
from urllib.parse import urlparse

import requests

log = logging.getLogger("video-normalization")

DOWNLOAD_PROGRESS_INTERVAL_SEC = 5.0
FFMPEG_PROGRESS_INTERVAL_SEC = 10.0


def _redact(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc}{parsed.path}"


def download(url: str, dest: str) -> None:
    if url.startswith("file://"):
        src = url[len("file://"):]
        size = os.path.getsize(src)
        log.info("download(local): %s -> %s (%d bytes)", src, dest, size)
        shutil.copy(src, dest)
        return

    log.info("download(start): %s -> %s", _redact(url), dest)

    t0 = time.time()
    written = 0
    total = 0
    last_emit = 0.0

    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        log.info("download(content-length): %d bytes (%.1f MB)", total, total / 1024 / 1024)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)
                written += len(chunk)
                now = time.time()
                if now - last_emit >= DOWNLOAD_PROGRESS_INTERVAL_SEC:
                    last_emit = now
                    elapsed = now - t0
                    mb = written / 1024 / 1024
                    pct = (written / total * 100) if total else None
                    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
                    msg = f"download: {mb:.1f} MB"
                    if pct is not None:
                        msg += f" ({pct:.1f}%)"
                    msg += f" @ {speed:.1f} MB/s"
                    log.info(msg)

    elapsed = time.time() - t0
    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
    log.info("download(done): %d bytes in %.1fs (%.1f MB/s)", written, elapsed, speed)


def upload(local_path: str, url: str) -> None:
    if url.startswith("file://"):
        dst = url[len("file://"):]
        size = os.path.getsize(local_path)
        log.info("upload(local): %s -> %s (%d bytes)", local_path, dst, size)
        shutil.copy(local_path, dst)
        return

    size = os.path.getsize(local_path)
    log.info("upload(start): %s (%d bytes, %.1f MB) -> %s",
             local_path, size, size / 1024 / 1024, _redact(url))

    t0 = time.time()
    with open(local_path, "rb") as f:
        resp = requests.put(url, data=f, timeout=1200)
        resp.raise_for_status()

    elapsed = time.time() - t0
    speed = (size / elapsed / 1024 / 1024) if elapsed else 0
    log.info("upload(done): %d bytes in %.1fs (%.1f MB/s)", size, elapsed, speed)


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

    fps = _parse_fps(video["r_frame_rate"])
    if fps == 0.0:
        fps = _parse_fps(video.get("avg_frame_rate", "0/1"))

    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": round(fps, 3),
        "audio_codec": audio["codec_name"] if audio else None,
        "duration": round(float(fmt["duration"]), 3),
        "codec": video["codec_name"],
        "pixel_fmt": video["pix_fmt"],
        "file_size": int(fmt["size"]),
    }


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


_USE_GPU: bool | None = None


def use_gpu() -> bool:
    global _USE_GPU
    if _USE_GPU is None:
        _USE_GPU = _has_gpu()
    return _USE_GPU


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


_HAS_SCALE_CUDA: bool | None = None


def has_scale_cuda() -> bool:
    global _HAS_SCALE_CUDA
    if _HAS_SCALE_CUDA is None:
        _HAS_SCALE_CUDA = _has_gpu_filter("scale_cuda")
    return _HAS_SCALE_CUDA


def needs_transcode(info: dict) -> bool:
    """True if the source needs re-encoding; False means we can remux with -c copy."""
    MAX_LONG, MAX_SHORT = 1920, 1080
    codec = info.get("codec", "unknown")
    long_edge = max(info.get("width", 0), info.get("height", 0))
    short_edge = min(info.get("width", 0), info.get("height", 0))
    needs_scale = min(MAX_LONG / long_edge, MAX_SHORT / short_edge) < 1.0 if long_edge else True
    needs_fps_cap = (info.get("fps", 0) or 0) > 30
    needs_pixfmt = info.get("pixel_fmt", "unknown") != "yuv420p"
    ac = info.get("audio_codec")
    needs_audio = ac is not None and ac != "aac"
    return codec != "h264" or needs_scale or needs_fps_cap or needs_pixfmt or needs_audio


def build_ffmpeg_cmd(input_path: str, output_path: str, info: dict) -> list[str]:
    w, h, fps, audio_codec = info["width"], info["height"], info["fps"], info["audio_codec"]
    src_pixfmt = info.get("pixel_fmt", "")

    if not needs_transcode(info):
        return [
            "ffmpeg", "-y", "-nostats",
            "-threads", "0",
            "-i", input_path,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]

    gpu = use_gpu()

    # --- input options ---
    input_opts = ["-threads", "0"]

    if gpu:
        input_opts += ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-hwaccel_device", "0"]

    input_opts += ["-i", input_path]

    # --- video encoder ---
    if gpu:
        video_enc = [
            "-c:v", "h264_nvenc",
            "-preset", "p4",
            "-tune", "hq",
            "-rc", "vbr",
            "-cq", "23",
            "-b:v", "0",
        ]
    else:
        video_enc = [
            "-c:v", "libx264",
            "-crf", "23",
            "-preset", "fast",
        ]

    # --- video filter chain ---
    MAX_LONG, MAX_SHORT = 1920, 1080
    long_edge, short_edge = max(w, h), min(w, h)
    scale_ratio = min(MAX_LONG / long_edge, MAX_SHORT / short_edge)
    needs_scale = scale_ratio < 1.0
    needs_pixfmt = src_pixfmt not in ("yuv420p", "")

    vf_parts: list[str] = []

    if gpu and has_scale_cuda():
        # fps filter operates on the timestamp stream and passes CUDA hwframes
        # through untouched, so it works ahead of scale_cuda in a full GPU chain.
        if fps > 30:
            vf_parts.append("fps=30")
        if needs_scale:
            new_w = (int(w * scale_ratio) // 2) * 2
            new_h = (int(h * scale_ratio) // 2) * 2
            vf_parts.append(f"scale_cuda={new_w}:{new_h}:format=nv12")
        elif needs_pixfmt:
            vf_parts.append(f"scale_cuda=iw:ih:format=nv12")
    else:
        if fps > 30:
            vf_parts.append("fps=30")
        if needs_scale:
            new_w = (int(w * scale_ratio) // 2) * 2
            new_h = (int(h * scale_ratio) // 2) * 2
            vf_parts.append(f"scale={new_w}:{new_h}")
        vf_parts.append("format=yuv420p")

    # --- audio ---
    if audio_codec is None:
        audio_args = ["-an"]
    elif audio_codec == "aac":
        audio_args = ["-c:a", "copy"]
    else:
        audio_args = ["-c:a", "aac", "-b:a", "128k"]

    cmd = ["ffmpeg", "-y", "-nostats"] + input_opts
    cmd += video_enc
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


def normalize_job(input_url: str, output_upload_url: str) -> dict:
    """Download -> normalize -> upload. Provider-neutral orchestrator.

    Returns the output probe dict plus the source probe and elapsed time.
    Raises on any failure (the caller maps it to an HTTP error / job failure).
    """
    import tempfile

    log.info("job(start): input=%s output=%s", _redact(input_url), _redact(output_upload_url))

    t_start = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "source")
        dst = os.path.join(tmp, "normalized.mp4")

        download(input_url, src)

        src_info = probe(src)
        log.info("probe(source): %s gpu=%s", json.dumps(src_info), use_gpu())

        cmd = build_ffmpeg_cmd(src, dst, src_info)
        if not needs_transcode(src_info):
            log.info("remux(copy): source already matches spec, no re-encode needed")
        else:
            log.info(
                "encoder: %s source: %s pixfmt=%s %s",
                "h264_nvenc" if use_gpu() else "libx264",
                src_info["codec"], src_info["pixel_fmt"],
                "scale_cuda" if use_gpu() and has_scale_cuda() else "scale(CPU)",
            )
        run_ffmpeg(cmd, src_info["duration"])

        dst_info = probe(dst)
        log.info("probe(output): %s", json.dumps(dst_info))

        upload(dst, output_upload_url)

        elapsed = round(time.time() - t_start, 1)
        log.info("job(done): elapsed=%ss", elapsed)

        return {
            **dst_info,
            "source": src_info,
            "elapsed_sec": elapsed,
        }


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if len(sys.argv) > 1:
        job = json.loads(sys.argv[1])
        inp = job.get("input", job)
        result = normalize_job(inp["input_url"], inp["output_upload_url"])
        print(json.dumps(result, indent=2))
    else:
        sys.exit("usage: python normalize.py '{\"input_url\": \"file://...\", "
                 "\"output_upload_url\": \"file://...\"}'")
