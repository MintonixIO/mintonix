# BWF Detect Pipeline — Test & Optimize Plan (RTX 5090)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible baseline of the simplified detect pipeline on a real BWF broadcast clip, measure where time and quality go, and only then apply the smallest optimizations that the data justify.

**Architecture:** SSH into the RTX 5090 host, stage code + cached models, fetch one fixed BWF source, run detect via `debug.py` (OpenCV → pose TRT → TrackNet PyTorch → stream `detections.json`), profile stages, review quality overlays, then optimize bottlenecks in priority order without reintroducing deleted complexity (no ReID, no producer/hold concurrency, no multi-range I/O).

**Tech Stack:** CUDA / TensorRT pose engine (prebuilt, cached), PyTorch TrackNetV5, OpenCV decode, `debug.py` harness, `tools/visualize_detections.py`.

## Global Constraints

- **Fixed source video:** `https://www.youtube.com/watch?v=jeCAaKRvXy4` (BWF broadcast). Do not swap clips mid-campaign without re-baselining.
- **Detect core only:** optimize `detect.VideoDetector` (and helpers it calls). Use `debug.py` for all runs — **not** FastAPI / jobs / callback / CDN.
- **No complexity revival without evidence:** do not reintroduce producer threads, hold FSM, ReID, multi-range download, or multi-ffmpeg product feed unless a measured bottleneck requires it and a simpler fix failed.
- **One job per GPU:** keep serial pose → shuttle on one device.
- **TRT engine is cached:** pose `.engine` is already built for this host (or will be present before bench starts). **Never include TRT export/build time in detect timings.** Only measure after models load.
- **Timing scope:** wall clock = download (if any) + detect + JSON write + resource sampling. Exclude: engine build, pip install, code rsync, YouTube fetch when source is already cached.
- **Raw YouTube is fine:** no normalize / `normalized.mp4` requirement for this campaign. Quality scores are on the broadcast source as downloaded.
- **Artifacts under one run dir:** every run writes to a dated out dir; never overwrite the baseline without renaming.

---

## Why this video

| | |
|---|---|
| URL | `https://www.youtube.com/watch?v=jeCAaKRvXy4` |
| Kind | BWF broadcast (scoreboard, multi-person, fast shuttle, cuts/replays possible) |
| Why | Stresses pose clutter, shuttle heatmap noise, and long-form decode |

Input for all runs: **yt-dlp source** (or ffmpeg cuts of it). No production envelope.

---

## File map (existing tools — prefer these)

| Path | Role in this plan |
|---|---|
| `workers/vast/video-det/debug.py` | End-to-end harness: local/YouTube → detect → resources + efficiency |
| `workers/vast/video-det/detect/__init__.py` | Orchestrator (chunk size, pose→shuttle) |
| `workers/vast/video-det/detect/shuttle.py` | TrackNet micro-batch ≤16; main shuttle cost candidate |
| `workers/vast/video-det/tools/visualize_detections.py` | Overlay quality review clips |
| `workers/vast/video-det/tools/run_ds1_eval.py` | Pattern for GPU logging + timing (refs not required) |

**New files only if needed during execution:**

| Path | When |
|---|---|
| `workers/vast/video-det/tools/profile_detect_stages.py` | If stage splits (decode / pose / shuttle / json) are missing |
| `/data/bwf-bench/jeCAaKRvXy4/` on server | Baseline + experiment notes |

---

## Success criteria

### Must have (baseline complete)

- [ ] Cached models load; `VideoDetector` constructs without error (**load time noted separately, not in detect fps**)
- [ ] Time-bounded run on the fixed video produces `detections.json` + `result.json` + resource samples
- [ ] Detect numbers recorded: wall sec, fps_e2e, realtime factor, peak GPU util/mem, peak RSS, frame count
- [ ] At least 3 quality preview clips (rally start, mid-rally, scoreboard/cut-heavy segment)

### Timing rules (explicit)

