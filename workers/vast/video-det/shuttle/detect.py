# -*- coding: utf-8 -*-
"""
Bare-minimum 2D shuttle detection.

Input  : a video file.
Output : a CSV listing every raw detection (all heatmap blobs) per frame, with
         pixel coordinates (in the original video resolution) and confidence.

This is just the neural-network detection stage of the Mintonix pipeline -- no
Kalman tracking, no trajectory smoothing, no candidate filtering. Every frame
may yield zero, one, or several detections; all of them are written out.

Usage:
    python detect.py input.mp4
    python detect.py input.mp4 -o detections.csv --threshold 0.5
"""
import sys
import csv
import argparse
from pathlib import Path

import cv2
import numpy as np
import torch

from model import TrackNetV5

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_CHECKPOINT = PROJECT_ROOT / 'TrackNetV5.pt'

INPUT_H, INPUT_W = 288, 512  # network input resolution (height, width)


def get_device():
    if torch.cuda.is_available():
        return torch.device('cuda')
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cpu')


def _resize_input(img, w, h):
    """Resize a frame (or tile) to the network input size.

    Use INTER_AREA when shrinking: it area-averages instead of point-sampling,
    so a small bright shuttle survives a >3x downscale instead of aliasing away
    frame-to-frame. INTER_LINEAR only when enlarging (tile smaller than input).
    """
    interp = cv2.INTER_AREA if (img.shape[1] >= w and img.shape[0] >= h) \
        else cv2.INTER_LINEAR
    return cv2.resize(img, (w, h), interpolation=interp)


