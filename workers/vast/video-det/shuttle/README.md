# shuttle-accel — 2D shuttle detection & single-shuttle tracking

Standalone extraction of the shuttle pipeline from the Mintonix project. It runs
the TrackNetV5 heatmap network on a video to get raw detections, then filters &
tracks them down to a single main shuttle per frame — emitting nothing while the
shuttle is out of view.

## Files
### Pipeline
- `model.py` — flattened, inference-only TrackNetV5 (MDD → backbone → neck → R_STRHead).
- `detect.py` — video → raw-detection CSV (every heatmap blob, no filtering).
- `track.py` — raw CSV → clean single-shuttle CSV (Kalman tracking + filtering).
- `visualize.py` — overlays any detection CSV onto its video → annotated video.
- `label_gt.py` — interactive tool to hand-label the true shuttle position → GT CSV.
- `evaluate.py` — scores the detect→track pipeline against ground truth.
- `TrackNetV5.pt` — model weights (~59 MB).

### Research & diagnostic tooling
These are the reusable harnesses behind the tracker-tuning campaign logged in
`PLAN.md`. Re-run them after any tracker change to see which failure class now
dominates before reaching for the next lever.
- `ablate.py` — single-knob ablation harness. Detects each clip once (cached),
  then scores several tracker variants that each flip exactly one constant,
  reporting recall / FP_long / medErr. Add a new variant to A/B a proposed change.
- `fn_reason.py` — false-negative instrumentation. Replays `track_with_kalman`
  and buckets every recoverable FN by the *specific* reason the tracker dropped
  it (NO_TRACK_coasted/static/never, GATE_MISS, HOTSPOT).
- `recall_decomp.py` — splits recall loss (FN + MISLOC) into `DET_BLIND` (detector
  never saw the shuttle) vs `TRACK_REJECT` (detector saw it, tracker dropped it) —
  the pivotal split for whether a detector rethink / VLM oracle can even help.

Ground truth (`*_gt.csv`, hand-labeled), source clips (`*.mp4`), the TrackNetV2
dataset, and the latest tracked output (`*_tracked.csv`) are kept as fixtures.
Intermediate artifacts (`*_raw.csv`, `*_tracked_vis.mp4`) are regenerable from the
pipeline commands above and are not committed. The full research log — including
findings from one-off diagnostics that have since been removed
(`phase0_recoverable`, `misloc_diag`, `jitter_diag`, `blob_global`) — lives in
`PLAN.md`.

## Pipeline
```bash
# 1. raw detection — low threshold so the tracker has a full candidate pool
python detect.py input.mp4 -o raw.csv --threshold 0.1

# 2. filter + track down to one shuttle per frame (out-of-view frames omitted)
python track.py raw.csv -o shuttle.csv --fps 30

# 3. (optional) visualize either CSV
python visualize.py input.mp4 shuttle.csv -o annotated.mp4
```

`detect.py` alone is the "bare minimum" raw detector. `track.py` is the
filtering & tracking layer that solves the false-positive problem: it discards
detections on non-shuttle objects (players, rackets, line judges) and stops
emitting a position when the shuttle is genuinely out of view.

## How tracking works (`track.py`)
A constant-velocity Kalman filter runs over the per-frame candidates:
- **Init** only on a confident detection (`min_init_conf = 0.65`).
- **Gating**: each frame it accepts the nearest candidate within ~100 px of the
  predicted position — rejecting background blobs that don't move like a shuttle.
- **Confidence floor** (`--match-conf`, default **0.45**): a gated candidate must
  also clear this confidence to *sustain* the track. This is the key out-of-view
  guard — it stops the tracker latching onto low-confidence noise once the
  shuttle has left. (Lower than the init floor: hard to start a track, easier to
  keep one.)
- **Coasting**: tolerates short gaps (occlusion / motion blur) up to 8 frames,
  then drops the track → no rows emitted = "out of view".
