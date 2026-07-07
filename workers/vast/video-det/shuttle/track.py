# -*- coding: utf-8 -*-
"""
Single-shuttle filtering & tracking on top of raw detections.

Input  : a raw-detection CSV from detect.py (`frame_number, x, y, confidence`),
         which may contain zero, one, or several detections per frame -- including
         false positives on non-shuttle objects and spurious blobs while the
         shuttle is out of view.
Output : a clean CSV with at most ONE row per frame -- the main shuttle's
         position -- and NO row for frames where the shuttle is out of view.

How it works
------------
A constant-velocity Kalman filter is run over the per-frame candidates. Each
frame it predicts the shuttle's next position and accepts the nearest candidate
within a gating radius; this rejects background objects that don't move
consistently with a flying shuttle. The tracker:
  * only initializes on a confident detection (`min_init_conf`),
  * coasts through short gaps (occlusion / missed frames) up to `max_coast`,
  * drops the track when it has coasted too long (shuttle truly gone),
  * drops the track when it sits nearly still for several frames (locked onto a
    static background object, not a shuttle),
  * rejects "static hotspot" detections that fire at the same pixel location
    across many frames (persistent background false positives),
  * allows a hard re-acquire on a very confident detection moderately far from
    prediction (a hit that reverses the shuttle's direction), but not on
    hotspots and not on arbitrarily distant blobs.

Frames where no track is active emit no row -> that is the "out of view" signal.

The logic and the GT-calibrated constants are ported from the Mintonix
`detect_shuttle.py` (calibrated on the TrackNetV2 dataset).

Usage:
    python track.py raw_detections.csv
    python track.py raw_detections.csv -o shuttle.csv --fps 30
"""
import csv
import argparse
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Optional

import numpy as np


@dataclass
class BallPoint:
    x: float = 0.0
    y: float = 0.0
    conf: float = 0.0
    is_detected: bool = False


class ShuttleKalmanFilter:
    """Constant-velocity Kalman filter (state = [x, y, vx, vy])."""

    def __init__(self, dt: float, process_noise_std: float = 3000.0,
                 measurement_noise_std: float = 3.0, gating_threshold: float = 50.0):
        self.dt = dt
        self.gating_threshold = gating_threshold

        self.F = np.array([
            [1, 0, dt, 0],
            [0, 1, 0, dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ], dtype=float)

        self.H = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
        ], dtype=float)

        dt2 = dt * dt
        dt3 = dt2 * dt
        q = process_noise_std ** 2
        self.Q = np.array([
            [dt3 / 3, 0, dt2 / 2, 0],
            [0, dt3 / 3, 0, dt2 / 2],
            [dt2 / 2, 0, dt, 0],
            [0, dt2 / 2, 0, dt],
        ], dtype=float) * q

        self.r_base = measurement_noise_std ** 2
        self.R = np.eye(2) * self.r_base

        self.x = None
        self.P = None
        self.initialized = False

    def initialize(self, x: float, y: float):
        self.x = np.array([x, y, 0.0, 0.0], dtype=float)
        self.P = np.eye(4) * 100.0
        self.initialized = True

    def predict(self):
        if self.x is None:
            return None
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.x[:2].copy()

    def update(self, x: float, y: float, confidence: Optional[float] = None):
        if confidence is not None:
            r = self.r_base / max(confidence, 0.05)
            self.R = np.eye(2) * r
        else:
            self.R = np.eye(2) * self.r_base

        z = np.array([x, y])
        z_pred = self.H @ self.x
        innovation = z - z_pred
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.x = self.x + K @ innovation
        self.P = (np.eye(4) - K @ self.H) @ self.P

    def get_position(self):
        if self.x is None:
            return None
        return self.x[:2].copy()


_COMMON_WIDTHS = (3840, 2560, 1920, 1280, 854, 640)


def infer_frame_width(raw_candidates: List[List[BallPoint]]) -> float:
    """Guess source video width from detection coordinates."""
    max_x = 0.0
    for cands in raw_candidates:
        for c in cands:
            max_x = max(max_x, c.x)
    if max_x <= 0:
        return 1920.0
    for w in _COMMON_WIDTHS:
        if max_x <= w:
            return float(w)
    return max(max_x, 1920.0)


