#!/usr/bin/env python3
"""Local debug: run the same job pipeline without remote upload.

Not shipped in the production image (.dockerignore includes tools/).

  python tools/debug.py /data/match.mp4 --annotation ./annotation.json
  python tools/debug.py 'https://youtu.be/…' --annotation ./annotation.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import resource
import subprocess
import sys
import threading
import time
from typing import Any

# Allow running as: python tools/debug.py from worker root.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import io_util  # noqa: E402
import normalize  # noqa: E402
from job import run_preprocess_job  # noqa: E402

log = logging.getLogger("video-preprocess.debug")


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


def _load_json(path: str) -> dict:
    with open(path) as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"{path}: expected JSON object")
    return data


def run_debug(
    input_spec: str,
    out_dir: str,
    *,
    annotation: dict,
    sample_interval: float = 0.5,
) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    normalize.require_nvenc()

    body: dict[str, Any] = {
        "request_id": "debug",
        "local_output_dir": os.path.abspath(out_dir),
        "annotation": annotation,
    }

    if io_util.is_youtube_url(input_spec):
        body["input_url"] = input_spec
        path_mode = "bwf"
    else:
        path = os.path.abspath(input_spec)
        if not os.path.isfile(path):
            raise RuntimeError(f"input file not found: {path}")
        body["local_source"] = path
        # No input_url → user path (full encode)
        path_mode = "user"

    log.info(
        "pipeline: start path_mode=%s (sample every %.2fs)",
        path_mode,
        sample_interval,
    )
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

    result = {
        **result,
        "input": input_spec,
        "output_path": os.path.join(out_dir, "normalized.mp4"),
        "preprocess_log_path": os.path.join(out_dir, "preprocess-log.json"),
        "resources": resources,
        "resources_series_path": series_path,
        "note": "local debug via local_source/local_output_dir — no remote upload",
    }
    result_path = os.path.join(out_dir, "result.json")
    with open(result_path, "w") as f:
        json.dump(result, f, indent=2)
    log.info("done: %s", result_path)
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Local video-preprocess debug run")
    p.add_argument("input", help="YouTube URL or local file path")
    p.add_argument(
        "--annotation", required=True,
        help="annotation.json (court.corners[4] + court.net_poles[2])",
    )
    p.add_argument("--out", default="debug-out", help="output directory")
    p.add_argument("--sample-interval", type=float, default=0.5)
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        result = run_debug(
            args.input,
            os.path.abspath(args.out),
            annotation=_load_json(args.annotation),
            sample_interval=args.sample_interval,
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
