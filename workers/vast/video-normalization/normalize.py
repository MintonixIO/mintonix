"""Provider-neutral video normalization core.

Pure transcode logic with no platform SDK dependency (no runpod, no vastai).
Imported by:
  - server.py      (the FastAPI "model server" the PyWorker proxies to)
  - worker.py      (only indirectly, via the backend)
  - test_handler.py (unit + e2e tests run without any serverless SDK installed)

Normalization target: <=1920x1080, <=30 fps, h264 / yuv420p, AAC audio.
"""

import concurrent.futures
import functools
import json
import logging
import math
import os
import random
import shutil
import subprocess
import threading
import time
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter

log = logging.getLogger("video-normalization")

DOWNLOAD_PROGRESS_INTERVAL_SEC = 5.0
FFMPEG_PROGRESS_INTERVAL_SEC = 10.0

# Single-stream transfers to/from object storage (B2) top out around ~27 MB/s
# regardless of the host link (measured on a 1.2 Gbps host). Parallelism — many
# byte-ranges on download, many multipart parts on upload — is what reaches line
# rate. Tunable via env.
DL_CONNECTIONS = int(os.environ.get("DL_CONNECTIONS", "8"))
UL_CONNECTIONS = int(os.environ.get("UL_CONNECTIONS", "8"))
# S3/B2 require every multipart part except the last to be >= 5 MiB.
MULTIPART_PART_SIZE = int(os.environ.get("MULTIPART_PART_SIZE", str(64 * 1024 * 1024)))
# Thumbnail: a single random frame, scaled to this width (aspect preserved).
THUMBNAIL_WIDTH = int(os.environ.get("THUMBNAIL_WIDTH", "640"))


def _session(pool: int) -> requests.Session:
    """A requests.Session whose connection pool is wide enough for `pool`
    concurrent transfers (default pool_maxsize is 10, which would serialize
    extra threads), with a few retries on transient errors."""
    s = requests.Session()
    adapter = HTTPAdapter(pool_connections=pool, pool_maxsize=pool, max_retries=3)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    return s


def _redact(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc}{parsed.path}"


def _download_stream(url: str, dest: str, sess: requests.Session) -> None:
    """Single-connection streaming download (fallback when the server doesn't
    support Range requests)."""
    t0 = time.time()
    written = 0
    last_emit = 0.0
    with sess.get(url, stream=True, timeout=300) as r:
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
                    pct = (written / total * 100) if total else None
                    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
                    msg = f"download: {written / 1024 / 1024:.1f} MB"
                    if pct is not None:
                        msg += f" ({pct:.1f}%)"
                    log.info(msg + f" @ {speed:.1f} MB/s")
    elapsed = time.time() - t0
    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
    log.info("download(done,single): %d bytes in %.1fs (%.1f MB/s)", written, elapsed, speed)


