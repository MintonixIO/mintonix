#!/usr/bin/env python3
"""Local debug: run the detect pipeline without remote callback.

Runs a network speedtest first (when applicable), then download → pose +
shuttle → detections.json while sampling CPU / RSS / GPU for the entire run.
Writes efficiency notes comparing download throughput to the speedtest
baseline and detect wall time to source duration.

  python debug.py /data/normalized.mp4
  python debug.py 'https://…/normalized.mp4' --out ./debug-detect
  python debug.py 'https://youtu.be/…' --out ./debug-yt
  python debug.py ./sample.mp4 --skip-speedtest

Requires POSE_ENGINE + SHUTTLE_CKPT on disk (same env as the product server).
YouTube inputs need ``yt-dlp`` installed (``pip install yt-dlp``).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2

import io_util
from detect import DetectConfig, VideoDetector

log = logging.getLogger("video-det.debug")

_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


# ── resource sampling ─────────────────────────────────────────────────────────


def _rss_mb() -> float:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024.0
    except OSError:
        pass
    u = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return u / (1024.0 * 1024.0) if sys.platform == "darwin" else u / 1024.0


def _gpu_sample() -> dict[str, float] | None:
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        util = mem = total = 0.0
        for line in out.stdout.strip().splitlines():
            p = [x.strip() for x in line.split(",")]
            if len(p) < 3:
                continue
            util = max(util, float(p[0]))
            mem = max(mem, float(p[1]))
            total = max(total, float(p[2]))
        return {
            "gpu_util_pct": util,
            "gpu_mem_used_mb": mem,
            "gpu_mem_total_mb": total,
        }
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        return None


class ResourceMonitor:
    """Sample RSS/CPU/GPU every interval_sec for the whole pipeline run."""

    def __init__(self, interval_sec: float = 0.5):
        self.interval = interval_sec
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._t0 = 0.0
        self.series: list[dict[str, Any]] = []
        self._prev_cpu = 0.0
        self._prev_wall = 0.0

    def start(self) -> None:
        self._t0 = time.time()
        self._prev_cpu = time.process_time()
        self._prev_wall = self._t0
        self._sample()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> dict[str, Any]:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        self._sample()
        return self.summary()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            self._sample()

    def _sample(self) -> None:
        now = time.time()
        d_cpu = time.process_time() - self._prev_cpu
        d_wall = now - self._prev_wall
        self._prev_cpu = time.process_time()
        self._prev_wall = now
        row: dict[str, Any] = {
            "t_sec": round(now - self._t0, 3),
            "rss_mb": round(_rss_mb(), 2),
            "cpu_pct": round(100.0 * d_cpu / d_wall, 1) if d_wall > 0 else 0.0,
        }
        g = _gpu_sample()
        if g:
            row["gpu_util_pct"] = round(g["gpu_util_pct"], 1)
            row["gpu_mem_used_mb"] = round(g["gpu_mem_used_mb"], 1)
            row["gpu_mem_total_mb"] = round(g["gpu_mem_total_mb"], 1)
        self.series.append(row)

    def summary(self) -> dict[str, Any]:
        s = self.series
        if not s:
            return {"samples": 0, "peaks": {}, "averages": {}, "series": []}
        peaks = {
            "peak_rss_mb": round(max(x["rss_mb"] for x in s), 1),
            "peak_cpu_pct": round(max(x["cpu_pct"] for x in s), 1),
        }
        averages = {
            "avg_rss_mb": round(sum(x["rss_mb"] for x in s) / len(s), 1),
            "avg_cpu_pct": round(sum(x["cpu_pct"] for x in s) / len(s), 1),
        }
        if any("gpu_util_pct" in x for x in s):
            gu = [x["gpu_util_pct"] for x in s if "gpu_util_pct" in x]
            gm = [x["gpu_mem_used_mb"] for x in s if "gpu_mem_used_mb" in x]
            peaks["peak_gpu_util_pct"] = round(max(gu), 1)
            peaks["peak_gpu_mem_mb"] = round(max(gm), 1)
            averages["avg_gpu_util_pct"] = round(sum(gu) / len(gu), 1)
            averages["avg_gpu_mem_mb"] = round(sum(gm) / len(gm), 1)
        return {
            "samples": len(s),
            "interval_sec": self.interval,
            "peaks": peaks,
            "averages": averages,
            "series": s,
        }


# ── network baseline ──────────────────────────────────────────────────────────


def _find_on_path(*names: str) -> str | None:
    """Locate a binary on PATH, then next to the active interpreter (venv)."""
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    bindir = os.path.dirname(os.path.abspath(sys.executable))
    for name in names:
        cand = os.path.join(bindir, name)
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def run_speedtest() -> dict[str, Any]:
    """Run a public speedtest; return structured result or error dict.

    Tries, in order:
      1. ``speedtest-cli --json``  (pip: speedtest-cli)
      2. ``speedtest --format=json``  (Ookla official CLI)
    """
    cli = _find_on_path("speedtest-cli", "speedtest_cli")
    if cli:
        log.info("speedtest: running %s --json …", cli)
        try:
            out = subprocess.run(
                [cli, "--json"],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if out.returncode == 0 and out.stdout.strip():
                data = json.loads(out.stdout)
                dl = float(data.get("download") or 0) / 1e6
                ul = float(data.get("upload") or 0) / 1e6
                ping = float(data.get("ping") or 0)
                server = data.get("server") or {}
                result = {
                    "tool": "speedtest-cli",
                    "download_mbps": round(dl, 2),
                    "upload_mbps": round(ul, 2),
                    "ping_ms": round(ping, 2),
                    "server": server.get("sponsor") or server.get("name"),
                    "server_country": server.get("country"),
                }
                log.info(
                    "speedtest: download=%.1f Mbps upload=%.1f Mbps ping=%.0f ms (%s)",
                    result["download_mbps"],
                    result["upload_mbps"],
                    result["ping_ms"],
                    result.get("server"),
                )
                return result
            log.warning(
                "speedtest-cli failed: %s", (out.stderr or out.stdout)[:300]
            )
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
            log.warning("speedtest-cli error: %s", e)

    ookla = _find_on_path("speedtest")
    if ookla:
        log.info("speedtest: running %s --format=json …", ookla)
        try:
            out = subprocess.run(
                [ookla, "--format=json", "--accept-license", "--accept-gdpr"],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if out.returncode == 0 and out.stdout.strip():
                data = json.loads(out.stdout)
                dl_bps = float((data.get("download") or {}).get("bandwidth") or 0)
                ul_bps = float((data.get("upload") or {}).get("bandwidth") or 0)
                ping = float((data.get("ping") or {}).get("latency") or 0)
                server = data.get("server") or {}
                result = {
                    "tool": "ookla-speedtest",
                    "download_mbps": round(dl_bps * 8 / 1e6, 2),
                    "upload_mbps": round(ul_bps * 8 / 1e6, 2),
                    "ping_ms": round(ping, 2),
                    "server": server.get("name"),
                    "server_country": server.get("country"),
                }
                log.info(
                    "speedtest: download=%.1f Mbps upload=%.1f Mbps ping=%.0f ms (%s)",
                    result["download_mbps"],
                    result["upload_mbps"],
                    result["ping_ms"],
                    result.get("server"),
                )
                return result
            log.warning(
                "ookla speedtest failed: %s", (out.stderr or out.stdout)[:300]
            )
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
            log.warning("ookla speedtest error: %s", e)

    return {
        "tool": None,
        "error": (
            "no speedtest tool found — install with: "
            "pip install speedtest-cli   OR   install Ookla speedtest CLI"
        ),
    }


# ── probe + efficiency ────────────────────────────────────────────────────────


def _probe_video(path: Path) -> dict[str, Any]:
    """OpenCV probe: size, fps, duration, frame count (best-effort)."""
    size = path.stat().st_size if path.is_file() else 0
    meta: dict[str, Any] = {"file_size": size, "path": str(path)}
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        meta["open_ok"] = False
        return meta
    try:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        meta.update(
            {
                "open_ok": True,
                "width": w,
                "height": h,
                "fps": round(fps, 3) if fps else None,
                "frame_count_hint": n if n > 0 else None,
                "duration": round(n / fps, 3) if fps > 0 and n > 0 else None,
            }
        )
    finally:
        cap.release()
    return meta


def build_efficiency(
    result: dict[str, Any],
    speedtest: dict[str, Any],
    resources: dict[str, Any],
) -> dict[str, Any]:
    """Compare pipeline stage rates to speedtest + resource headroom."""
    st = result.get("stage_timings") or {}
    src = result.get("source") or {}

    download_sec = float(st.get("download_sec") or 0.0)
    detect_sec = float(st.get("detect_sec") or 0.0)
    src_bytes = float(src.get("file_size") or 0)
    src_dur = float(src.get("duration") or 0)
    frame_count = int(result.get("frame_count") or 0)

    eff: dict[str, Any] = {}

    if download_sec > 0 and src_bytes > 0:
        dl_mbps = (src_bytes * 8 / 1e6) / download_sec
        eff["download_mbps"] = round(dl_mbps, 2)
        eff["download_mib"] = round(src_bytes / (1024 * 1024), 1)
        st_dl = speedtest.get("download_mbps")
        if isinstance(st_dl, (int, float)) and st_dl > 0:
            eff["speedtest_download_mbps"] = st_dl
            eff["download_vs_speedtest_pct"] = round(100.0 * dl_mbps / st_dl, 1)
            if dl_mbps < 0.3 * st_dl:
                note = "download << speedtest — source limited, not the NIC"
                if result.get("source_kind") == "youtube":
                    note = (
                        "download << speedtest — yt-dlp/YouTube limited, not the NIC"
                    )
                eff["download_note"] = note
            elif dl_mbps >= 0.7 * st_dl:
                eff["download_note"] = "download near line-rate baseline"
            else:
                eff["download_note"] = "download moderate vs speedtest"

    if detect_sec > 0:
        if src_dur > 0:
            eff["detect_realtime_factor"] = round(src_dur / detect_sec, 2)
            eff["detect_note"] = (
                f"detect {src_dur:.0f}s source in {detect_sec:.1f}s "
                f"({eff['detect_realtime_factor']}× realtime)"
            )
        if frame_count > 0:
            eff["detect_fps"] = round(frame_count / detect_sec, 2)

    out_bytes = float(result.get("output_bytes") or 0)
    if out_bytes > 0 and frame_count > 0:
        eff["json_bytes_per_frame"] = round(out_bytes / frame_count, 1)
        eff["json_mib"] = round(out_bytes / (1024 * 1024), 2)

    peaks = resources.get("peaks") or {}
    averages = resources.get("averages") or {}
    if "avg_gpu_util_pct" in averages:
        avg_g = averages["avg_gpu_util_pct"]
        peak_g = peaks.get("peak_gpu_util_pct")
        eff["gpu_avg_util_pct"] = avg_g
        eff["gpu_peak_util_pct"] = peak_g
        if avg_g < 20 and detect_sec > 5:
            eff["gpu_note"] = (
                "low average GPU util — decode/IO may dominate, or models idle"
            )
        elif avg_g >= 70:
            eff["gpu_note"] = "GPU well utilized during run"
        else:
            eff["gpu_note"] = (
                "moderate GPU util — check pose/shuttle share of wall time"
            )

    if "avg_cpu_pct" in averages:
        eff["cpu_avg_pct"] = averages["avg_cpu_pct"]
        eff["cpu_peak_pct"] = peaks.get("peak_cpu_pct")

    if "peak_rss_mb" in peaks:
        eff["peak_rss_mb"] = peaks["peak_rss_mb"]

    return eff


# ── pipeline ──────────────────────────────────────────────────────────────────


def _redact_url(url: str) -> str:
    """Drop query string from http(s) URLs for logs."""
    if "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    path = rest.split("?", 1)[0]
    return f"{scheme}://{path}"


def is_youtube_url(url: str) -> bool:
    """True for YouTube watch/share hosts (debug-only source kind)."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host in _YOUTUBE_HOSTS