def heatmap_to_detections(heatmap, threshold):
    """Return list of (x, y, conf) blob centroids above `threshold`.

    Coordinates are in the heatmap's own resolution (INPUT_W x INPUT_H).
    """
    h_u8 = (heatmap * 255).astype(np.uint8)
    _, binary = cv2.threshold(h_u8, int(threshold * 255), 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    dets = []
    for c in contours:
        M = cv2.moments(c)
        if M['m00'] > 0:
            cx, cy = M['m10'] / M['m00'], M['m01'] / M['m00']
            iy = int(np.clip(round(cy), 0, heatmap.shape[0] - 1))
            ix = int(np.clip(round(cx), 0, heatmap.shape[1] - 1))
            dets.append((cx, cy, float(heatmap[iy, ix])))
    return dets


def _infer_triplet(model, device, rgb3):
    """Run the network on one (prev, curr, next) RGB triplet -> (3, H, W) heatmaps."""
    img = np.concatenate(rgb3, axis=2)                 # (H, W, 9)
    tensor = (torch.from_numpy(img.transpose(2, 0, 1))
              .float().div(255).unsqueeze(0).to(device))
    with torch.no_grad():
        return model(tensor).squeeze(0).cpu().numpy()  # (3, H, W)


def detect(video_path, model, device, threshold, temporal_avg=False, fuse='mean',
           input_hw=None):
    """Run detection over a video.

    With `temporal_avg=False` (default) the network is stepped in stride-3 blocks:
    each frame is predicted exactly once, in whichever temporal slot (prev/curr/next)
    it happens to land in. This is the original, baseline behavior.

    With `temporal_avg=True` the window slides at stride-1, so every frame is
    predicted three times -- once as prev, once as curr, once as next, in three
    consecutive triplets -- and those heatmaps are fused (`fuse='mean'` or `'max'`)
    before extracting detections. ~3x the forward passes, but it exploits the
    model's temporal head fully and targets recall on weak/blurred frames.

    `input_hw` overrides the network input resolution (default 288x512, the
    checkpoint's training size). Must be divisible by 16 (the head's patch
    size); the model bilinearly interpolates its positional embedding to the
    new grid. Higher res halves the heatmap grid pitch (the 4K localization
    bottleneck) at ~4x conv + ~16x attention cost.
    """
    in_h, in_w = input_hw if input_hw else (INPUT_H, INPUT_W)
    if in_h % 16 or in_w % 16:
        sys.exit(f"Error: input resolution {in_h}x{in_w} not divisible by 16")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        sys.exit(f"Error: could not open video: {video_path}")

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale_x = orig_w / in_w
    scale_y = orig_h / in_h

    rows = []          # (frame_number, x, y, confidence)

    if not temporal_avg:
        frame_idx = 0
        while True:
            r1, f1 = cap.read()
            r2, f2 = cap.read()
            r3, f3 = cap.read()
            if not (r1 and r2 and r3):
                break

            rgb3 = [_resize_input(cv2.cvtColor(f, cv2.COLOR_BGR2RGB), in_w, in_h)
                    for f in (f1, f2, f3)]
            heatmaps = _infer_triplet(model, device, rgb3)

            for i in range(3):
                fi = frame_idx + i
                if fi >= total:
                    continue
                for cx, cy, conf in heatmap_to_detections(heatmaps[i], threshold):
                    rows.append((fi, cx * scale_x, cy * scale_y, conf))

            frame_idx += 3
            print(f"\r  processed {min(frame_idx, total)}/{total} frames", end='', flush=True)

        cap.release()
        print()
        return rows, total

    # Sliding-window temporal averaging (stride-1).
    acc = {}   # frame index -> [fused_heatmap (H,W), contribution_count]

    def finalize(j):
        hm = acc[j][0] / acc[j][1] if fuse == 'mean' else acc[j][0]
        for cx, cy, conf in heatmap_to_detections(hm, threshold):
            rows.append((j, cx * scale_x, cy * scale_y, conf))
        del acc[j]

    buf = []           # last <=3 resized RGB frames (oldest -> newest)
    idx = 0            # index of the most recently read frame
    while True:
        ret, f = cap.read()
        if not ret:
            break
        buf.append(_resize_input(cv2.cvtColor(f, cv2.COLOR_BGR2RGB), in_w, in_h))
        if len(buf) > 3:
            buf.pop(0)
        if len(buf) == 3:
            tstart = idx - 2                            # triplet covers tstart..tstart+2
            heatmaps = _infer_triplet(model, device, buf)
            for k in range(3):
                fj = tstart + k
                if fj >= total:
                    continue
                if fj not in acc:
                    acc[fj] = [np.zeros_like(heatmaps[k]), 0]
                if fuse == 'mean':
                    acc[fj][0] += heatmaps[k]
                else:
                    np.maximum(acc[fj][0], heatmaps[k], out=acc[fj][0])
                acc[fj][1] += 1
            # frame tstart has now received every triplet that can cover it.
            finalize(tstart)
            print(f"\r  processed {min(idx + 1, total)}/{total} frames", end='', flush=True)
        idx += 1

    for j in sorted(acc):                               # trailing 1-2 edge frames
        finalize(j)

    cap.release()
    print()
    return rows, total


def main():
    parser = argparse.ArgumentParser(description="Bare-minimum 2D shuttle detection")
    parser.add_argument('input_video', type=str, help='Path to the input video file')
    parser.add_argument('-o', '--output', type=str, default=None,
                        help='Output CSV path (default: <video>_detections.csv)')
    parser.add_argument('--checkpoint', type=str, default=str(DEFAULT_CHECKPOINT),
                        help='Path to TrackNetV5.pt')
    parser.add_argument('--threshold', type=float, default=0.5,
                        help='Confidence threshold for a heatmap blob (0-1)')
    parser.add_argument('--input-res', type=str, default=None,
                        help='Network input resolution HxW, e.g. 576x1024 '
                             '(default 288x512; must be divisible by 16)')
    args = parser.parse_args()

    video_path = Path(args.input_video)
    if not video_path.exists():
        sys.exit(f"Error: video not found: {video_path}")

    ckpt = Path(args.checkpoint)
    if not ckpt.exists():
        sys.exit(f"Error: checkpoint not found: {ckpt}")

    output_path = Path(args.output) if args.output else \
        video_path.with_name(f'{video_path.stem}_detections.csv')

    device = get_device()
    print(f"Device: {device}")

    model = TrackNetV5()
    model.load_state_dict(torch.load(str(ckpt), map_location='cpu'))
    model.to(device).eval()
    print(f"Loaded checkpoint: {ckpt}")

    print(f"Detecting in: {video_path.name}")
    input_hw = None
    if args.input_res:
        h, w = (int(v) for v in args.input_res.lower().split('x'))
        input_hw = (h, w)
        print(f"Input resolution: {h}x{w}")
    rows, total = detect(video_path, model, device, np.clip(args.threshold, 0.0, 1.0),
                         input_hw=input_hw)

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['frame_number', 'x', 'y', 'confidence'])
        for fi, x, y, conf in rows:
            writer.writerow([fi, f'{x:.2f}', f'{y:.2f}', f'{conf:.4f}'])

    frames_with_det = len({r[0] for r in rows})
    print(f"Done. {len(rows)} detections across {frames_with_det}/{total} frames.")
    print(f"Output: {output_path}")


if __name__ == '__main__':
    main()
