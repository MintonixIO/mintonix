"""
Export yolo26x-pose.pt → TensorRT INT8 engine.

MUST be run on the RTX 5090 server — TRT engines are architecture-specific
(Blackwell sm_120) and cannot be built on a different GPU or transferred.

Requirements on server:
  TensorRT >= 10.0, CUDA >= 12.6, ultralytics >= 8.4
  pip install ultralytics tensorrt pycuda

Calibration uses coco8-pose (8 images, auto-downloaded) — enough for a
throughput baseline. For production accuracy, swap data= to a full COCO-pose
split or representative frames from your own video.
"""
import os
import sys
from pathlib import Path
from ultralytics import YOLO

MODEL_PT   = "yolo26x-pose.pt"
BATCH      = int(os.environ.get("POSE_BATCH", "16"))
IMGSZ      = 640
WORKSPACE  = 8      # GB available to TRT optimizer
CALIB_DATA = "/root/datasets/calib_pose.yaml"  # frames extracted from long.mp4 8:58–13:30
USE_INT8   = True


def check_environment():
    import torch
    if not torch.cuda.is_available():
        sys.exit("ERROR: No CUDA GPU detected. Run this on the RTX 5090 server.")

    props = torch.cuda.get_device_properties(0)
    sm = f"sm_{props.major}{props.minor}"
    print(f"GPU:           {props.name}")
    print(f"Compute cap:   {sm}")
    print(f"VRAM:          {props.total_memory / 2**30:.1f} GB")

    try:
        import tensorrt as trt
        print(f"TensorRT:      {trt.__version__}")
    except ImportError:
        sys.exit("ERROR: tensorrt not found. Install: pip install tensorrt")

    if props.major < 9:
        print(
            "WARNING: RTX 5090 is Blackwell (sm_120). "
            "Make sure TRT >= 10.1 is installed for full Blackwell support."
        )


def main():
    check_environment()

    if not Path(MODEL_PT).exists():
        sys.exit(
            f"ERROR: {MODEL_PT} not found. "
            "Run download_model.py first (can be done on any machine)."
        )

    mode = "INT8" if USE_INT8 else "FP16"
    print(f"\nExporting {MODEL_PT} → TensorRT {mode}  (batch={BATCH}, imgsz={IMGSZ})")
    if USE_INT8:
        print("INT8 calibration requires ≥batch calibration images; will take 10-30 min.\n")
    else:
        print("FP16: no calibration needed, ~2-3 min on Blackwell.\n")

    model = YOLO(MODEL_PT)
    export_kwargs = dict(
        format="engine",
        imgsz=IMGSZ,
        batch=BATCH,
        workspace=WORKSPACE,
        simplify=True,
        device=0,
        verbose=True,
    )
    if USE_INT8:
        export_kwargs["int8"] = True
        export_kwargs["data"] = CALIB_DATA
    else:
        export_kwargs["half"] = True

    engine_path = model.export(**export_kwargs)

    print(f"\nEngine saved to: {engine_path}")
    print("Copy the .engine file to the same directory as infer_benchmark.py")


if __name__ == "__main__":
    main()