def download_youtube(url: str, dest_dir: str | Path) -> Path:
    """Fetch a YouTube source with yt-dlp into dest_dir; return the file path.

    Debug-only — product detect always receives normalized.mp4 via presign.
    """
    try:
        import yt_dlp
    except ImportError as e:
        raise RuntimeError(
            "YouTube debug download requires yt-dlp — install with: pip install yt-dlp"
        ) from e

    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    last_emit = [0.0]

    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        now = time.monotonic()
        if now - last_emit[0] < 2.0:
            return
        last_emit[0] = now
        got = d.get("downloaded_bytes") or 0
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        pct = f" ({got / total * 100:.1f}%)" if total else ""
        speed = (d.get("speed") or 0) / 1024 / 1024
        log.info(
            "download(youtube): %.1f MB%s @ %.1f MB/s",
            got / 1024 / 1024,
            pct,
            speed,
        )

    # Prefer ≤1080p when available — closer to product normalized.mp4.
    opts: dict[str, Any] = {
        "format": "bv*[height<=1080]+ba/b",
        "merge_output_format": "mkv",
        "outtmpl": {"default": str(dest_dir / "source.%(ext)s")},
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "retries": 5,
        "noplaylist": True,
    }
    # yt-dlp YouTube n-challenge often needs a JS runtime (deno preferred).
    deno = shutil.which("deno") or (
        os.path.expanduser("~/.deno/bin/deno")
        if os.path.isfile(os.path.expanduser("~/.deno/bin/deno"))
        else None
    )
    if deno:
        opts["js_runtimes"] = {"deno": {"path": deno}}

    log.info("download(youtube,start): %s", _redact_url(url))
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    candidates = [
        dest_dir / f
        for f in os.listdir(dest_dir)
        if f.startswith("source.") and not f.endswith(".part")
    ]
    if not candidates:
        raise RuntimeError("yt-dlp reported success but produced no source file")
    path = max(candidates, key=lambda p: p.stat().st_size)
    log.info(
        "download(youtube,done): %s (%.1f MB) in %.1fs",
        path.name,
        path.stat().st_size / 1024 / 1024,
        time.monotonic() - t0,
    )
    return path