def is_static_hotspot(all_cands: List[List[BallPoint]], fi: int,
                      x: float, y: float, radius: float,
                      lookback: int = 8, lookahead: int = 3,
                      min_frames: int = 3, min_conf: float = 0.30,
                      global_min: int = 0, contig_release: int = 0) -> bool:
    """True when the same location fires confidently across many nearby frames.

    `global_min` adds a global-persistence gate (de-risked dwell/blob separator,
    `ablate.py hotspot_global_min`): when > 0, a location is only a hotspot if it
    ALSO fires across >= global_min frames of the WHOLE clip. This releases the
    veto on brief dwelling shuttles (apex of a clear/lob) that locally look static
    but aren't globally persistent, recovering their init/re-init.

    `contig_release` releases the veto when the location's longest run of
    CONSECUTIVE firing frames exceeds it: a dwelling shuttle fires in one
    contiguous burst, while the sporadic FP-blob clusters the veto exists for
    scatter across the clip (see `ablate.py hotspot_contig_release`).
    """
    hits = 0
    lo = max(0, fi - lookback)
    hi = min(len(all_cands), fi + lookahead + 1)
    for fj in range(lo, hi):
        if fj == fi:
            continue
        for c in all_cands[fj]:
            if c.conf >= min_conf and np.hypot(c.x - x, c.y - y) <= radius:
                hits += 1
                break
    if hits < min_frames:
        return False
    if global_min > 0:
        ghits = 0
        for frame in all_cands:
            for c in frame:
                if c.conf >= min_conf and np.hypot(c.x - x, c.y - y) <= radius:
                    ghits += 1
                    break
        if ghits < global_min:
            return False
    if contig_release > 0:
        best = cur = 0
        for frame in all_cands:
            hit = any(c.conf >= min_conf and np.hypot(c.x - x, c.y - y) <= radius
                      for c in frame)
            cur = cur + 1 if hit else 0
            best = max(best, cur)
        if best > contig_release:
            return False
    return True


def _pick_init_candidate(fi: int, cands: List[BallPoint], all_cands: List[List[BallPoint]],
                         gate_px: float, hotspot_radius: float, hotspot_min_hits: int,
                         min_init_conf: float, min_init_fallback: float,
                         hotspot_global_min: int = 0,
                         hotspot_contig_release: int = 0) -> Optional[BallPoint]:
    """Choose an init candidate, skipping persistent static false positives."""
    for c in cands:
        if c.conf < min_init_fallback:
            break
        if is_static_hotspot(all_cands, fi, c.x, c.y, hotspot_radius,
                             min_frames=hotspot_min_hits, global_min=hotspot_global_min,
                             contig_release=hotspot_contig_release):
            continue
        if c.conf >= min_init_conf:
            return c
    if fi > 0 and all_cands[fi - 1]:
        for c in cands:
            if c.conf < min_init_fallback:
                break
            if is_static_hotspot(all_cands, fi, c.x, c.y, hotspot_radius,
                                 min_frames=hotspot_min_hits, global_min=hotspot_global_min,
                                 contig_release=hotspot_contig_release):
                continue
            dists = [float(np.hypot(c.x - p.x, c.y - p.y))
                     for p in all_cands[fi - 1] if p.conf >= 0.15]
            if dists and min(dists) <= gate_px:
                return c
    return None