def download(url: str, dest: str, connections: int | None = None) -> None:
    """Download `url` to `dest`, in parallel byte-ranges when the server
    supports them (S3/B2 presigned GETs do), else a single stream."""
    if url.startswith("file://"):
        src = url[len("file://"):]
        size = os.path.getsize(src)
        log.info("download(local): %s -> %s (%d bytes)", src, dest, size)
        shutil.copy(src, dest)
        return

    connections = connections or DL_CONNECTIONS
    log.info("download(start): %s -> %s (%d conns)", _redact(url), dest, connections)
    sess = _session(connections)

    # Probe size + Range support with a tiny range request.
    total = 0
    ranges_ok = False
    if connections > 1:
        try:
            probe = sess.get(url, headers={"Range": "bytes=0-0"}, stream=True, timeout=60)
            if probe.status_code == 206:
                cr = probe.headers.get("Content-Range", "")  # "bytes 0-0/12345"
                total = int(cr.split("/")[-1]) if "/" in cr else 0
                ranges_ok = total > 0
            probe.close()
        except Exception as e:  # noqa: BLE001
            log.info("download: range probe failed (%s), falling back to single stream", e)

    # Too small to bother splitting, or no Range support -> single stream.
    if not ranges_ok or total < 2 * MULTIPART_PART_SIZE:
        _download_stream(url, dest, sess)
        return

    log.info("download(content-length): %d bytes (%.1f MB), %d ranges",
             total, total / 1024 / 1024, connections)
    with open(dest, "wb") as f:
        f.truncate(total)

    part = math.ceil(total / connections)
    chunks = [(i * part, min((i + 1) * part, total) - 1)
              for i in range(connections) if i * part < total]

    t0 = time.time()
    done = [0]
    last_emit = [0.0]
    lock = threading.Lock()

    def fetch(start: int, end: int) -> None:
        r = sess.get(url, headers={"Range": f"bytes={start}-{end}"}, stream=True, timeout=600)
        r.raise_for_status()
        with open(dest, "r+b") as f:
            f.seek(start)
            for ch in r.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(ch)
                with lock:
                    done[0] += len(ch)
                    now = time.time()
                    if now - last_emit[0] >= DOWNLOAD_PROGRESS_INTERVAL_SEC:
                        last_emit[0] = now
                        el = now - t0
                        sp = (done[0] / el / 1024 / 1024) if el else 0
                        log.info("download: %.1f MB (%.1f%%) @ %.1f MB/s",
                                 done[0] / 1024 / 1024, done[0] / total * 100, sp)

    with concurrent.futures.ThreadPoolExecutor(max_workers=connections) as ex:
        futs = [ex.submit(fetch, s, e) for s, e in chunks]
        for fu in concurrent.futures.as_completed(futs):
            fu.result()  # re-raise the first failure

    elapsed = time.time() - t0
    speed = (total / elapsed / 1024 / 1024) if elapsed else 0
    log.info("download(done): %d bytes in %.1fs (%.1f MB/s, %d conns)",
             total, elapsed, speed, connections)


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
    log.info("upload(done,single): %d bytes in %.1fs (%.1f MB/s)", size, elapsed, speed)


def upload_multipart(local_path: str, spec: dict) -> None:
    """Parallel S3/B2 multipart upload using orchestrator-presigned URLs.

    `spec` carries only presigned URLs — the worker holds no storage
    credentials. Shape:
        { "part_urls": [<presigned UploadPart>, ...],   # 1-based: part_urls[0] is part 1
          "complete_url": <presigned CompleteMultipartUpload>,
          "abort_url":    <presigned AbortMultipartUpload>,   # optional but recommended
          "part_size":    <bytes> }                            # optional; defaults to env
    Uploads parts concurrently, then POSTs the completion XML. On any failure it
    POSTs the abort URL so the incomplete upload doesn't linger (and bill) on B2.
    """
    part_size = int(spec.get("part_size") or MULTIPART_PART_SIZE)
    part_urls = spec["part_urls"]
    complete_url = spec["complete_url"]
    abort_url = spec.get("abort_url")

    size = os.path.getsize(local_path)
    nparts = max(1, math.ceil(size / part_size))
    if nparts > len(part_urls):
        raise RuntimeError(
            f"multipart: output needs {nparts} parts ({size} B / {part_size} B) "
            f"but only {len(part_urls)} presigned part URLs were provided"
        )

    log.info("upload(start,multipart): %d bytes (%.1f MB) -> %s (%d parts x %d MB, %d conns)",
             size, size / 1024 / 1024, _redact(complete_url),
             nparts, part_size // 1024 // 1024, UL_CONNECTIONS)

    sess = _session(UL_CONNECTIONS)
    t0 = time.time()

    def put_part(n: int) -> tuple[int, str]:
        start = (n - 1) * part_size
        length = min(part_size, size - start)
        with open(local_path, "rb") as f:
            f.seek(start)
            data = f.read(length)
        r = sess.put(part_urls[n - 1], data=data, timeout=600)
        r.raise_for_status()
        etag = r.headers.get("ETag")
        if not etag:
            raise RuntimeError(f"multipart: part {n} returned no ETag")
        return n, etag

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=UL_CONNECTIONS) as ex:
            results = list(ex.map(put_part, range(1, nparts + 1)))
        results.sort()
        parts_xml = "".join(
            f"<Part><PartNumber>{n}</PartNumber><ETag>{etag}</ETag></Part>"
            for n, etag in results
        )
        body = f"<CompleteMultipartUpload>{parts_xml}</CompleteMultipartUpload>"
        r = sess.post(complete_url, data=body,
                      headers={"Content-Type": "application/xml"}, timeout=300)
        r.raise_for_status()
        # S3/B2 can return 200 with an <Error> body if completion fails.
        if "<Error>" in r.text:
            raise RuntimeError(f"multipart complete failed: {r.text[:300]}")
    except Exception:
        if abort_url:
            try:
                sess.delete(abort_url, timeout=60)
                log.info("upload(multipart): aborted incomplete upload after failure")
            except Exception as ae:  # noqa: BLE001
                log.warning("upload(multipart): abort failed: %s", ae)
        raise

    elapsed = time.time() - t0
    speed = (size / elapsed / 1024 / 1024) if elapsed else 0
    log.info("upload(done,multipart): %d bytes in %.1fs (%.1f MB/s, %d parts, %d conns)",
             size, elapsed, speed, nparts, UL_CONNECTIONS)


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


