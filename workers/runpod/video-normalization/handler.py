import json
import os
import subprocess
import tempfile
import time
import traceback
from urllib.parse import urlparse

import requests
import runpod
from runpod.serverless.modules.rp_progress import progress_update

log = runpod.RunPodLogger()

DOWNLOAD_PROGRESS_INTERVAL_SEC = 5.0
UPLOAD_PROGRESS_INTERVAL_SEC = 5.0
FFMPEG_PROGRESS_INTERVAL_SEC = 10.0


def _jid(job: dict) -> str | None:
    return job.get("id")


def _progress(job: dict, payload: dict) -> None:
    jid = _jid(job)
    if jid:
        progress_update(job, payload)
    log.info(json.dumps(payload, default=str), jid)


def _redact(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc}{parsed.path}"


def download(url: str, dest: str, job: dict) -> None:
    jid = _jid(job)
    if url.startswith("file://"):
        import shutil
        src = url[len("file://"):]
        size = os.path.getsize(src)
        log.info(f"download(local): {src} -> {dest} ({size} bytes)", jid)
        shutil.copy(src, dest)
        return

    log.info(f"download(start): {_redact(url)} -> {dest}", jid)
    _progress(job, {"phase": "download", "status": "started", "url": _redact(url)})

    t0 = time.time()
    written = 0
    total = 0
    last_emit = 0.0

    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        log.info(f"download(content-length): {total} bytes ({total / 1024 / 1024:.1f} MB)", jid)
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
                    log.info(msg, jid)
                    _progress(job, {
                        "phase": "download",
                        "bytes": written,
                        "total": total,
                        "progress": round(pct, 1) if pct is not None else None,
                        "speed_mbps": round(speed, 1),
                    })

    elapsed = time.time() - t0
    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
    log.info(f"download(done): {written} bytes in {elapsed:.1f}s ({speed:.1f} MB/s)", jid)
    _progress(job, {"phase": "download", "status": "done", "bytes": written, "elapsed_sec": round(elapsed, 1)})


def upload(local_path: str, url: str, job: dict) -> None:
    jid = _jid(job)
    if url.startswith("file://"):
        import shutil
        dst = url[len("file://"):]
        size = os.path.getsize(local_path)
        log.info(f"upload(local): {local_path} -> {dst} ({size} bytes)", jid)
        shutil.copy(local_path, dst)
        return

    size = os.path.getsize(local_path)
    log.info(f"upload(start): {local_path} ({size} bytes, {size / 1024 / 1024:.1f} MB) -> {_redact(url)}", jid)
    _progress(job, {"phase": "upload", "status": "started", "bytes": size, "url": _redact(url)})

    t0 = time.time()
    sent = 0
    last_emit = 0.0

    class _ProgressReader:
        def __init__(self, fp):
            self._fp = fp
        def read(self, n=-1):
            nonlocal sent, last_emit
            chunk = self._fp.read(n)
            if chunk:
                sent += len(chunk)
                now = time.time()
                if now - last_emit >= UPLOAD_PROGRESS_INTERVAL_SEC:
                    last_emit = now
                    elapsed = now - t0
                    mb = sent / 1024 / 1024
                    pct = (sent / size * 100) if size else None
                    speed = (sent / elapsed / 1024 / 1024) if elapsed else 0
                    msg = f"upload: {mb:.1f} MB"
                    if pct is not None:
                        msg += f" ({pct:.1f}%)"
                    msg += f" @ {speed:.1f} MB/s"
                    log.info(msg, jid)
                    _progress(job, {
                        "phase": "upload",
                        "bytes": sent,
                        "total": size,
                        "progress": round(pct, 1) if pct is not None else None,
                        "speed_mbps": round(speed, 1),
                    })
            return chunk

    with open(local_path, "rb") as f:
        resp = requests.put(url, data=_ProgressReader(f), timeout=600)
        resp.raise_for_status()

    elapsed = time.time() - t0
    speed = (size / elapsed / 1024 / 1024) if elapsed else 0
    log.info(f"upload(done): {size} bytes in {elapsed:.1f}s ({speed:.1f} MB/s)", jid)
    _progress(job, {"phase": "upload", "status": "done", "bytes": size, "elapsed_sec": round(elapsed, 1)})


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


