#!/usr/bin/env python3
"""Local debug: run the same job pipeline without remote upload.

Runs a network speedtest first (when applicable), then the full pipeline while
sampling CPU / RSS / GPU for the entire run. Writes efficiency notes comparing
download throughput to the speedtest baseline.

  python debug.py /data/match.mp4
  python debug.py 'https://youtu.be/…' --annotation ./annotation.json
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
import threading
import time
from typing import Any
from urllib.parse import urlparse

import io_util
import normalize
from job import run_preprocess_job

log = logging.getLogger("video-preprocess.debug")


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
            capture_output=True, text=True, timeout=2,
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
    # 1) speedtest-cli (Python)
    cli = _find_on_path("speedtest-cli", "speedtest_cli")
    if cli:
        log.info("speedtest: running %s --json …", cli)
        try:
            out = subprocess.run(
                [cli, "--json"],
                capture_output=True, text=True, timeout=180,
            )
            if out.returncode == 0 and out.stdout.strip():
                data = json.loads(out.stdout)
                # speedtest-cli reports bits/s
                dl = float(data.get("download") or 0) / 1e6
                ul = float(data.get("upload") or 0) / 1e6
                ping = float(data.get("ping") or 0)
                server = (data.get("server") or {})
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
                    result["download_mbps"], result["upload_mbps"],
                    result["ping_ms"], result.get("server"),
                )
                return result
            log.warning("speedtest-cli failed: %s", (out.stderr or out.stdout)[:300])
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
            log.warning("speedtest-cli error: %s", e)

    # 2) Ookla speedtest
    ookla = _find_on_path("speedtest")
    if ookla:
        log.info("speedtest: running %s --format=json …", ookla)
        try:
            out = subprocess.run(
                [ookla, "--format=json", "--accept-license", "--accept-gdpr"],
                capture_output=True, text=True, timeout=180,
            )
            if out.returncode == 0 and out.stdout.strip():
                data = json.loads(out.stdout)
                # Ookla: bandwidth in bytes/s
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
                    result["download_mbps"], result["upload_mbps"],
                    result["ping_ms"], result.get("server"),
                )
                return result
            log.warning("ookla speedtest failed: %s", (out.stderr or out.stdout)[:300])
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
            log.warning("ookla speedtest error: %s", e)

    return {
        "tool": None,
        "error": (
            "no speedtest tool found — install with: "
            "pip install speedtest-cli   OR   install Ookla speedtest CLI"
        ),
    }


def build_efficiency(
    result: dict[str, Any],
    speedtest: dict[str, Any],
    resources: dict[str, Any],
) -> dict[str, Any]:
    """Compare pipeline stage rates to speedtest + resource headroom."""
    st = result.get("stage_timings") or {}
    src = result.get("source") or {}
    out = result  # top-level has output fields after job merge

    download_sec = st.get("download_sec") or 0.0
    encode_sec = st.get("encode_sec") or 0.0
    detect_sec = st.get("detect_sec") or 0.0
    src_bytes = float(src.get("file_size") or 0)
    src_dur = float(src.get("duration") or 0)
    out_dur = float(out.get("duration") or 0)

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
                eff["download_note"] = (
                    "download << speedtest — yt-dlp/source limited, not the NIC"
                )
            elif dl_mbps >= 0.7 * st_dl:
                eff["download_note"] = "download near line-rate baseline"
            else:
                eff["download_note"] = "download moderate vs speedtest"

    if encode_sec > 0 and src_dur > 0:
        # realtime factor: wall encode relative to source duration
        eff["encode_realtime_factor"] = round(src_dur / encode_sec, 2)
        eff["encode_note"] = (
            f"encoded {src_dur:.0f}s source in {encode_sec:.1f}s "
            f"({eff['encode_realtime_factor']}× realtime)"
        )
    if detect_sec > 0 and src_dur > 0:
        eff["detect_realtime_factor"] = round(src_dur / detect_sec, 2)
        eff["detect_note"] = (
            f"detect {src_dur:.0f}s source in {detect_sec:.1f}s "
            f"({eff['detect_realtime_factor']}× realtime)"
        )
    if out_dur > 0 and src_dur > 0 and result.get("path") == "bwf":
        eff["bwf_keep_ratio"] = round(out_dur / src_dur, 3)

    peaks = resources.get("peaks") or {}
    averages = resources.get("averages") or {}
    if "avg_gpu_util_pct" in averages:
        avg_g = averages["avg_gpu_util_pct"]
        peak_g = peaks.get("peak_gpu_util_pct")
        eff["gpu_avg_util_pct"] = avg_g
        eff["gpu_peak_util_pct"] = peak_g
        if avg_g < 20 and encode_sec > 5:
            eff["gpu_note"] = (
                "low average GPU util — encode may be CPU/IO bound or remux-copy"
            )
        elif avg_g >= 70:
            eff["gpu_note"] = "GPU well utilized during run"
        else:
            eff["gpu_note"] = "moderate GPU util — check if encode was active most of the time"

    if "avg_cpu_pct" in averages:
        eff["cpu_avg_pct"] = averages["avg_cpu_pct"]
        eff["cpu_peak_pct"] = peaks.get("peak_cpu_pct")

    return eff


# ── run ───────────────────────────────────────────────────────────────────────


def _load_json(path: str) -> dict:
    with open(path) as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"{path}: expected JSON object")
    return data


def _input_url(spec: str) -> str:
    if io_util.is_youtube_url(spec):
        return spec
    if spec.startswith("file://"):
        return spec
    path = os.path.abspath(spec)
    if not os.path.isfile(path):
        raise RuntimeError(f"input file not found: {path}")
    return "file://" + path


def run_debug(
    input_spec: str,
    out_dir: str,
    *,
    annotation: dict | None = None,
    roster: dict | None = None,
    sample_interval: float = 0.5,
    skip_speedtest: bool = False,
) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    os.environ["ALLOW_FILE_URLS"] = "1"

    # Fail before speedtest/download if this host has no usable GPU.
    normalize.require_nvenc()
    log.info("gpu: h264_nvenc available — proceeding")

    # Network baseline before the pipeline (especially useful for YouTube).
    if skip_speedtest:
        speedtest: dict[str, Any] = {"tool": None, "skipped": True}
        log.info("speedtest: skipped (--skip-speedtest)")
    else:
        speedtest = run_speedtest()
        with open(os.path.join(out_dir, "speedtest.json"), "w") as f:
            json.dump(speedtest, f, indent=2)

    body: dict[str, Any] = {
        "request_id": "debug",
        "input_url": _input_url(input_spec),
        "output_upload_url": "file://" + os.path.join(out_dir, "normalized.mp4"),
    }
    if annotation is not None:
        body["annotation"] = annotation
    if roster is not None:
        body["roster"] = roster

    log.info("pipeline: start (resource sampling every %.2fs)", sample_interval)
    mon = ResourceMonitor(interval_sec=sample_interval)
    mon.start()
    try:
        result = run_preprocess_job(body)
    finally:
        resources = mon.stop()

    series_path = os.path.join(out_dir, "resources.jsonl")
    with open(series_path, "w") as f:
        for row in resources.get("series") or []:
            f.write(json.dumps(row) + "\n")

    efficiency = build_efficiency(result, speedtest, resources)
    log.info("efficiency: %s", json.dumps(efficiency, sort_keys=True))
    log.info("resources peaks=%s averages=%s", resources.get("peaks"), resources.get("averages"))

    result = {
        **result,
        "input": input_spec,
        "output_path": os.path.join(out_dir, "normalized.mp4"),
        "speedtest": speedtest,
        "resources": resources,
        "resources_series_path": series_path,
        "efficiency": efficiency,
        "note": "local debug — pipeline via job.py, no remote upload",
    }
    result_path = os.path.join(out_dir, "result.json")
    with open(result_path, "w") as f:
        json.dump(result, f, indent=2)
    log.info("done: %s", result_path)
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Local preprocess debug + speedtest + resource monitoring",
    )
    p.add_argument("input", help="YouTube URL, file://, or local path")
    p.add_argument(
        "--annotation",
        help="annotation.json (required for BWF; court.corners + player names)",
    )
    p.add_argument("--roster", help="optional roster JSON if labels lack names")
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
            annotation=_load_json(args.annotation) if args.annotation else None,
            roster=_load_json(args.roster) if args.roster else None,
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
    if isinstance(printable.get("bwf"), dict):
        b = dict(printable["bwf"])
        if "frame_map" in b:
            b["frame_map"] = f"<{len(b['frame_map'])} ranges>"

        printable["bwf"] = b
    print(json.dumps(printable, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