| Include in detect metrics | Exclude from detect metrics |
|---|---|
| OpenCV decode | TRT engine build / export |
| Pose inference | Model weight download |
| Shuttle inference | `pip install`, rsync, venv setup |
| JSON stream write | Cold process start before first chunk (optional: note separately) |
| Resource monitor overhead (small) | YouTube download when source already on disk |

First CUDA/TRT **graph capture / warmup** may inflate the first chunk — note cold vs steady if obvious; prefer full-run e2e fps for A/B, not “after build.”

### Optimize only if baseline shows a clear bottleneck

| If you see… | Prefer this first |
|---|---|
| GPU util low, CPU high during detect | Decode bottleneck → faster decode / larger chunks / less host work |
| GPU util high, shuttle dominates stage time | Shuttle PyTorch path → micro-batch size, AMP, then TRT export *as a later project* |
| Pose dominates | Batch/chunk use of **cached** engine; CUDA graph already on — no rebuild-in-loop |
| Quality bad (missed shuttle / ghost poses) | Conf thresholds, K peaks, **not** concurrency |
| JSON write ≥15% of wall | Serialization only |

### Out of scope for this campaign

- TRT pose engine rebuild (assumed cached; one-time setup only if missing, never timed)
- Production contract: FastAPI `/detect/sync`, jobs callback, presigned I/O, CDN
- Normalize stage / `normalized.mp4` fidelity
- Wiring analyze, ReID / `player_id`
- Multi-GPU or multi-job parallelism
- Labeled BWF accuracy suite (unless labels appear later)

---

### Task 1: Host access + environment inventory

**Files:** none (ops only)

**Produces:** inventory notes (CUDA, GPU name, free disk, **cached** model paths)

- [ ] **Step 1: SSH in and confirm hardware**

```bash
ssh <user>@<5090-host>
hostname
nvidia-smi
python3 --version
df -h / /data /tmp 2>/dev/null | head -20
free -h
```

Expected: 5090-class GPU, driver loaded, ≥50 GB free under `/data` or `/tmp`.

- [ ] **Step 2: Point at cached models (required before any timed run)**

```bash
ls -la /app/models /opt/models /data/models 2>/dev/null
find /app /opt /data -name '*.engine' 2>/dev/null | head
find /app /opt /data -name 'tracknetv5.pt' 2>/dev/null | head

export POSE_ENGINE=/path/to/cached.engine
export SHUTTLE_CKPT=/path/to/tracknetv5.pt
export ALLOW_FILE_URLS=1
```

If engine or ckpt is missing, **stop and obtain/copy the cached artifacts** (or one-time build outside the bench clock). Do not fold that work into detect timings.

- [ ] **Step 3: Stage code**

```bash
# laptop → host
rsync -az --exclude venv --exclude '__pycache__' --exclude '.git' \
  workers/vast/video-det/ \
  <user>@<5090-host>:/opt/video-det/
```

```bash
cd /opt/video-det
python3 -m venv .venv && source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
pip install yt-dlp
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

- [ ] **Step 4: Load smoke (untimed setup check)**

```bash
cd /opt/video-det && source .venv/bin/activate
export POSE_ENGINE=... SHUTTLE_CKPT=...
python - <<'PY'
from detect import DetectConfig, VideoDetector
cfg = DetectConfig.from_env()
det = VideoDetector.from_config(cfg)
print("ok batch", det.pose_batch, "conf", cfg.conf)
PY
```

Record `pose_batch` (drives chunk size). This load is **setup**, not a detect metric.

---

### Task 2: Acquire the fixed BWF source (untimed if cached)

**Files:** none (ops); uses yt-dlp

**Produces:** `/data/bwf-bench/jeCAaKRvXy4/source.*`

- [ ] **Step 1: Create run tree**

```bash
export BENCH_ROOT=/data/bwf-bench/jeCAaKRvXy4
export RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BENCH_ROOT/source" "$BENCH_ROOT/runs"
echo "RUN_ID=$RUN_ID"
```

- [ ] **Step 2: Download once; reuse for all experiments**

```bash
yt-dlp -f 'bv*[height<=1080]+ba/b[height<=1080]' \
  --merge-output-format mkv \
  -o "$BENCH_ROOT/source/%(id)s.%(ext)s" \
  'https://www.youtube.com/watch?v=jeCAaKRvXy4'