def build_ffmpeg_cmd(input_path: str, output_path: str, info: dict) -> list[str]:
    w, h, fps, audio_codec = info["width"], info["height"], info["fps"], info["audio_codec"]

    vf: list[str] = []

    if fps > 30:
        vf.append("fps=30")

    MAX_LONG, MAX_SHORT = 1920, 1080
    long_edge, short_edge = max(w, h), min(w, h)
    scale = min(MAX_LONG / long_edge, MAX_SHORT / short_edge)
    if scale < 1.0:
        new_w = (int(w * scale) // 2) * 2
        new_h = (int(h * scale) // 2) * 2
        vf.append(f"scale={new_w}:{new_h}")

    vf.append("format=yuv420p")

    if audio_codec is None:
        audio_args = ["-an"]
    elif audio_codec == "aac":
        audio_args = ["-c:a", "copy"]
    else:
        audio_args = ["-c:a", "aac", "-b:a", "128k"]

    cmd = [
        "ffmpeg", "-y",
        "-nostats",
        "-threads", "0",
        "-i", input_path,
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "fast",
        "-vf", ",".join(vf),
        *audio_args,
        "-movflags", "+faststart",
        "-progress", "pipe:2",
        output_path,
    ]

    return cmd


def run_ffmpeg(cmd: list[str], job: dict, source_duration: float | None) -> None:
    jid = _jid(job)
    log.info(f"ffmpeg(command): {' '.join(cmd)}", jid)
    _progress(job, {"phase": "transcode", "status": "started"})

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
            if key in ("frame", "fps", "out_time_ms", "out_time_us", "total_size", "speed", "progress"):
                stats[key] = val
                now = time.time()
                is_end = key == "progress" and val == "end"
                if now - last_emit >= FFMPEG_PROGRESS_INTERVAL_SEC or is_end:
                    last_emit = now
                    t_us = int(stats.get("out_time_us", stats.get("out_time_ms", 0)) or 0)
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
                    log.info(msg, jid)
                    _progress(job, {
                        "phase": "transcode",
                        "frame": stats.get("frame"),
                        "fps": stats.get("fps"),
                        "speed": stats.get("speed"),
                        "time_sec": round(t_sec, 1),
                        "progress": round(pct, 1) if pct is not None else None,
                    })

    proc.stderr.close()
    proc.wait()
    rc = proc.returncode
    if rc != 0:
        tail = "".join(stderr_tail[-50:])
        log.error(f"ffmpeg(failed): exit={rc}\n{tail}", jid)
        raise RuntimeError(f"ffmpeg failed (exit {rc}):\n{tail}")

    log.info(f"ffmpeg(done): exit={rc}", jid)
    _progress(job, {"phase": "transcode", "status": "done"})


def handler(job: dict) -> dict:
    jid = _jid(job)
    inp = job["input"]
    input_url = inp["input_url"]
    output_upload_url = inp["output_upload_url"]

    log.info(
        f"job(start): input={_redact(input_url)} output={_redact(output_upload_url)}",
        jid,
    )
    _progress(job, {"phase": "init", "status": "started"})

    t_start = time.time()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source")
            dst = os.path.join(tmp, "normalized.mp4")

            download(input_url, src, job)

            src_info = probe(src)
            log.info(f"probe(source): {json.dumps(src_info)}", jid)
            _progress(job, {"phase": "probe", "status": "done", "source": src_info})

            cmd = build_ffmpeg_cmd(src, dst, src_info)
            run_ffmpeg(cmd, job, src_info["duration"])

            dst_info = probe(dst)
            log.info(f"probe(output): {json.dumps(dst_info)}", jid)
            _progress(job, {"phase": "probe", "status": "done", "output": dst_info})

            upload(dst, output_upload_url, job)

            elapsed = round(time.time() - t_start, 1)
            log.info(f"job(done): elapsed={elapsed}s", jid)
            _progress(job, {"phase": "done", "status": "complete", "elapsed_sec": elapsed})

            return {
                **dst_info,
                "source": src_info,
                "elapsed_sec": elapsed,
            }
    except Exception as e:
        elapsed = round(time.time() - t_start, 1)
        log.error(f"job(failed): {e}\n{traceback.format_exc()}", jid)
        _progress(job, {"phase": "error", "status": "failed", "error": str(e), "elapsed_sec": elapsed})
        raise


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        job = json.loads(sys.argv[1])
        result = handler({"input": job} if "input" not in job else job)
        print(json.dumps(result, indent=2))
    else:
        runpod.serverless.start({"handler": handler})
