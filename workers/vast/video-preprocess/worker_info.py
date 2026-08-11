"""Cheap one-shot worker fingerprint for preprocess-log (no heavy probes)."""

from __future__ import annotations

import os
import platform
import socket
import subprocess
from functools import lru_cache


def _first_line(cmd: list[str], *, timeout: float = 2.0) -> str | None:
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
        if out.returncode != 0:
            return None
        line = (out.stdout or out.stderr or "").strip().splitlines()
        return line[0].strip() if line else None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def _cpu_model() -> str | None:
    try:
        with open("/proc/cpuinfo", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip() or None
    except OSError:
        pass
    return platform.processor() or None


def _mem_total_mb() -> int | None:
    try:
        with open("/proc/meminfo", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    # kB
                    return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def _gpu_info() -> dict | None:
    """One nvidia-smi query — name, driver, uuid, VRAM (fast)."""
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,uuid,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True, text=True, timeout=3,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        gpus = []
        for line in out.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            gpus.append({
                "name": parts[0],
                "driver_version": parts[1],
                "uuid": parts[2],
                "memory_total_mb": int(float(parts[3])),
            })
        if not gpus:
            return None
        return {"count": len(gpus), "gpus": gpus}
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError, ValueError):
        return None


@lru_cache(maxsize=1)
def collect_worker_info() -> dict:
    """Process-cached: identity does not change mid-job."""
    info: dict = {
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "pid": os.getpid(),
    }
    cpu = _cpu_model()
    if cpu:
        info["cpu_model"] = cpu
    mem = _mem_total_mb()
    if mem is not None:
        info["mem_total_mb"] = mem

    # Vast / container env (only when set — keeps log small).
    for env_key, out_key in (
        ("CONTAINER_ID", "container_id"),
        ("VAST_CONTAINERLABEL", "vast_container_label"),
        ("VAST_TCP_PORT_8080", "vast_public_port"),
        ("NVIDIA_VISIBLE_DEVICES", "nvidia_visible_devices"),
        ("CUDA_VISIBLE_DEVICES", "cuda_visible_devices"),
    ):
        val = os.environ.get(env_key)
        if val:
            info[out_key] = val

    ff = _first_line(["ffmpeg", "-version"])
    if ff:
        info["ffmpeg"] = ff
    fp = _first_line(["ffprobe", "-version"])
    if fp:
        info["ffprobe"] = fp

    gpu = _gpu_info()
    if gpu:
        info["gpu"] = gpu

    return info
