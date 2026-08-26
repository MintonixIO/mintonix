#!/usr/bin/env python3
"""Fail the image if native TensorRT is not actually loadable.

CI-safe: does not call deserialize_cuda_engine (needs a GPU).

ldd of libnvinfer reports libcuda.so.1 / libnvidia-* as "not found" in the
slim image (host driver is injected at run by nvidia-container-runtime).
Those are expected. Missing cublas / cudnn / cudart is a bake failure.

Import/CDLL may preload a CUDA *stub* from /opt/cuda-stubs (or toolkit stub
dirs) via ctypes. Do not ldconfig stubs into the image — that would beat the
Vast host driver.
"""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
from pathlib import Path

TRT_LIB_DIR = Path(os.environ.get("TRT_LIB_DIR", "/usr/local/lib/trt"))
EXPECTED = os.environ.get("EXPECTED_TRT_VERSION", "").strip()
MANIFEST = Path(os.environ.get("TRT_MANIFEST", "/app/models/MANIFEST.json"))

# glibc / libstdc++ live on the CUDA runtime image; copying them into
# TRT_LIB_DIR (prepended to LD_LIBRARY_PATH) can shadow the distro loader.
_SYSTEM_SO_PREFIXES = (
    "libc.so",
    "libm.so",
    "libdl.so",
    "libpthread.so",
    "librt.so",
    "libgcc_s.so",
    "libstdc++.so",
)

# Kept in the slim closure (not denylisted): nvinfer*, nvonnx*, nvparsers*,
# cudnn*, cublas*, cudart*, nvrtc*, nvJitLink*.
STUB_DIRS = (
    Path(os.environ.get("CUDA_STUB_DIR", "/opt/cuda-stubs")),
    Path("/usr/local/cuda/lib64/stubs"),
    Path("/usr/local/cuda/compat"),
)


def is_builder_only(name: str) -> bool:
    return "builder_resource" in name


def is_driver_lib(name: str) -> bool:
    return name.startswith("libcuda.so") or name.startswith("libnvidia-")


def is_system_lib(name: str) -> bool:
    n = name.lower()
    if n.startswith("ld-linux"):
        return True
    return any(n == p or n.startswith(p + ".") for p in _SYSTEM_SO_PREFIXES)


def skip_copied_lib(name: str) -> bool:
    """True if this SONAME must not be copied into TRT_LIB_DIR."""
    return is_builder_only(name) or is_driver_lib(name) or is_system_lib(name)


def is_expected_ldd_missing(line: str) -> bool:
    """Host-driver NEEDEDs: allowed to be missing at bake / CPU CI."""
    if "not found" not in line:
        return False
    return "libcuda.so" in line or "libnvidia-" in line


def unexpected_ldd_missing(ldd_output: str) -> list[str]:
    return [
        ln.strip()
        for ln in ldd_output.splitlines()
        if "not found" in ln and not is_expected_ldd_missing(ln)
    ]


def _ldd(path: Path) -> str:
    return subprocess.check_output(["ldd", str(path)], text=True, stderr=subprocess.STDOUT)


def preload_cuda_stub() -> str | None:
    """RTLD_GLOBAL-load a stub libcuda for import/CDLL. Not ldconfig."""
    names = ("libcuda.so.1", "libcuda.so")
    candidates: list[Path] = []
    for d in STUB_DIRS:
        if not d.is_dir():
            continue
        for name in names:
            candidates.append(d / name)
        candidates.extend(sorted(d.glob("libcuda.so*")))
    seen: set[Path] = set()
    for p in candidates:
        if p in seen:
            continue
        seen.add(p)
        if not (p.is_file() or p.is_symlink()):
            continue
        try:
            ctypes.CDLL(str(p.resolve()), mode=ctypes.RTLD_GLOBAL)
            return str(p)
        except OSError:
            continue
    return None


def main() -> int:
    so_candidates = sorted(TRT_LIB_DIR.glob("libnvinfer.so*"))
    if not so_candidates:
        print("FAIL: no libnvinfer.so* under", TRT_LIB_DIR, file=sys.stderr)
        return 1
    # Prefer the real file, not a symlink.
    real = None
    for p in so_candidates:
        if p.is_file() and not p.is_symlink() and "builder_resource" not in p.name:
            real = p
            break
    if real is None:
        real = so_candidates[0].resolve()
    if not real.is_file():
        print("FAIL: nvinfer path is not a real file:", real, file=sys.stderr)
        return 1
    ldd = _ldd(real)
    print(ldd)
    unexpected = unexpected_ldd_missing(ldd)
    if unexpected:
        print("FAIL: ldd missing deps:\n", "\n".join(unexpected), file=sys.stderr)
        return 1
    stub = preload_cuda_stub()
    if stub:
        print("preloaded cuda stub", stub)
    try:
        ctypes.CDLL(str(real), mode=ctypes.RTLD_GLOBAL)
    except OSError as e:
        print("FAIL: dlopen nvinfer:", e, file=sys.stderr)
        return 1
    import tensorrt as trt
    ver = trt.__version__
    print("tensorrt.__version__", ver)
    if not ver or ver.startswith("0.0"):
        print("FAIL: tensorrt version is empty/zero — native nvinfer not loaded", file=sys.stderr)
        return 1
    if EXPECTED and ver != EXPECTED:
        print(f"FAIL: tensorrt {ver} != EXPECTED_TRT_VERSION {EXPECTED}", file=sys.stderr)
        return 1
    if MANIFEST.is_file():
        m = json.loads(MANIFEST.read_text())
        pinned = (m.get("trt_version") or "").strip()
        if pinned and pinned != ver:
            print(f"FAIL: MANIFEST trt_version={pinned} but runtime {ver}", file=sys.stderr)
            return 1
    print("check_trt_runtime OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