def track_with_kalman(raw_candidates: List[List[BallPoint]], fps: float,
                      top_n: int = 3, min_match_conf: float = 0.45,
                      frame_width: Optional[float] = None) -> Dict[int, BallPoint]:
    """Track the main shuttle, choosing among the top-N candidates per frame.

    Returns {frame_index: BallPoint} only for frames where the shuttle is
    actively tracked; frames with no entry are "out of view".

    `min_match_conf` is the confidence floor for *sustaining* a track: a
    within-gate candidate must clear it to be accepted. This is the key guard
    against the tracker locking onto low-confidence background blobs while the
    shuttle is out of view. It is deliberately lower than `min_init_conf`
    (hysteresis: hard to start a track, easier to keep one).
    """
    n_frames = len(raw_candidates)
    if n_frames == 0:
        return {}

    if frame_width is None:
        frame_width = infer_frame_width(raw_candidates)
    scale = frame_width / 1920.0

    dt = 1.0 / fps
    # GT-calibrated on TrackNetV2 at 1920-wide; scale for higher-resolution footage.
    gate_px = 100 * scale
    hard_reset_conf = 0.8
    hard_reset_max_dist = gate_px * 2.5
    # Extended-reach re-acquire: a fast stroke that REVERSES the shuttle's
    # direction lands a confident detection far past the gate (median 4.4x, p90
    # 7.5x), beyond hard_reset's 2.5x reach -- which is why the conf-floor sweep
    # was flat (distance, not conf, was the binding cap). Same conf floor as
    # hard_reset (0.8: lower floors readmit background on hard footage), reach
    # 10x, velocity re-seeded from the observed jump so sustained fast strokes
    # stay in-gate. Held-out A/B (ablate.py reacq_dir_c80): standard footage
    # recall 0.882->0.912 (1-15) / 0.845->0.911 (16-30) with FP_long flat-down;
    # ds11 (hardest) trades down -0.022 recall, accepted (30-clip win dominates).
    reacq_max_dist = gate_px * 10.0
    reacq_conf = 0.8
    reacq_min_speed_px = 2.0
    # GT-calibrated: 80th-pct coast is 6 frames; 5 reset on 20% of real coasts.
    max_coast = 8
    min_init_conf = 0.65
    min_init_fallback = 0.25
    hotspot_radius = 35 * scale
    hotspot_min_hits = 3
    # Global-persistence gate on the hotspot veto (ablate.py hotspot_global_min,
    # user-approved g20). A dwelling shuttle trips the LOCAL hotspot like a
    # background blob; requiring the location to ALSO fire across >= this many
    # frames of the whole clip releases the veto on brief dwells (recovering
    # their init/re-init) while still vetoing genuinely persistent objects.
    # Held-out A/B (ablate.py c80_g20 vs c80): 16-30 recall 0.911->0.948,
    # F1 0.943->0.963, FP_long 29->33; 1-15 F1 0.945->0.953; ds11 recall
    # 0.786->0.803, F1 0.811->0.815. Cost: FP_long (the genuine bug) rises
    # +9/+4/+12 -- an explicit recall/F1-vs-FP_long frontier choice, not a free
    # win. dwell & sporadic-FP-blob are inseparable by persistence (count and
    # contiguity both overlap), so the 324-frame hotspot headroom is Pareto-bound.
    hotspot_global_min = 20
    # Contiguity release on the hotspot veto (ablate.py hotspot_contig_release,
    # user sweep ct22/ct30/ct45; ct30 shipped as the safe knee). Post-lc60
    # fn_reason showed hotspot-blocked dwells STILL the dominant recoverable-FN
    # bucket (73% on 1-15, 54% on 16-30), and 80-94% of them fire in a contiguous
    # run > 22 frames, while the sporadic FP-blob clusters the veto exists for
    # scatter (short runs). Release the veto when the location's longest
    # consecutive run exceeds this cap. A/B (g20_lc60 -> lc60_ct30): 1-15 recall
    # 0.925->0.946 (FP_long 29->35), held-out 16-30 recall 0.948->0.963 with
    # FP_long EXACTLY flat (30), ds11 completely untouched; MISLOC/medErr flat
    # everywhere. ct22 recovers more on 1-15 (0.965) but pays FP_long +8 there
    # and +9 on ds11 -- available if recall is worth that trade.
    hotspot_contig_release = 30
    # Static-object rejection: if recent tracked positions barely move, the
    # tracker is locked onto a background object, not a flying shuttle.
    # NOTE: a flying shuttle DWELLS at a clear/lob apex for several frames, so a
    # short kill threshold misfires and drops real tracks -- which then cannot
    # re-init (the dwelling shuttle re-triggers the hotspot veto), the single
    # largest recall leak. Held-out A/B (15-clip + ds11) puts the knee at ~20:
    # raising 3->20 recovers +0.10/+0.16 recall with FP_long flat-to-down, while
    # still killing genuine background lock-ons (motionless for >20 windows, far
    # longer than any shuttle apex dwell). See ablate.py / fn_reason.py.
    static_window = 5
    static_max_disp = 15 * scale
    max_static_frames = 20
    min_active_before_check = 3
    # Sustained-low-confidence OUTPUT gate (FP_long suppressor, user-approved lc60).
    # When the shuttle is out of view the track latches onto scattered low-conf blob
    # detections (every emitted frame is a real detection, so this shows as a jumpy,
    # low-confidence run). A PER-FRAME conf floor fails (real small/blurred shuttles
    # dip low too), but the TRAILING-WINDOW MEAN confidence separates cleanly: a real
    # shuttle dips and recovers; a blob region stays low. Suppress emission when the
    # trailing-`lowconf_win` mean emitted conf < floor. Output-only: dropping a frame
    # has zero feedback into the KF (coast/state already decided this frame), so this
    # post-filter is identical to an inline gate. Held-out A/B (ablate.py g20_lc60 vs
    # c80_g20): FP_long 55->29 (1-15) / 33->30 (16-30) / 34->20 (ds11), recall cost
    # -14/-1/-1 TP (0.929->0.925 / 0.948 flat / 0.803->0.802). First lever to cut
    # FP_long -- the genuine bug -- with ~no recall sacrifice; footage-dependent (biggest
    # on FP-heavy footage). MISLOC also drops but that's mostly MISLOC->FN relabel.
    lowconf_floor = 0.60
    lowconf_win = 7

    top_cands = [
        sorted(c, key=lambda p: p.conf, reverse=True)[:top_n]
        for c in raw_candidates
    ]

    result: Dict[int, BallPoint] = {}
    kf: Optional[ShuttleKalmanFilter] = None
    coast_count = 0
    static_count = 0
    active_frames = 0
    recent_positions: List[tuple] = []

    for fi, cands in enumerate(top_cands):
        if kf is None:
            init = _pick_init_candidate(fi, cands, top_cands, gate_px, hotspot_radius,
                                        hotspot_min_hits, min_init_conf, min_init_fallback,
                                        hotspot_global_min=hotspot_global_min,
                                        hotspot_contig_release=hotspot_contig_release)
            if init:
                kf = ShuttleKalmanFilter(dt=dt, process_noise_std=3000.0,
                                         measurement_noise_std=3.0, gating_threshold=50.0)
                kf.initialize(init.x, init.y)
                result[fi] = BallPoint(x=init.x, y=init.y,
                                       conf=init.conf, is_detected=True)
                coast_count = static_count = active_frames = 0
                recent_positions = [(init.x, init.y)]
            continue

        pred = kf.predict()

        matched = False
        if cands and pred is not None:
            scored = [(c, float(np.hypot(c.x - pred[0], c.y - pred[1]))) for c in cands]
            within = [(c, d) for c, d in scored
                      if d <= gate_px and c.conf >= min_match_conf]

            if within:
                best, _ = min(within, key=lambda x: x[1])
                kf.update(best.x, best.y, best.conf)
                result[fi] = BallPoint(x=best.x, y=best.y, conf=best.conf, is_detected=True)
                coast_count = 0
                active_frames += 1
                matched = True
                recent_positions.append((best.x, best.y))
                if len(recent_positions) > static_window:
                    recent_positions.pop(0)

                if (active_frames > min_active_before_check
                        and len(recent_positions) >= static_window):
                    xs = [p[0] for p in recent_positions]
                    ys = [p[1] for p in recent_positions]
                    disp = float(np.hypot(max(xs) - min(xs), max(ys) - min(ys)))
                    if disp < static_max_disp:
                        static_count += 1
                        if static_count > max_static_frames:
                            kf = None
                            coast_count = static_count = active_frames = 0
                            recent_positions = []
                            continue
                    else:
                        static_count = 0
            else:
                top = cands[0]
                dist = float(np.hypot(top.x - pred[0], top.y - pred[1]))
                if (top.conf >= hard_reset_conf
                        and dist <= hard_reset_max_dist
                        and not is_static_hotspot(top_cands, fi, top.x, top.y,
                                                  hotspot_radius,
                                                  min_frames=hotspot_min_hits,
                                                  global_min=hotspot_global_min,
                                                  contig_release=hotspot_contig_release)):
                    kf = ShuttleKalmanFilter(dt=dt, process_noise_std=3000.0,
                                             measurement_noise_std=3.0, gating_threshold=50.0)
                    kf.initialize(top.x, top.y)
                    result[fi] = BallPoint(x=top.x, y=top.y, conf=top.conf, is_detected=True)
                    coast_count = static_count = active_frames = 0
                    recent_positions = [(top.x, top.y)]
                    matched = True

                # Extended-reach re-acquire: confident candidate far past the gate
                # (a direction-reversing fast stroke). Reach 10x vs hard_reset's
                # 2.5x; among in-band non-hotspot candidates prefer the one most
                # aligned with the coasting velocity, then re-seed velocity from
                # the jump so the next frame stays in-gate.
                if not matched and recent_positions:
                    vx, vy = float(kf.x[2]), float(kf.x[3])
                    speed = float(np.hypot(vx, vy))
                    if speed >= reacq_min_speed_px:
                        lx, ly = recent_positions[-1]
                        best_c, best_align = None, -1.0
                        for c in cands:
                            if c.conf < reacq_conf:
                                continue
                            d = float(np.hypot(c.x - pred[0], c.y - pred[1]))
                            if d <= gate_px or d > reacq_max_dist:
                                continue
                            ox, oy = c.x - lx, c.y - ly
                            onorm = float(np.hypot(ox, oy))
                            if onorm < 1e-6:
                                continue
                            align = (ox * vx + oy * vy) / (onorm * speed)
                            if align >= best_align and not is_static_hotspot(
                                    top_cands, fi, c.x, c.y, hotspot_radius,
                                    min_frames=hotspot_min_hits,
                                    global_min=hotspot_global_min,
                                    contig_release=hotspot_contig_release):
                                best_c, best_align = c, align
                        if best_c is not None:
                            kf = ShuttleKalmanFilter(dt=dt, process_noise_std=3000.0,
                                                     measurement_noise_std=3.0, gating_threshold=50.0)
                            kf.initialize(best_c.x, best_c.y)
                            elapsed = (coast_count + 1) * dt
                            kf.x[2] = (best_c.x - lx) / elapsed
                            kf.x[3] = (best_c.y - ly) / elapsed
                            result[fi] = BallPoint(x=best_c.x, y=best_c.y,
                                                   conf=best_c.conf, is_detected=True)
                            coast_count = static_count = active_frames = 0
                            recent_positions = [(best_c.x, best_c.y)]
                            matched = True

        if not matched:
            coast_count += 1
            if coast_count > max_coast:
                kf = None
                coast_count = static_count = active_frames = 0
                recent_positions = []

    # Sustained-low-confidence output gate: drop emitted frames whose trailing-window
    # mean confidence is below the floor (see lowconf_floor comment above).
    if lowconf_floor > 0.0 and result:
        confs = {fi: p.conf for fi, p in result.items()}
        drop = [fi for fi in confs
                if (lambda w: w and (sum(w) / len(w)) < lowconf_floor)(
                    [confs[k] for k in range(fi - lowconf_win + 1, fi + 1) if k in confs])]
        for fi in drop:
            del result[fi]

    return result