ls -lh "$BENCH_ROOT/source/"
ffprobe -hide_banner "$BENCH_ROOT/source/jeCAaKRvXy4."* 2>&1 | head -40
```

Record: duration, resolution, fps, codec, file size.  
**Download wall time is setup**, not detect throughput (unless you explicitly re-run cold download experiments later).

---

### Task 3: Time-bounded first detect (sanity)

**Files:**
- Use: `workers/vast/video-det/debug.py`
- Use: `workers/vast/video-det/tools/visualize_detections.py`

**Produces:** short-clip baseline under `$BENCH_ROOT/runs/<id>-smoke`

Full BWF matches can be 30–60+ minutes. Do **not** start with a full-length run.

- [ ] **Step 1: Cut a 60–90s smoke segment (ffmpeg, untimed setup)**

```bash
export SRC=$BENCH_ROOT/source/jeCAaKRvXy4.mkv   # actual extension
export SMOKE_MP4=$BENCH_ROOT/source/smoke_90s.mp4
ffmpeg -y -ss 00:05:00 -t 90 -i "$SRC" -c:v libx264 -preset fast -crf 18 -an "$SMOKE_MP4"
```

- [ ] **Step 2: Timed detect on smoke clip**

```bash
cd /opt/video-det && source .venv/bin/activate
export POSE_ENGINE=... SHUTTLE_CKPT=... ALLOW_FILE_URLS=1
export OUT_SMOKE=$BENCH_ROOT/runs/${RUN_ID}-smoke
python debug.py "$SMOKE_MP4" --out "$OUT_SMOKE" --skip-speedtest
```

Use local file path so `result.json` detect wall is **not** polluted by YouTube download.

Expected artifacts:

| File | Check |
|---|---|
| `detections.json` | non-empty `frames`, poses + shuttle keys |
| `result.json` | frame_count, detect wall, fps, efficiency notes |
| `resources.jsonl` | GPU util series |

- [ ] **Step 3: Record smoke metrics**

Write `$OUT_SMOKE/NOTES.md`:

```markdown
# Smoke jeCAaKRvXy4 @ 00:05:00 +90s
- frames:
- detect_wall_sec:   # from result.json; models already loaded path
- fps_e2e:
- realtime_factor:   # video_duration / detect_wall
- peak_gpu_util:
- peak_gpu_mem_mb:
- peak_rss_mb:
- pose_batch:
- excluded: TRT build, yt-dlp, ffmpeg cut
```

- [ ] **Step 4: Visual quality sample**

```bash
python tools/visualize_detections.py \
  --video "$SMOKE_MP4" \
  --detections "$OUT_SMOKE/detections.json" \
  --start 0 --end 900 \
  --out "$OUT_SMOKE/preview.mp4" \
  --png-dir "$OUT_SMOKE/pngs" --png-every 30 \
  --scale 0.5
```

Note: court poses? shuttle track during rallies? scoreboard ghosts?

---

### Task 4: Longer baseline (comparison root)

**Files:** same as Task 3

**Produces:** `$BENCH_ROOT/runs/<id>-baseline/` — **do not delete**

- [ ] **Step 1: Choose baseline length**

| Option | When |
|---|---|
| 10 minutes of play | Default first baseline |
| Full downloaded video | Overnight / disk allows |

Default: **10 minutes** starting at the same offset as smoke.

```bash
export BASE_MP4=$BENCH_ROOT/source/baseline_10m.mp4
ffmpeg -y -ss 00:05:00 -t 600 -i "$SRC" -c:v libx264 -preset fast -crf 18 -an "$BASE_MP4"
```

- [ ] **Step 2: Timed baseline**

```bash
export OUT_BASE=$BENCH_ROOT/runs/${RUN_ID}-baseline
mkdir -p "$OUT_BASE"
nvidia-smi --query-gpu=timestamp,utilization.gpu,utilization.memory,memory.used,power.draw,temperature.gpu \
  --format=csv -l 1 > "$OUT_BASE/gpu.csv" &