def _input_url(spec: str, stage_dir: Path) -> str:
    """Normalize CLI input to a downloadable URL or staged file:// path.

    - YouTube → pass through (yt-dlp in run_detect_job)
    - HTTP(S) → pass through (io_util stream GET)
    - Local / file:// → stage under ``stage_dir`` in /tmp for product allowlist
    """
    if is_youtube_url(spec):
        return spec
    if spec.startswith("http://") or spec.startswith("https://"):
        return spec
    if spec.startswith("file://"):
        path = Path(spec[len("file://") :]).expanduser().resolve()
    else:
        path = Path(spec).expanduser().resolve()
    if not path.is_file():
        raise RuntimeError(f"input file not found: {path}")
    staged = stage_dir / f"input{path.suffix or '.mp4'}"
    if path != staged:
        shutil.copy2(path, staged)
    return "file://" + str(staged.resolve())


def _require_models(cfg: DetectConfig) -> None:
    missing = []
    if not cfg.pose_engine.is_file():
        missing.append(f"POSE_ENGINE={cfg.pose_engine}")
    if not cfg.shuttle_ckpt.is_file():
        missing.append(f"SHUTTLE_CKPT={cfg.shuttle_ckpt}")
    if missing:
        raise RuntimeError(
            "models missing (set POSE_ENGINE / SHUTTLE_CKPT): " + ", ".join(missing)
        )