# Delivery spec — the single source of truth for the normalization target.
# Both needs_transcode() (does the source already conform?) and
# build_ffmpeg_cmd() (how to make it conform) derive from these.
MAX_LONG_EDGE = 1920
MAX_SHORT_EDGE = 1080
MAX_FPS = 30
TARGET_VCODEC = "h264"
TARGET_PIXFMT = "yuv420p"
TARGET_ACODEC = "aac"


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


def needs_transcode(info: dict) -> bool:
    """True if the source needs re-encoding; False means we can remux with -c copy."""
    ratio = _scale_ratio(info.get("width", 0), info.get("height", 0))
    needs_scale = ratio is None or ratio < 1.0
    needs_fps_cap = (info.get("fps", 0) or 0) > MAX_FPS
    needs_pixfmt = info.get("pixel_fmt", "unknown") != TARGET_PIXFMT
    ac = info.get("audio_codec")
    needs_audio = ac is not None and ac != TARGET_ACODEC
    return (info.get("codec", "unknown") != TARGET_VCODEC
            or needs_scale or needs_fps_cap or needs_pixfmt or needs_audio)


def _video_encoder_args(gpu: bool) -> list[str]:
    """The one h264 encoder configuration, shared by the normalize encode and
    the valid-frames select encode."""
    if gpu:
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq",
                "-rc", "vbr", "-cq", "23", "-b:v", "0"]
    return ["-c:v", "libx264", "-crf", "23", "-preset", "fast"]


def build_ffmpeg_cmd(input_path: str, output_path: str, info: dict,
                     force_cfr: bool = False) -> list[str]:
    """force_cfr skips the remux-copy shortcut and always applies an `fps=`
    filter, so the output is constant-frame-rate: valid-frame extraction
    addresses frames by index and samples the scoreboard by timestamp, which
    only agree under CFR (a remuxed VFR source would desync them)."""
    w, h, fps, audio_codec = info["width"], info["height"], info["fps"], info["audio_codec"]
    src_pixfmt = info.get("pixel_fmt", "")

    if not force_cfr and not needs_transcode(info):
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

    video_enc = _video_encoder_args(gpu)

    # --- video filter chain ---
    ratio = _scale_ratio(w, h)
    needs_scale = ratio is not None and ratio < 1.0
    needs_pixfmt = src_pixfmt not in (TARGET_PIXFMT, "")

    vf_parts: list[str] = []

    # The fps cap operates on the timestamp stream and passes CUDA hwframes
    # through untouched, so it sits ahead of scale_cuda in a full GPU chain
    # exactly as it does for the CPU chain.
    if fps > MAX_FPS:
        vf_parts.append(f"fps={MAX_FPS}")
    elif force_cfr:
        vf_parts.append(f"fps={fps or MAX_FPS}")

    if gpu and has_scale_cuda():
        if needs_scale:
            new_w, new_h = _scaled_dims(w, h, ratio)
            vf_parts.append(f"scale_cuda={new_w}:{new_h}:format=nv12")
        elif needs_pixfmt:
            vf_parts.append("scale_cuda=iw:ih:format=nv12")
    else:
        if needs_scale:
            new_w, new_h = _scaled_dims(w, h, ratio)
            vf_parts.append(f"scale={new_w}:{new_h}")
        vf_parts.append(f"format={TARGET_PIXFMT}")

    # --- audio ---
    if audio_codec is None:
        audio_args = ["-an"]
    elif audio_codec == TARGET_ACODEC:
        audio_args = ["-c:a", "copy"]
    else:
        audio_args = ["-c:a", TARGET_ACODEC, "-b:a", "128k"]

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


