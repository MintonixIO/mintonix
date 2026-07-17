#!/usr/bin/env python3
"""Overlay pose + shuttle detections onto a match video for quality review.

Reads product `detections.json` (job_id + frames[]) and draws:
  - pose: COCO-17 skeleton, keypoints, bbox, conf / player_id
  - shuttle: top-K peaks as colored rings (rank-coded), conf labels

Coords in detections.json are normalized [0,1] of the source frame.

Examples:
  # 30s preview mid-match at full fps
  python tools/visualize_detections.py \\
    --video tmp/vis/normalized.mp4 \\
    --detections tmp/vis/detections.json \\
    --start 30000 --end 30900 \\
    --out tmp/vis/preview_30s.mp4

  # every 10th frame of first 2 minutes
  python tools/visualize_detections.py \\
    --video tmp/vis/normalized.mp4 \\
    --detections tmp/vis/detections.json \\
    --start 0 --end 3600 --stride 10 \\
    --out tmp/vis/sparse.mp4

  # also dump a few PNGs
  python tools/visualize_detections.py ... --png-dir tmp/vis/frames --png-every 30
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

# COCO-17 skeleton edges (0-indexed)
SKELETON = [
    (15, 13),
    (13, 11),
    (16, 14),
    (14, 12),
    (11, 12),
    (5, 11),
    (6, 12),
    (5, 6),
    (5, 7),
    (6, 8),
    (7, 9),
    (8, 10),
    (1, 2),
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    (3, 5),
    (4, 6),
]

# Distinct BGR colors for multi-person
PERSON_COLORS = [
    (0, 220, 0),
    (255, 160, 0),
    (0, 165, 255),
    (255, 0, 200),
    (0, 255, 255),
    (180, 105, 255),
]

# Shuttle rank colors (best → worst), BGR
SHUTTLE_COLORS = [
    (0, 0, 255),  # red = top conf
    (0, 128, 255),
    (0, 200, 255),
    (0, 255, 255),
    (0, 255, 128),
    (255, 200, 0),
    (200, 200, 200),
    (150, 150, 150),
]


def load_detections(path: Path) -> dict[int, dict]:
    """Load detections.json → {frame_idx: frame_dict}."""
    t0 = time.perf_counter()
    print(f"loading {path} …", flush=True)
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    frames = data.get("frames", data if isinstance(data, list) else [])
    by_idx: dict[int, dict] = {}
    for fr in frames:
        by_idx[int(fr["frame"])] = fr
    print(
        f"  job_id={data.get('job_id')!r}  frames={len(by_idx)}  "
        f"load={time.perf_counter() - t0:.1f}s",
        flush=True,
    )
    return by_idx


def _xy(norm_x: float, norm_y: float, w: int, h: int) -> tuple[int, int]:
    return int(round(float(norm_x) * w)), int(round(float(norm_y) * h))


def draw_poses(
    img: np.ndarray,
    poses: list[dict],
    *,
    kpt_conf: float,
    thickness: int,
) -> None:
    h, w = img.shape[:2]
    for pi, pose in enumerate(poses):
        color = PERSON_COLORS[pi % len(PERSON_COLORS)]
        kpts = pose.get("keypoints") or []
        bbox = pose.get("bbox")
        conf = float(pose.get("conf", 0.0))
        pid = pose.get("player_id")

        if bbox and len(bbox) == 4:
            x1, y1 = _xy(bbox[0], bbox[1], w, h)
            x2, y2 = _xy(bbox[2], bbox[3], w, h)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)
            label = f"p{pi} {conf:.2f}"
            if pid is not None:
                label += f" id={pid}"
            cv2.putText(
                img,
                label,
                (x1, max(16, y1 - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2,
                cv2.LINE_AA,
            )

        pts: list[tuple[int, int] | None] = []
        for k in kpts:
            if not k or len(k) < 3:
                pts.append(None)
                continue
            kx, ky, kc = float(k[0]), float(k[1]), float(k[2])
            if kc < kpt_conf:
                pts.append(None)
            else:
                pts.append(_xy(kx, ky, w, h))

        for a, b in SKELETON:
            if a < len(pts) and b < len(pts) and pts[a] and pts[b]:
                cv2.line(img, pts[a], pts[b], color, max(1, thickness), cv2.LINE_AA)

        for p in pts:
            if p is not None:
                cv2.circle(img, p, 3 + thickness // 2, color, -1, cv2.LINE_AA)


def draw_shuttle(
    img: np.ndarray,
    shuttle: list[dict],
    *,
    min_conf: float,
    max_k: int,
    radius: int,
) -> None:
    h, w = img.shape[:2]
    shown = 0
    for i, c in enumerate(shuttle):
        if shown >= max_k:
            break
        conf = float(c.get("conf", 0.0))
        if conf < min_conf:
            continue
        x, y = _xy(c["x"], c["y"], w, h)
        color = SHUTTLE_COLORS[min(i, len(SHUTTLE_COLORS) - 1)]
        r = radius + max(0, 3 - i)  # top peak slightly larger
        cv2.circle(img, (x, y), r + 2, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.circle(img, (x, y), r, color, 2, cv2.LINE_AA)
        cv2.drawMarker(img, (x, y), color, cv2.MARKER_CROSS, r + 4, 1, cv2.LINE_AA)
        cv2.putText(
            img,
            f"s{i}:{conf:.2f}",
            (x + r + 4, y - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            color,
            1,
            cv2.LINE_AA,
        )
        shown += 1


def draw_hud(
    img: np.ndarray,
    *,
    frame_idx: int,
    n_pose: int,
    n_shuttle: int,
    fps: float,
) -> None:
    t = frame_idx / fps if fps > 0 else 0.0
    text = f"f={frame_idx}  t={t:.1f}s  poses={n_pose}  shuttle={n_shuttle}"
    cv2.rectangle(img, (0, 0), (min(img.shape[1], 620), 32), (0, 0, 0), -1)
    cv2.putText(
        img,
        text,
        (8, 22),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (240, 240, 240),
        1,
        cv2.LINE_AA,
    )


def annotate_frame(
    frame_bgr: np.ndarray,
    fr: dict | None,
    *,
    kpt_conf: float,
    shuttle_min_conf: float,
    shuttle_k: int,
    thickness: int,
    frame_idx: int,
    fps: float,
) -> np.ndarray:
    img = frame_bgr.copy()
    poses = (fr or {}).get("poses") or []
    shuttle = (fr or {}).get("shuttle") or []
    draw_poses(img, poses, kpt_conf=kpt_conf, thickness=thickness)
    draw_shuttle(
        img,
        shuttle,
        min_conf=shuttle_min_conf,
        max_k=shuttle_k,
        radius=8,
    )
    draw_hud(
        img,
        frame_idx=frame_idx,
        n_pose=len(poses),
        n_shuttle=sum(1 for c in shuttle if float(c.get("conf", 0)) >= shuttle_min_conf),
        fps=fps,
    )
    return img


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--video", type=Path, required=True, help="source video (e.g. normalized.mp4)")
    p.add_argument("--detections", type=Path, required=True, help="detections.json")
    p.add_argument("--out", type=Path, default=None, help="output annotated mp4 (optional if --png-dir only)")
    p.add_argument("--start", type=int, default=0, help="first frame index (inclusive)")
    p.add_argument("--end", type=int, default=None, help="last frame index (exclusive); default=EOF")
    p.add_argument("--stride", type=int, default=1, help="keep every Nth frame")
    p.add_argument("--max-frames", type=int, default=None, help="stop after this many written frames")
    p.add_argument("--kpt-conf", type=float, default=0.3, help="min keypoint conf to draw")
    p.add_argument("--shuttle-min-conf", type=float, default=0.05, help="min shuttle peak conf")
    p.add_argument("--shuttle-k", type=int, default=8, help="max shuttle peaks to draw")
    p.add_argument("--thickness", type=int, default=2)
    p.add_argument("--fps", type=float, default=None, help="override output fps (default=source)")
    p.add_argument("--png-dir", type=Path, default=None, help="also write PNGs here")
    p.add_argument("--png-every", type=int, default=1, help="write PNG every N written frames")
    p.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="resize output (e.g. 0.5 for half-res preview)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.video.is_file():
        print(f"ERROR: video not found: {args.video}", file=sys.stderr)
        return 1
    if not args.detections.is_file():
        print(f"ERROR: detections not found: {args.detections}", file=sys.stderr)
        return 1
    if args.out is None and args.png_dir is None:
        print("ERROR: provide --out and/or --png-dir", file=sys.stderr)
        return 1

    by_idx = load_detections(args.detections)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        print(f"ERROR: cannot open video {args.video}", file=sys.stderr)
        return 1

    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    n_src = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    out_fps = float(args.fps) if args.fps else src_fps
    start = max(0, args.start)
    end = args.end if args.end is not None else n_src
    end = min(end, n_src) if n_src > 0 else end

    print(
        f"video {w}x{h} @ {src_fps:.3f} fps  frames={n_src}  "
        f"range=[{start},{end}) stride={args.stride}",
        flush=True,
    )

    writer = None
    out_w = max(1, int(round(w * args.scale)))
    out_h = max(1, int(round(h * args.scale)))
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(args.out), fourcc, out_fps / max(args.stride, 1), (out_w, out_h))
        if not writer.isOpened():
            print(f"ERROR: cannot open writer {args.out}", file=sys.stderr)
            return 1

    if args.png_dir is not None:
        args.png_dir.mkdir(parents=True, exist_ok=True)

    if start > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)

    written = 0
    idx = start
    t0 = time.perf_counter()
    missing = 0

    while idx < end:
        ok, frame = cap.read()
        if not ok:
            break
        if (idx - start) % args.stride != 0:
            idx += 1
            continue

        fr = by_idx.get(idx)
        if fr is None:
            missing += 1
        ann = annotate_frame(
            frame,
            fr,
            kpt_conf=args.kpt_conf,
            shuttle_min_conf=args.shuttle_min_conf,
            shuttle_k=args.shuttle_k,
            thickness=args.thickness,
            frame_idx=idx,
            fps=src_fps,
        )
        if args.scale != 1.0:
            ann = cv2.resize(ann, (out_w, out_h), interpolation=cv2.INTER_AREA)

        if writer is not None:
            writer.write(ann)
        if args.png_dir is not None and (written % max(1, args.png_every) == 0):
            cv2.imwrite(str(args.png_dir / f"frame_{idx:06d}.png"), ann)

        written += 1
        if written % 100 == 0:
            elapsed = time.perf_counter() - t0
            print(f"  wrote {written} frames  ({written / max(elapsed, 1e-6):.1f} fps)", flush=True)
        if args.max_frames is not None and written >= args.max_frames:
            break
        idx += 1

    cap.release()
    if writer is not None:
        writer.release()

    elapsed = time.perf_counter() - t0
    print(
        f"done: wrote={written}  missing_det_frames={missing}  "
        f"elapsed={elapsed:.1f}s  out={args.out}  png_dir={args.png_dir}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