def _stream_detections_json(
    detector: VideoDetector,
    dest: Path,
    *,
    request_id: str,
    video_path: Path,
) -> int:
    """Same incremental JSON writer as server._stream_detections_json."""
    frame_count = 0
    first = True
    with dest.open("w", encoding="utf-8") as f:
        f.write('{"job_id":')
        f.write(json.dumps(request_id))
        f.write(',"frames":[')
        for chunk_results in detector.run(video_path):
            for fr in chunk_results:
                if not first:
                    f.write(",")
                f.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                first = False
                frame_count += 1
        f.write("]}")
    return frame_count


def run_detect_job(
    *,
    input_url: str,
    output_path: Path,
    detector: VideoDetector,
    request_id: str = "debug",
) -> dict[str, Any]:
    """Download → detect → write detections.json (no callback)."""
    t0 = time.monotonic()
    stage_timings: dict[str, float] = {}

    video_tmp: Path | None = None
    yt_dir: Path | None = None
    source_kind = "youtube" if is_youtube_url(input_url) else "http_or_file"

    try:
        t_dl = time.monotonic()
        if source_kind == "youtube":
            yt_dir = Path(tempfile.mkdtemp(prefix="video-det-yt-", dir="/tmp"))
            video_tmp = download_youtube(input_url, yt_dir)
        else:
            video_fd, video_name = tempfile.mkstemp(suffix=".mp4", dir="/tmp")
            os.close(video_fd)
            video_tmp = Path(video_name)
            io_util.download(input_url, video_tmp)
        stage_timings["download_sec"] = round(time.monotonic() - t_dl, 3)

        source = _probe_video(video_tmp)
        source["kind"] = source_kind

        t_det = time.monotonic()
        frame_count = _stream_detections_json(
            detector,
            output_path,
            request_id=request_id,
            video_path=video_tmp,
        )
        stage_timings["detect_sec"] = round(time.monotonic() - t_det, 3)

        if frame_count == 0:
            raise RuntimeError("no frames decoded from video")

        # Prefer measured frame count for duration when CAP_PROP was empty.
        if not source.get("duration"):
            fps = source.get("fps") or 0
            if fps and frame_count:
                source["duration"] = round(frame_count / float(fps), 3)
        source["frame_count"] = frame_count

        elapsed = round(time.monotonic() - t0, 3)
        stage_timings["total_sec"] = elapsed
        out_bytes = output_path.stat().st_size if output_path.is_file() else 0

        log.info(
            "detect(done): frames=%d elapsed=%.1fs detect=%.1fs kind=%s",
            frame_count,
            elapsed,
            stage_timings["detect_sec"],
            source_kind,
        )
        return {
            "request_id": request_id,
            "status": "ok",
            "frame_count": frame_count,
            "elapsed_sec": elapsed,
            "output_bytes": out_bytes,
            "source_kind": source_kind,
            "source": source,
            "stage_timings": stage_timings,
        }
    finally:
        if yt_dir is not None:
            shutil.rmtree(yt_dir, ignore_errors=True)
        elif video_tmp is not None:
            video_tmp.unlink(missing_ok=True)


