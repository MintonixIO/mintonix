"""
Download yolo26x-pose.pt via ultralytics.
Run this on any machine (no GPU required).
"""
from pathlib import Path
from ultralytics import YOLO

MODEL_NAME = "yolo26x-pose.pt"

def main():
    if Path(MODEL_NAME).exists():
        print(f"{MODEL_NAME} already present — skipping download")
    else:
        print(f"Downloading {MODEL_NAME} ...")
        YOLO(MODEL_NAME)

    model = YOLO(MODEL_NAME)
    n_params = sum(p.numel() for p in model.model.parameters())
    print(f"Model:      {MODEL_NAME}")
    print(f"Parameters: {n_params:,}")
    print(f"Task:       {model.task}")
    print(f"Saved at:   {Path(MODEL_NAME).resolve()}")


if __name__ == "__main__":
    main()