def load_raw_candidates(csv_path) -> List[List[BallPoint]]:
    """Read detect.py CSV into a per-frame list of BallPoints."""
    by_frame: Dict[int, List[BallPoint]] = {}
    max_frame = -1
    with open(csv_path) as f:
        for row in csv.DictReader(f):
            fi = int(row['frame_number'])
            by_frame.setdefault(fi, []).append(
                BallPoint(x=float(row['x']), y=float(row['y']),
                          conf=float(row['confidence']), is_detected=True))
            max_frame = max(max_frame, fi)
    return [by_frame.get(i, []) for i in range(max_frame + 1)]


def main():
    parser = argparse.ArgumentParser(
        description="Filter raw shuttle detections down to a single tracked shuttle")
    parser.add_argument('detections_csv', type=str, help='Raw CSV from detect.py')
    parser.add_argument('-o', '--output', type=str, default=None,
                        help='Output CSV path (default: <input>_tracked.csv)')
    parser.add_argument('--fps', type=float, default=30.0,
                        help='Video frame rate (used for the motion model; default 30)')
    parser.add_argument('--top-n', type=int, default=3,
                        help='Number of top-confidence candidates considered per frame')
    parser.add_argument('--match-conf', type=float, default=0.45,
                        help='Confidence floor to sustain a track (out-of-view guard; default 0.45)')
    parser.add_argument('--width', type=float, default=None,
                        help='Source video width in px (auto-inferred from detections if omitted)')
    args = parser.parse_args()

    csv_path = Path(args.detections_csv)
    if not csv_path.exists():
        raise SystemExit(f"Error: file not found: {csv_path}")

    output_path = Path(args.output) if args.output else \
        csv_path.with_name(f'{csv_path.stem}_tracked.csv')

    raw_candidates = load_raw_candidates(csv_path)
    tracked = track_with_kalman(raw_candidates, args.fps, top_n=args.top_n,
                                min_match_conf=args.match_conf,
                                frame_width=args.width)

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['frame_number', 'x', 'y', 'confidence'])
        for fi in sorted(tracked):
            p = tracked[fi]
            writer.writerow([fi, f'{p.x:.2f}', f'{p.y:.2f}', f'{p.conf:.4f}'])

    n_frames = len(raw_candidates)
    print(f"Tracked {len(tracked)}/{n_frames} frames "
          f"({n_frames - len(tracked)} out-of-view / dropped).")
    print(f"Output: {output_path}")


if __name__ == '__main__':
    main()