def run_debug(
    input_spec: str,
    out_dir: str,
    *,
    sample_interval: float = 0.5,
    skip_speedtest: bool = False,
) -> dict[str, Any]:
    os.makedirs(out_dir, exist_ok=True)
    os.environ["ALLOW_FILE_URLS"] = "1"

    cfg = DetectConfig.from_env()
    _require_models(cfg)
    log.info(
        "models: pose=%s shuttle=%s conf=%s",
        cfg.pose_engine,
        cfg.shuttle_ckpt,
        cfg.conf,
    )

    if skip_speedtest:
        speedtest: dict[str, Any] = {"tool": None, "skipped": True}
        log.info("speedtest: skipped (--skip-speedtest)")
    else:
        speedtest = run_speedtest()
        with open(os.path.join(out_dir, "speedtest.json"), "w") as f:
            json.dump(speedtest, f, indent=2)

    # Stage dir under /tmp so file:// reads stay inside product allowlist.
    stage_dir = Path(tempfile.mkdtemp(prefix="video-det-debug-", dir="/tmp"))
    try:
        input_url = _input_url(input_spec, stage_dir)
        log.info("input_url: %s", _redact_url(input_url))

        log.info("loading VideoDetector …")
        t_load = time.monotonic()
        detector = VideoDetector.from_config(cfg)
        load_sec = round(time.monotonic() - t_load, 3)
        log.info("VideoDetector ready in %.1fs (batch=%d)", load_sec, detector.pose_batch)

        output_path = Path(out_dir).resolve() / "detections.json"

        log.info("pipeline: start (resource sampling every %.2fs)", sample_interval)
        mon = ResourceMonitor(interval_sec=sample_interval)
        mon.start()
        try:
            result = run_detect_job(
                input_url=input_url,
                output_path=output_path,
                detector=detector,
                request_id="debug",
            )
        finally:
            resources = mon.stop()
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)

    result["model_load_sec"] = load_sec
    result["pose_batch"] = detector.pose_batch
    result["config"] = {
        "pose_engine": str(cfg.pose_engine),
        "shuttle_ckpt": str(cfg.shuttle_ckpt),
        "conf": cfg.conf,
    }

    series_path = os.path.join(out_dir, "resources.jsonl")
    with open(series_path, "w") as f:
        for row in resources.get("series") or []:
            f.write(json.dumps(row) + "\n")

    efficiency = build_efficiency(result, speedtest, resources)
    log.info("efficiency: %s", json.dumps(efficiency, sort_keys=True))
    log.info(
        "resources peaks=%s averages=%s",
        resources.get("peaks"),
        resources.get("averages"),
    )

    result = {
        **result,
        "input": input_spec,
        "output_path": str(output_path),
        "speedtest": speedtest,
        "resources": resources,
        "resources_series_path": series_path,
        "efficiency": efficiency,
        "note": "local debug — detect pipeline, no remote upload/callback",
    }
    result_path = os.path.join(out_dir, "result.json")
    with open(result_path, "w") as f:
        json.dump(result, f, indent=2)
    log.info("done: %s", result_path)
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Local detect debug + speedtest + resource monitoring",
    )
    p.add_argument(
        "input",
        help=(
            "normalized.mp4 path, file://, https presigned/public URL, "
            "or YouTube URL (yt-dlp)"
        ),
    )
    p.add_argument("--out", default="debug-out", help="output directory")
    p.add_argument("--sample-interval", type=float, default=0.5)
    p.add_argument(
        "--skip-speedtest",
        action="store_true",
        help="skip network speedtest baseline",
    )
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    try:
        result = run_debug(
            args.input,
            os.path.abspath(args.out),
            sample_interval=args.sample_interval,
            skip_speedtest=args.skip_speedtest,
        )
    except Exception as e:
        log.exception("debug failed: %s", e)
        return 1

    printable = dict(result)
    res = dict(printable.get("resources") or {})
    n = len(res.get("series") or [])
    res["series"] = f"<{n} samples — see resources.jsonl>"
    printable["resources"] = res
    print(json.dumps(printable, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
