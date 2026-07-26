#!/usr/bin/env python3
"""Run video-det on ds1.mp4, write detections.json, compare to refs, log resources.

Designed for the RTX 5090 (or any CUDA) host with models already on disk.

Example:
  cd /opt/video-det
  python tools/run_ds1_eval.py \\
    --video /data/ds1/ds1.mp4 \\
    --pose-ref /data/ds1/pose.json \\
    --shuttle-ref /data/ds1/shuttle.csv \\
    --out-dir /tmp/ds1_eval
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def _start_gpu_logger(path: Path) -> subprocess.Popen | None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "nvidia-smi",
        "--query-gpu=timestamp,utilization.gpu,utilization.memory,"
        "memory.used,memory.total,power.draw,clocks.sm,temperature.gpu",
        "--format=csv",
        "-l",
        "1",
    ]
    try:
        f = path.open("w", encoding="utf-8")
        return subprocess.Popen(cmd, stdout=f, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        print("nvidia-smi not found; skipping GPU log", file=sys.stderr)
        return None


def _stop_gpu_logger(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
    if proc.stdout:
        try:
            proc.stdout.close()
        except Exception:  # noqa: BLE001
            pass


def _run_detector(video: Path, out_json: Path) -> dict:
    # Defer heavy imports until after GPU logger starts.
    from detect import DetectConfig, VideoDetector

    cfg = DetectConfig.from_env()
    det = VideoDetector.from_config(cfg)
    out_json.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    frame_count = 0
    first = True
    with out_json.open("w", encoding="utf-8") as f:
        f.write('{"job_id":"ds1-eval","frames":[')
        for chunk_results, _done, _total in det.run(video, player_mask=None):
            for fr in chunk_results:
                if not first:
                    f.write(",")
                f.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                first = False
                frame_count += 1
        f.write("]}")
    wall = time.perf_counter() - t0
    return {
        "frame_count": frame_count,
        "wall_sec": wall,
        "fps_e2e": frame_count / wall if wall > 0 else float("nan"),
        "pose_batch": getattr(det, "pose_batch", None),
        "pose_engine": str(cfg.pose_engine),
        "shuttle_ckpt": str(cfg.shuttle_ckpt),
        "reid": cfg.reid_engine is not None,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--pose-ref", type=Path, required=True)
    ap.add_argument("--shuttle-ref", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, default=Path("/tmp/ds1_eval"))
    ap.add_argument("--skip-detect", action="store_true", help="only compare existing detections.json")
    ap.add_argument("--skip-compare", action="store_true")
    args = ap.parse_args(argv)

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    det_path = out / "detections.json"
    metrics_path = out / "metrics.json"
    gpu_log = out / "gpu.csv"
    timing_path = out / "timing.json"

    # Ensure package root on path when invoked as tools/run_ds1_eval.py
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    os.chdir(root)

    timing: dict = {}
    gpu_proc = None
    try:
        if not args.skip_detect:
            if not args.video.is_file():
                print(f"missing video: {args.video}", file=sys.stderr)
                return 1
            print(f"starting detect on {args.video}", flush=True)
            gpu_proc = _start_gpu_logger(gpu_log)
            timing = _run_detector(args.video, det_path)
            timing_path.write_text(json.dumps(timing, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(timing, indent=2), flush=True)
        else:
            if not det_path.is_file():
                print(f"missing {det_path}", file=sys.stderr)
                return 1

        if not args.skip_compare:
            from tools.eval_ds1_compare import evaluate

            m = evaluate(
                detections=det_path,
                pose_ref=args.pose_ref,
                shuttle_ref=args.shuttle_ref,
            )
            m["timing"] = timing or (
                json.loads(timing_path.read_text()) if timing_path.is_file() else {}
            )
            metrics_path.write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(m, indent=2), flush=True)
            hard = m["hard"]
            if not hard["frame_count_ok"] or not hard["frames_contiguous"]:
                return 2
    finally:
        _stop_gpu_logger(gpu_proc)

    print(f"artifacts under {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