def build_valid_frames_cmd(input_path: str, output_path: str,
                           select_expr: str, gpu: bool) -> list[str]:
    """Single-pass select+re-encode: drop every frame outside the keep-ranges
    (valid_frames.build_select_expr), then reset timestamps to be contiguous.
    No audio -- dropping frames desyncs the audio track, and re-deriving
    matching audio cuts is out of scope."""
    vf = f"select='{select_expr}',setpts=N/FRAME_RATE/TB"
    return (
        ["ffmpeg", "-y", "-nostats", "-threads", "0", "-i", input_path, "-vf", vf]
        + _video_encoder_args(gpu)
        + ["-an", "-movflags", "+faststart", "-progress", "pipe:2", output_path]
    )


def validate_valid_frames_request(config, has_destination: bool,
                                  has_manifest: bool) -> str | None:
    """Cheap shape check of a valid-frames request. Runs in server.py (422)
    and at the top of normalize_job, before any download or transcode, so a
    malformed request fails upfront instead of after burning a full GPU
    transcode. Returns an error message, or None when the request is usable.
    Stdlib-only on purpose: server.py calls this without importing
    valid_frames (and its cv2/numpy/paddle weight)."""
    if not isinstance(config, dict):
        return "valid_frames_config must be an object"
    if not has_destination:
        return ("valid_frames_config given but no valid_frames_upload / "
                "valid_frames_upload_url destination")
    if not has_manifest:
        return "valid_frames_config given but no manifest_upload_url"
    corners = config.get("court_corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in corners)):
        return "valid_frames_config.court_corners must be four [x,y] points"
    for key in ("scoreboard_crop", "score_sub_crop"):
        c = config.get(key)
        if not (isinstance(c, dict)
                and all(isinstance(c.get(k), (int, float)) for k in ("x", "y", "w", "h"))):
            return f"valid_frames_config.{key} must be {{x, y, w, h}}"
    if not isinstance(config.get("row_split_y"), (int, float)):
        return "valid_frames_config.row_split_y must be a number"
    names = config.get("player_names")
    if not (isinstance(names, list) and names
            and all(isinstance(n, str) and n.strip() for n in names)):
        # an empty name list/string would compile to a match-everything regex,
        # silently degrading validity to court-only
        return "valid_frames_config.player_names must be a non-empty list of non-empty strings"
    return None


def normalize_job(input_url: str, output_upload_url: str | None = None,
                  output_upload: dict | None = None,
                  thumbnail_upload_url: str | None = None,
                  valid_frames_config: dict | None = None,
                  valid_frames_upload_url: str | None = None,
                  valid_frames_upload: dict | None = None,
                  manifest_upload_url: str | None = None) -> dict:
    """Download -> normalize -> upload. Provider-neutral orchestrator.

    Output destination is either:
      - `output_upload` (dict): parallel multipart upload via presigned URLs, or
      - `output_upload_url` (str): a single presigned PUT (or file:// for local).

    If `thumbnail_upload_url` (a presigned PUT, expecting a `.jpg` key in the
    same directory) is given, a single random JPEG frame of the delivered video
    is uploaded there. The thumbnail is best-effort: a failure is reported in
    the result (`thumbnail_error`) but does not fail the job — the video is the
    deliverable and is already uploaded.

    If `valid_frames_config` (see valid_frames.detect_valid_ranges for its
    shape) is given, the normalized output is further filtered down to only
    its "valid" frames (main court camera visible AND scoreboard present) and
    uploaded to `valid_frames_upload`/`valid_frames_upload_url`, alongside an
    old->new frame-index manifest CSV uploaded to `manifest_upload_url`. This
    is NOT best-effort like the thumbnail: it's the requested deliverable, so
    any failure (bad court_corners/scoreboard_crop, no valid frames found)
    fails the whole job. The request shape is validated before anything is
    downloaded or transcoded.

    Returns the output probe dict plus the source probe and elapsed time.
    Raises on any failure (the caller maps it to an HTTP error / job failure).
    """
    import tempfile

    if valid_frames_config is not None:
        err = validate_valid_frames_request(
            valid_frames_config,
            has_destination=bool(valid_frames_upload or valid_frames_upload_url),
            has_manifest=bool(manifest_upload_url),
        )
        if err:
            raise RuntimeError(err)

    out_redacted = _redact(output_upload["complete_url"]) if output_upload else _redact(output_upload_url)
    log.info("job(start): input=%s output=%s", _redact(input_url), out_redacted)

    t_start = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "source")
        dst = os.path.join(tmp, "normalized.mp4")

        download(input_url, src)

        src_info = probe(src)
        log.info("probe(source): %s gpu=%s", json.dumps(src_info), use_gpu())

        # On a deployed worker (REQUIRE_GPU=1) refuse to transcode on CPU: a
        # libx264 fallback on a rented GPU instance burns credit at a fraction of
        # NVENC speed. Raising here also makes the startup benchmark fail on a
        # GPU-broken host so the autoscaler discards it instead of running jobs
        # on the CPU. Remux-copy jobs (no re-encode) don't need the GPU.
        force_cfr = valid_frames_config is not None
        if (os.environ.get("REQUIRE_GPU") == "1"
                and (needs_transcode(src_info) or force_cfr) and not use_gpu()):
            raise RuntimeError(
                "REQUIRE_GPU=1 but no usable NVIDIA GPU detected — refusing to "
                "transcode on CPU (would waste a rented GPU instance)"
            )

        cmd = build_ffmpeg_cmd(src, dst, src_info, force_cfr=force_cfr)
        if not needs_transcode(src_info) and not force_cfr:
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

        if output_upload:
            upload_multipart(dst, output_upload)
        elif output_upload_url:
            upload(dst, output_upload_url)
        else:
            raise RuntimeError("no output destination (output_upload or output_upload_url)")

        # Best-effort thumbnail, last: the video is already delivered, so a
        # thumbnail hiccup must not sink the job (which would re-run the whole
        # transcode). Report what happened and let the caller decide.
        result: dict = {**dst_info, "source": src_info}
        if thumbnail_upload_url:
            try:
                thumb = os.path.join(tmp, "thumbnail.jpg")
                thumb_info = extract_thumbnail(dst, thumb, dst_info["duration"])
                upload(thumb, thumbnail_upload_url)
                result["thumbnail"] = thumb_info
            except Exception as e:  # noqa: BLE001 — thumbnail is non-fatal
                # Surface ffmpeg/ffprobe stderr when present so the caller can
                # actually diagnose a best-effort failure.
                detail = getattr(e, "stderr", None) or str(e)
                log.warning("thumbnail(failed): %s", detail)
                result["thumbnail"] = None
                result["thumbnail_error"] = detail.strip() if isinstance(detail, str) else str(e)

        if valid_frames_config:
            import valid_frames  # deferred: pulls in cv2/numpy (and paddle at
            # detection time) only when the feature is requested, keeping the
            # core normalize path free of them

            ranges, total_frames = valid_frames.detect_valid_ranges(
                dst, valid_frames_config, fps=dst_info["fps"],
                width=dst_info["width"], height=dst_info["height"],
            )
            manifest = valid_frames.build_frame_manifest(ranges)
            manifest_path = os.path.join(tmp, "frame_manifest.csv")
            valid_frames.write_manifest_csv(manifest, manifest_path)

            vf_path = os.path.join(tmp, "valid_frames.mp4")
            vf_duration = len(manifest) / dst_info["fps"] if dst_info["fps"] else None
            run_ffmpeg(
                build_valid_frames_cmd(
                    dst, vf_path, valid_frames.build_select_expr(ranges), use_gpu()),
                vf_duration,
            )
            vf_info = probe(vf_path)
            log.info("probe(valid_frames): %s", json.dumps(vf_info))

            if valid_frames_upload:
                upload_multipart(vf_path, valid_frames_upload)
            else:
                upload(vf_path, valid_frames_upload_url)
            upload(manifest_path, manifest_upload_url)

            result["valid_frames"] = {
                **vf_info,
                "source_frame_count": total_frames,
                "valid_frame_count": len(manifest),
                "num_ranges": len(ranges),
                "manifest_file_size": os.path.getsize(manifest_path),
            }

        elapsed = round(time.time() - t_start, 1)
        log.info("job(done): elapsed=%ss", elapsed)
        result["elapsed_sec"] = elapsed
        return result


if __name__ == "__main__":
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
            inp.get("valid_frames_config"), inp.get("valid_frames_upload_url"),
            inp.get("valid_frames_upload"), inp.get("manifest_upload_url"),
        )
        print(json.dumps(result, indent=2))
    else:
        sys.exit("usage: python normalize.py '{\"input_url\": \"file://...\", "
                 "\"output_upload_url\": \"file://...\"}'")
