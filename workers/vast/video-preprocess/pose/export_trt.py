"""
Export yolo26x-pose.pt → TensorRT engine (research / rebuild helper).

Product bake (see models/MANIFEST.json) is FP16, batch 16, imgsz 640. Defaults
match that; override with POSE_USE_INT8 / POSE_BATCH / POSE_IMGSZ.

Engines are GPU-arch + TensorRT-version specific. Build on a host that matches
the product image (`nvcr.io/nvidia/tensorrt:25.01-py3`) and the target vast GPU
arch (sm_120) — do not copy engines across different TRT versions or compute caps.

Requirements on build host:
  TensorRT matching the product image, CUDA, ultralytics
  pip install ultralytics (do not pip-install tensorrt over the NGC pin)

INT8 calibration (POSE_USE_INT8=1) uses coco8-pose (8 images, auto-downloaded)
— enough for a throughput baseline. For production accuracy, swap data= to a
full COCO-pose split or representative frames from your own video.

Environment (all optional):
  POSE_PT            weights path          (default: yolo26x-pose.pt)
  POSE_BATCH         engine max batch      (default: 16)
  POSE_IMGSZ         square spatial size   (default: 640)
                     Must match runtime letterbox / GpuConsumer imgsz.
  POSE_WORKSPACE_GB  TRT builder workspace (default: 8)
  POSE_CALIB_DATA    INT8 calib dataset    (default: coco8-pose.yaml)
  POSE_USE_INT8      "1" INT8 / "0" FP16   (default: 0)
"""
import os
import sys
from pathlib import Path
from ultralytics import YOLO

MODEL_PT   = os.environ.get("POSE_PT", "yolo26x-pose.pt")
BATCH      = int(os.environ.get("POSE_BATCH", "16"))
IMGSZ      = int(os.environ.get("POSE_IMGSZ", "640"))
WORKSPACE  = int(os.environ.get("POSE_WORKSPACE_GB", "8"))
# Ultralytics auto-downloads coco8-pose if path is a known dataset name.
CALIB_DATA = os.environ.get("POSE_CALIB_DATA", "coco8-pose.yaml")
USE_INT8   = os.environ.get("POSE_USE_INT8", "0") not in ("0", "false", "False")


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
    print(f"Runtime must use matching POSE_IMGSZ={IMGSZ} (or pass imgsz from engine shape).")


if __name__ == "__main__":
    main()