- **Static-object rejection**: drops a track that sits nearly still for several
  frames (locked onto a static object, not a flying shuttle).
- **Hard re-acquire**: a very confident detection (≥0.8) far from prediction can
  restart the track (e.g. a hit reversing the shuttle's direction).

Constants are ported from the Mintonix `detect_shuttle.py`, calibrated on the
TrackNetV2 dataset.

## Output CSV (both detect.py and track.py)
| column | meaning |
|---|---|
| `frame_number` | 0-based frame index |
| `x`, `y` | pixel coordinates in the **original** video resolution |
| `confidence` | heatmap peak value at the blob, 0–1 |

`detect.py` may write several rows per frame; `track.py` writes at most one, and
none for out-of-view frames.

## Labeling ground truth (`label_gt.py`)
Hand-mark the real shuttle so the pipeline can be scored/debugged on your own
footage. Output is a CSV in the **TrackNetV2 format** (`Frame, Visibility, X, Y`),
saved in original video resolution and directly consumable by `evaluate.py`.

```bash
python label_gt.py ds1.mp4                       # writes ds1_gt.csv
python label_gt.py ds11.mp4 --ref ds11_tracked.csv   # overlay model output for reference
```

Controls: **left-click** marks the shuttle, **x** marks it out-of-view, **a/d**
(or arrows) step frames, **.**/**,** jump ±10, **u** jumps to the next unlabeled
frame, **g** goes to a frame number, **+/-** zoom the loupe, **k** saves, **q**
saves & quits. A magnifier loupe follows the cursor for precise placement on
small/4K shuttles. Re-running on an existing CSV resumes where you left off; only
frames you actually label are written (so partial labeling is fine).

## Evaluation (`evaluate.py`)
Scores the pipeline against ground truth (`Frame, Visibility, X, Y`) as a
per-frame **visibility confusion matrix** — because the failures that matter are
visibility errors (detecting a shuttle that isn't there), not position error.

```bash
python evaluate.py                                   # default TrackNetV2 sample
python evaluate.py --sweep 0.1,0.25,0.35,0.45,0.55   # tune the confidence floor
python evaluate.py --glob 'Test/*/video/*.mp4' --max-clips 20
python evaluate.py --video ds1.mp4 --gt ds1_gt.csv   # score your own labeled clip
```

False positives are split by out-of-view run length:
- **FP_long** — emitting a position inside a genuine (≥3-frame) out-of-view run.
  This is the real bug the confidence floor targets.
- **FP_short** — a ≤2-frame gap embedded in visible flight, almost always the
  shuttle mid-blur with a GT labeling gap (label noise, not a real error).

Measured result (15-clip sample interleaving Amateur / Professional / Test,
match radius 15 px):

| match-conf floor | recall | FP_all | FP_long (bug) | median pos err |
|---|---|---|---|---|
| 0.10 | 0.982 | 0.249 | 0.188 | 1.9 px |
| 0.35 | 0.982 | 0.108 | 0.075 | 1.9 px |
| **0.45** (default) | **0.978** | 0.080 | **0.055** | 1.9 px |
| 0.55 | 0.971 | 0.066 | 0.044 | 1.9 px |

The default floor of 0.45 cuts the genuine-bug rate by ~71% vs. an unguarded
tracker (0.188 → 0.055), at a 0.4 pp recall cost and no change in position
accuracy. (0.35 is "free" — no recall loss — if you want to bias toward recall.)

## Notes
- Frames are processed in triplets (the network needs prev/curr/next); a video
  whose frame count isn't a multiple of 3 drops the trailing 1–2 frames.
- Network input is 288×512; detections are scaled back to source resolution.
- Uses CUDA → MPS → CPU automatically.
- For tracking, detect at a **low** `--threshold` (0.1) so the tracker sees the
  full candidate pool; the confidence floor lives in `track.py`, not `detect.py`.
