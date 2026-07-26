#!/usr/bin/env python3
"""Compare video-det detections.json against ds1 pose.json + shuttle.csv.

All geometry is scored in pixel space (W×H from pose.json video_info or args).

Usage:
  python tools/eval_ds1_compare.py \\
    --detections /tmp/ds1_eval/detections.json \\
    --pose-ref /path/to/ds1/pose.json \\
    --shuttle-ref /path/to/ds1/shuttle.csv \\
    --out /tmp/ds1_eval/metrics.json
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any


# COCO-17 OKS sigmas (Ultralytics / COCO order).
_OKS_SIGMAS = (
    0.026,
    0.025,
    0.025,
    0.035,
    0.035,
    0.079,
    0.079,
    0.072,
    0.072,
    0.062,
    0.062,
    0.107,
    0.107,
    0.087,
    0.087,
    0.089,
    0.089,
)


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _bbox_area(b: tuple[float, float, float, float]) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _oks(
    pred_kpts: list[tuple[float, float, float]],
    gt_kpts: list[tuple[float, float, float]],
    gt_bbox: tuple[float, float, float, float],
    *,
    conf_thr: float = 0.0,
) -> float:
    """Object Keypoint Similarity (COCO-style) between two 17-kpt sets."""
    if len(pred_kpts) < 17 or len(gt_kpts) < 17:
        return 0.0
    area = max(_bbox_area(gt_bbox), 1.0)
    vars_ = [(s * 2.0) ** 2 for s in _OKS_SIGMAS]
    e_sum = 0.0
    k = 0
    for i in range(17):
        gxc, gyc, gc = gt_kpts[i]
        if gc < conf_thr:
            continue
        px, py, _pc = pred_kpts[i]
        dx = px - gxc
        dy = py - gyc
        e = (dx * dx + dy * dy) / (vars_[i] * area * 2.0 + 1e-9)
        e_sum += math.exp(-e)
        k += 1
    return e_sum / k if k else 0.0


def _greedy_match(
    cost: list[list[float]], thr: float
) -> list[tuple[int, int, float]]:
    """Maximize score; thr is minimum accepted score. cost[i][j] = score."""
    if not cost or not cost[0]:
        return []
    n, m = len(cost), len(cost[0])
    pairs: list[tuple[float, int, int]] = []
    for i in range(n):
        for j in range(m):
            pairs.append((cost[i][j], i, j))
    pairs.sort(reverse=True)
    used_i: set[int] = set()
    used_j: set[int] = set()
    out: list[tuple[int, int, float]] = []
    for s, i, j in pairs:
        if s < thr:
            break
        if i in used_i or j in used_j:
            continue
        used_i.add(i)
        used_j.add(j)
        out.append((i, j, s))
    return out


def _product_to_pixels(frame: dict, w: float, h: float) -> dict[str, Any]:
    poses = []
    for p in frame.get("poses") or []:
        bbox = p["bbox"]
        bbox_px = (bbox[0] * w, bbox[1] * h, bbox[2] * w, bbox[3] * h)
        kpts = [(kp[0] * w, kp[1] * h, float(kp[2])) for kp in p["keypoints"]]
        poses.append(
            {
                "bbox": bbox_px,
                "kpts": kpts,
                "conf": float(p.get("conf", 0.0)),
            }
        )
    shuttle = []
    for s in frame.get("shuttle") or []:
        shuttle.append(
            {
                "x": float(s["x"]) * w,
                "y": float(s["y"]) * h,
                "conf": float(s.get("conf", 0.0)),
            }
        )
    return {"frame": int(frame["frame"]), "poses": poses, "shuttle": shuttle}


def _load_pose_ref(path: Path) -> tuple[dict[str, Any], dict[int, list[dict]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    info = data["video_info"]
    by_frame: dict[int, list[dict]] = {}
    for row in data["pose_data"]:
        t = int(row["frame_index"])
        joints = sorted(row["joints"], key=lambda j: int(j["joint_index"]))
        kpts = [
            (float(j["x"]), float(j["y"]), float(j["confidence"])) for j in joints
        ]
        bb = row["bbox"]
        by_frame.setdefault(t, []).append(
            {
                "bbox": (float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])),
                "kpts": kpts,
                "track_id": int(row.get("track_id", -1)),
                "score": float(row.get("detection_score", 0.0)),
            }
        )
    return info, by_frame


def _load_shuttle_ref(path: Path) -> dict[int, tuple[float, float, float]]:
    out: dict[int, tuple[float, float, float]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if str(row.get("detected", "1")).strip() not in ("1", "true", "True"):
                continue
            fi = int(float(row["frame_number"]))
            out[fi] = (float(row["x"]), float(row["y"]), float(row["confidence"]))
    return out


def _load_product(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    frames = data.get("frames")
    if not isinstance(frames, list):
        raise ValueError("detections.json missing frames[]")
    return frames


def _percentile(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    ys = sorted(xs)
    if len(ys) == 1:
        return ys[0]
    k = (len(ys) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return ys[int(k)]
    return ys[f] * (c - k) + ys[c] * (k - f)


def evaluate(
    *,
    detections: Path,
    pose_ref: Path,
    shuttle_ref: Path,
    iou_thr: float = 0.5,
    oks_thr: float = 0.5,
    shuttle_conf_floor: float = 0.05,
) -> dict[str, Any]:
    info, pose_by_f = _load_pose_ref(pose_ref)
    w = float(info["width"])
    h = float(info["height"])
    n_ref = int(info["frame_count"])
    shuttle_by_f = _load_shuttle_ref(shuttle_ref)
    prod_frames = _load_product(detections)

    prod_by_f: dict[int, dict] = {}
    for fr in prod_frames:
        px = _product_to_pixels(fr, w, h)
        prod_by_f[int(px["frame"])] = px

    n_prod = len(prod_by_f)
    frame_ids = sorted(prod_by_f.keys())
    contiguous = frame_ids == list(range(n_prod)) if n_prod else False

    # --- pose ---
    ref_n = sum(len(v) for v in pose_by_f.values())
    matched = 0
    tp_iou = 0
    oks_scores: list[float] = []
    kpt_l2s: list[float] = []
    pred_total = 0

    for t in range(max(n_ref, max(frame_ids) + 1 if frame_ids else 0)):
        refs = pose_by_f.get(t, [])
        preds = (prod_by_f.get(t) or {}).get("poses") or []
        pred_total += len(preds)
        if not refs or not preds:
            continue
        # score matrix: max(IoU, OKS) for matching; report both
        cost_iou = [[_iou(p["bbox"], r["bbox"]) for r in refs] for p in preds]
        cost_oks = [
            [_oks(p["kpts"], r["kpts"], r["bbox"]) for r in refs] for p in preds
        ]
        # match on OKS primarily (pose quality); fall back IoU if all zero
        use = cost_oks
        thr = oks_thr
        if all(all(v == 0 for v in row) for row in use):
            use = cost_iou
            thr = iou_thr
        pairs = _greedy_match(use, thr)
        # also count IoU@0.5 matches independently for detection rate
        pairs_iou = _greedy_match(cost_iou, iou_thr)
        tp_iou += len(pairs_iou)
        matched += len(pairs)
        for pi, ri, _s in pairs:
            oks_scores.append(cost_oks[pi][ri])
            # mean visible-gt keypoint L2
            rk = refs[ri]["kpts"]
            pk = preds[pi]["kpts"]
            dists = []
            for i in range(min(17, len(rk), len(pk))):
                if rk[i][2] <= 0:
                    continue
                dists.append(
                    math.hypot(pk[i][0] - rk[i][0], pk[i][1] - rk[i][1])
                )
            if dists:
                kpt_l2s.append(sum(dists) / len(dists))

    recall_iou = tp_iou / ref_n if ref_n else float("nan")
    precision_iou = tp_iou / pred_total if pred_total else float("nan")

    # --- shuttle ---
    l2s: list[float] = []
    hit_30 = hit_50 = hit_100 = 0
    labeled = 0
    missing_prod_frames = 0
    for f, (rx, ry, _rc) in sorted(shuttle_by_f.items()):
        labeled += 1
        pf = prod_by_f.get(f)
        if pf is None:
            missing_prod_frames += 1
            continue
        peaks = [s for s in pf["shuttle"] if s["conf"] >= shuttle_conf_floor]
        if not peaks:
            # treat as infinite miss
            continue
        best = min(math.hypot(s["x"] - rx, s["y"] - ry) for s in peaks)
        l2s.append(best)
        if best <= 30:
            hit_30 += 1
        if best <= 50:
            hit_50 += 1
        if best <= 100:
            hit_100 += 1

    def _rate(hits: int) -> float:
        return hits / labeled if labeled else float("nan")

    hard = {
        "frame_count_ok": n_prod == n_ref,
        "frames_contiguous": contiguous,
        "n_prod": n_prod,
        "n_ref_video": n_ref,
    }

    metrics: dict[str, Any] = {
        "video_info": info,
        "hard": hard,
        "pose": {
            "ref_instances": ref_n,
            "pred_instances": pred_total,
            "matched_oks_thr": matched,
            "matched_iou50": tp_iou,
            "recall_iou50": recall_iou,
            "precision_iou50": precision_iou,
            "mean_oks_on_matches": (
                sum(oks_scores) / len(oks_scores) if oks_scores else float("nan")
            ),
            "mean_kpt_l2_px": (
                sum(kpt_l2s) / len(kpt_l2s) if kpt_l2s else float("nan")
            ),
            "oks_thr": oks_thr,
            "iou_thr": iou_thr,
        },
        "shuttle": {
            "ref_labeled_frames": labeled,
            "scored_frames": len(l2s),
            "missing_product_frames": missing_prod_frames,
            "median_l2_px": _percentile(l2s, 50),
            "p95_l2_px": _percentile(l2s, 95),
            "mean_l2_px": sum(l2s) / len(l2s) if l2s else float("nan"),
            "recall_at_30px": _rate(hit_30),
            "recall_at_50px": _rate(hit_50),
            "recall_at_100px": _rate(hit_100),
            "conf_floor": shuttle_conf_floor,
        },
    }
    return metrics


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--detections", type=Path, required=True)
    ap.add_argument("--pose-ref", type=Path, required=True)
    ap.add_argument("--shuttle-ref", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--iou-thr", type=float, default=0.5)
    ap.add_argument("--oks-thr", type=float, default=0.5)
    ap.add_argument("--shuttle-conf-floor", type=float, default=0.05)
    args = ap.parse_args(argv)

    m = evaluate(
        detections=args.detections,
        pose_ref=args.pose_ref,
        shuttle_ref=args.shuttle_ref,
        iou_thr=args.iou_thr,
        oks_thr=args.oks_thr,
        shuttle_conf_floor=args.shuttle_conf_floor,
    )
    text = json.dumps(m, indent=2)
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)

    hard = m["hard"]
    if not hard["frame_count_ok"]:
        print(
            f"FAIL: frame count product={hard['n_prod']} ref={hard['n_ref_video']}",
            file=sys.stderr,
        )
        return 2
    if not hard["frames_contiguous"]:
        print("FAIL: product frames not contiguous 0..N-1", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
