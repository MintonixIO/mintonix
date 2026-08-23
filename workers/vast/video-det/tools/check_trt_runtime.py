#!/usr/bin/env python3
"""Fail the image if native TensorRT is not actually loadable.

CI-safe: does not call deserialize_cuda_engine (needs a GPU).
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


def _ldd(path: Path) -> str:
    return subprocess.check_output(["ldd", str(path)], text=True, stderr=subprocess.STDOUT)


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
    missing = [ln.strip() for ln in ldd.splitlines() if "not found" in ln]
    print(ldd)
    if missing:
        print("FAIL: ldd missing deps:\n", "\n".join(missing), file=sys.stderr)
        return 1
    ctypes.CDLL(str(real), mode=ctypes.RTLD_GLOBAL)
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