SMI_PID=$!

python debug.py "$BASE_MP4" --out "$OUT_BASE" --skip-speedtest
kill $SMI_PID 2>/dev/null || true
```

- [ ] **Step 3: Freeze baseline numbers in `$OUT_BASE/BASELINE.md`**

```text
detect_wall_sec = …          # pure detect + json from result.json
fps_e2e = frames / detect_wall_sec
realtime_factor = video_duration_sec / detect_wall_sec
# >1 ⇒ faster than realtime
```

- [ ] **Step 4: Three quality windows**

```bash
for range in "0:900" "4500:5400" "9000:9900"; do
  s=${range%:*}; e=${range#*:}
  python tools/visualize_detections.py \
    --video "$BASE_MP4" \
    --detections "$OUT_BASE/detections.json" \
    --start "$s" --end "$e" \
    --out "$OUT_BASE/preview_${s}_${e}.mp4" \
    --scale 0.5 --shuttle-min-conf 0.05
done
```

Human score (1–5) for pose / shuttle per window in `BASELINE.md`.

---

### Task 5: Stage profiling (find the real bottleneck)

**Files:**
- Add if needed: `workers/vast/video-det/tools/profile_detect_stages.py`
- Read: `detect/__init__.py`, `detect/shuttle.py`, `pose/engine.py`

**Produces:** split of **detect wall only**: decode_read | pose | shuttle | json_write  
(Still excludes TRT build.)

- [ ] **Step 1: Instrument stage timers (minimal)**

If missing, add a debug-only profiler around:

1. OpenCV `cap.read` for a chunk  
2. pose batch  
3. shuttle `process_frames`  
4. JSON serialize+write  

```python
# tools/profile_detect_stages.py — implement only if needed
# for each chunk: t_read, t_pose, t_shuttle, n_frames
# write stages.json + print % of detect wall
```

- [ ] **Step 2: Run on the same `BASE_MP4`**

```bash
export OUT_PROF=$BENCH_ROOT/runs/${RUN_ID}-profile
python tools/profile_detect_stages.py --video "$BASE_MP4" --out "$OUT_PROF"
```

- [ ] **Step 3: Classify bottleneck**

| Share of detect wall | Classification | Next |
|---|---|---|
| pose ≥ 50% | Pose-bound | Task 6A |
| shuttle ≥ 50% | Shuttle-bound | Task 6B |
| decode/read ≥ 30% and GPU util low | Decode-bound | Task 6C |
| json ≥ 15% | Serialize-bound | Task 6D |
| balanced, GPU util < 60% | Scheduling / serial gap | 6C then 6B |

**Stop rule:** only implement the top 1–2 optimizations indicated by this table.

---

### Task 6A: Pose-bound optimizations (only if Task 5 says so)

**Files:** `pose/engine.py`, `detect/__init__.py` (`_chunk_size`)

Levers (**no engine rebuild in the loop**):

1. Confirm CUDA graphs already engaged on the cached engine  
2. Batch/chunk alignment (`_chunk_size` vs `pose_batch`)  
3. Raise chunk cap only with RAM proof (`_MAX_CHUNK`)  

- [ ] A/B one change at a time on `BASE_MP4`  
- [ ] Keep only if ≥10% e2e fps gain or clear quality win  
- [ ] Re-check smoke preview for regressions  

---

### Task 6B: Shuttle-bound optimizations (likely)

**Files:** `detect/shuttle.py` (`_MAX_TRIPLETS = 16`), `detect/tracknet.py`

Levers (cheapest first):

1. **Micro-batch size** 8 / 16 / 32 — fps + peak VRAM  
2. **AMP / FP16** if not already  
3. Host triplet prep cost  
4. TrackNet **TRT export** only as a *follow-up project* after 1–3 plateau (export time still not part of detect fps)

```bash
# If SHUTTLE_MAX_TRIPLETS env exists or is added as a one-line knob:
for t in 8 16 32; do
  export SHUTTLE_MAX_TRIPLETS=$t
  python debug.py "$BASE_MP4" --out "$BENCH_ROOT/runs/${RUN_ID}-shuttle-t$t" --skip-speedtest
done
```

- [ ] Keep best setting; quality-check shuttle peak track  

---

### Task 6C: Decode-bound / low GPU util

**Files:** `detect/__init__.py`

1. Local SSD path (not network mount)  
2. Read-only OpenCV FPS vs e2e fps  
3. Chunk size if Python overhead dominates  
4. **Reject** multi-producer unless decode ≫ GPU wait and simple fixes fail  

- [ ] Measure read-only FPS (no models)  
- [ ] Apply only the smallest change that moves e2e ≥10%  

---

### Task 6D: JSON bound (unlikely)

**Files:** `debug.py` write path only

- [ ] Confirm streaming write  
- [ ] Optimize only if json ≥15% of detect wall  

---

### Task 7: Decision memo + stop

**Produces:** `$BENCH_ROOT/DECISION.md`

- [ ] **Step 1: Fill memo**

```markdown
# BWF detect bench — jeCAaKRvXy4

## Host
- GPU / driver / torch:
- POSE_ENGINE / SHUTTLE_CKPT (cached paths):

## Timing policy
- detect metrics exclude: TRT build, model fetch, yt-dlp, ffmpeg cuts, env setup
- detect metrics include: decode + pose + shuttle + json write

## Baseline
- input: local cut of yt-dlp source
- duration / frames:
- detect_wall_sec / fps_e2e / realtime_factor:
- peak GPU util / mem / RSS:
- stage split: pose% / shuttle% / decode% / json%

## Quality (1–5)
- pose / shuttle / notes:

## Changes kept / rejected
- …

## Recommended single follow-up
- …
```

- [ ] **Step 2: Sync run dirs of interest to laptop**

```bash
rsync -az <user>@<5090-host>:/data/bwf-bench/jeCAaKRvXy4/runs/ ./bwf-bench-runs/
```

- [ ] **Step 3: Stop** — no second optimization wave without a new baseline

---

## Experiment hygiene

1. **One variable per run** — name out dirs after the variable (`…-shuttle-t32`).  
2. **Same `BASE_MP4`** for all A/B comparisons.  
3. **Models preloaded path:** do not time engine build; optional separate note for process cold-start.  
4. **Thermal:** note power/temp from `gpu.csv` if clocks drop.  
5. **Quality glance** on every speed win.  

---

## Suggested timeline (detect-focused)

| Phase | Notes |
|---|---|
| Task 1 env + load cached models | Setup (untimed) |
| Task 2 yt-dlp + ffmpeg cuts | Setup (untimed) |
| Task 3 smoke 90s | **First timed detect** |
| Task 4 baseline 10 min | **Primary timed detect** |
| Task 5 profile | ~1× baseline detect cost |
| Task 6 one optimization wave | 1–3 baseline re-runs |
| Task 7 memo | Wrap-up |

---

## What you will provide next

1. SSH: `user@host` (+ key/jump if any)  
2. Paths to **cached** `POSE_ENGINE` + `SHUTTLE_CKPT`  

Then: Tasks 1→4 first; Task 6 only with Task 5 evidence.

---

## Self-review

| Requirement | Covered by |
|---|---|
| Fixed BWF `jeCAaKRvXy4` | Task 2 + constraints |
| RTX 5090 SSH | Task 1 |
| TRT build not in timing | Constraints + timing rules + Task 1 load-only |
| No production contract work | Out of scope; `debug.py` only; Task 8 removed |
| Test before optimize | Tasks 3–5 before 6 |
| No complexity revival | Constraints + 6C reject |
| Concrete commands | Every task |
