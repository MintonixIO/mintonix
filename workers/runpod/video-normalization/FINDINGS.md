# Video Normalization — Pipeline Validation & GPU Benchmarks

Findings from running the `video-normalization` worker on two rented GPU
instances (RTX 4090 and RTX 5080) against a real 4K60 source. Covers two bugs
found and fixed, full utilization data, and the analysis of how fast the pipeline
can go.

- **Date:** 2026-06-22 / 23
- **Source file (`dl1.mp4`):** h264 / yuv420p, **3840×2160 @ 59.94 fps**, AAC,
  **36.6 min (2196.08 s)**, 2.79 GB. All I- and P-frames, **no B-frames**
  (GOP = `I` + 11×`P`, I-frame every 12 frames).
- **Normalization target:** 1920×1080, ≤30 fps, h264 / yuv420p, AAC.
  This source hits the full transcode path: `scale_cuda` 4K→1080p + fps cap 30 +
  `h264_nvenc` (NVDEC-decoded).

---

## 1. Environment constraint: the worker can't run "as a container" on these hosts

Both instances are **vast.ai unprivileged Docker containers**. Docker-in-Docker
is explicitly blocked (no `dockerd`, no `nvidia-container-toolkit`), and a macOS
dev box has no NVIDIA GPU — so the worker's Docker image cannot be *run* in either
place. However, each instance already provides the exact environment the
`Dockerfile` builds (`/dev/nvidiaN`, `h264_nvenc`, `scale_cuda`), so the handler
was run **natively** there and the GPU path engages identically. For GPU work on
vast.ai, treat the instance itself as the container.

---

## 2. Bugs found and fixed

### Bug A — fps cap stretched output to 2× duration (both GPU and CPU paths)
The fps cap was applied as `-r 30` **before** `-i` (an *input* option), which
*reinterprets* a 59.94 fps source as 30 fps — stretching the output to ~2×
duration (slow motion) instead of dropping frames. A 30 s clip produced a 60 s
output. It affected **both** the GPU and CPU branches for any >30 fps source.

The existing e2e test missed it because `sample.mov` is 30 fps and the test
asserted output fps but **not** duration.

- **Fix:** removed the input `-r 30`; added `fps=30` to the filter chain. On the
  GPU path the `fps` filter sits ahead of `scale_cuda` and passes CUDA hwframes
  through untouched (verified). The CPU path already had `fps=30`.
- **Regression guard added:** the e2e test now asserts
  `output.duration ≈ source.duration`.
- **Verified:** 30 s clip → 30.001 s out, 30 fps; full file → 2196.08 s out
  (exact match), 65 882 frames.

### Bug B — GPU silently disabled on multi-GPU hosts
`_has_gpu()` hardcoded a check for `/dev/nvidia0`. The 5080 instance was on a
multi-GPU host and had been assigned **`/dev/nvidia3`** (no `nvidia0`), so the
check false-negatived and the worker **silently fell back to CPU `libx264`** even
though NVENC worked fine.

- **Fix:** detect any assigned GPU via `glob("/dev/nvidia[0-9]*")` (matches
  `nvidia0`, `nvidia3`, … but not `nvidiactl` / `nvidia-modeset`).
- **Verified:** after the fix the 5080 ran the full `h264_nvenc` + `scale_cuda`
  path.

Both fixes are in `handler.py`; the regression assertion is in `test_handler.py`.
All 12 unit tests pass locally.

---

## 3. Full-run results (`dl1.mp4`, single stream, fixed pipeline)

| Metric | RTX 4090 (128-core host) | RTX 5080 (48-core host) |
|---|---|---|
| **Wall time** | **482 s** | **164 s** (≈ 2.9× faster) |
| Throughput | 4.6× realtime, ~138 fps | 13.6× realtime, ~405 fps |
| ffmpeg `speed=` | 4.61× | 13.6× |
| **NVDEC (decode)** | **avg 98.5%, peak 100% (saturated)** | avg 49%, peak 50% |
| NVENC (encode) | avg 13.4%, peak 15% | avg 33%, peak 35% |
| SM / compute (`scale_cuda`) | avg 2.0% | avg 3.9% |
| VRAM | avg 872 MB, peak 903 MB | avg 760 MB, peak 770 MB |
| Power | avg 74 W, peak 81 W | avg 69 W, peak 71 W |
| CPU during run | 4.8% of 128 cores | 9.7% of 48 cores |
| Output | 1920×1080, 30 fps, h264, yuv420p, AAC, 2196.08 s, 2.27 GB | same spec, 2.13 GB |

**Key reading:** `utilization.gpu` (the headline `nvidia-smi` number) showed only
~2% on both cards because it measures the SM/compute engine. The real work is on
the fixed-function **NVDEC/NVENC** engines, which only show up in
`nvidia-smi dmon -s u` (enc/dec columns). Always monitor those for transcode
workloads.

The 4090 is **decode-bound** (single NVDEC pegged at 100%). The 5080's Blackwell
NVDEC is far faster, so a single job leaves both engines half-idle.

---

## 4. How to go faster — measured

All numbers below are aggregate throughput on a 120 s 4K60 segment, `null` muxer.

### GPU parallelism (multiple concurrent transcodes)
| Concurrency | RTX 4090 | RTX 5080 |
|---|---|---|
| 1 | 4.43× | 12.95× |
| 2 | 4.51× (flat) | **24.91× (≈2× scaling)** |
| 3 | 4.53× | 25.22× (saturated) |
| 4 | — | 25.30× (saturated) |

- **4090:** no gain — the single NVDEC is already saturated by one stream.
- **5080:** ~2× gain at concurrency 2, then saturates. Both engines have exactly
  enough headroom for a second stream.

### NVENC preset sweep (5080, single job)
p1 = 13.01×, p4 = 13.10×, p7 = 11.40×. **Preset is irrelevant to speed** — the
encoder is never the bottleneck. (Use p4/p7 for quality at no throughput cost.)

### Decode isolation (5080) — proves the wall is NVDEC
Decode-only throughput equals full-pipeline throughput, so scale + encode are
free / fully overlapped:

| | decode-only | full pipeline |
|---|---|---|
| single | 13.08× | 13.10× |
| conc2 | 25.34× | 24.91× |
| conc3 | 25.53× | 25.36× |

### Decode-frame-skipping — not viable
The source is **all I/P frames, zero B-frames**; every frame is a reference frame
in an unbroken chain to the next I-frame. There are no non-reference frames to
drop, so `-skip_frame nonref` produced a broken/near-empty file (measured "585×"
= garbage). The 30 fps decimation can only happen *after* full decode.

### CPU hybrid (4090 only)
The 4090 host had 128 idle cores and `libx264` never touches NVDEC, so running one
GPU + one CPU job simultaneously stacks:

- CPU `libx264` alone: peak **3.32×** (single worker; degrades with concurrency —
  6 workers thrash to 0.89×).
- **Hybrid GPU + CPU: 4.40× → 6.20×** (≈1.4× / +40%, for free).

Not worth it on the 5080 (only 48 cores, and the GPU already has headroom).

### Single-file latency: segment-parallel transcode
A single file is one decode stream, so concurrency only helps *throughput* — until
you split the file into segments and transcode them as parallel decode streams,
then concat. Verified on the 5080:

- Split `dl1.mp4` into 4 keyframe-aligned segments (stream copy) → transcode all 4
  concurrently → lossless concat.
- **Wall time 164 s → 85 s (≈1.9× faster)**, output correct (1920×1080, 30 fps,
  2196.14 s). 4 segments hit 25.8× realtime = the chip's NVDEC ceiling.

---

## 5. Is 85 s the floor on one 5080? — Yes

Chain of evidence:
1. Decode is the only cost (decode-only == full pipeline).
2. NVDEC is saturated (~25.5× plateau across concurrency).
3. Decode can't be reduced (all-reference frame structure → no skippable frames).

85 s ≈ the time for this 5080's NVDEC to decode every frame of a 36-min 4K60
stream. You can't process the file faster than you can decode it, and you can't
decode it less or faster on this chip.

**Ways below 85 s** (none possible on a single unchanged 5080):
- **More decode hardware** — split across N GPUs → ~85/N s (linear). The real lever.
- **A lower-cost source** — ≤30 fps or ≤1080p decodes proportionally faster
  (a 1080p30 master ≈ 8× faster). Not applicable here.
- **A GPU with higher total NVDEC throughput** (more/newer engines) raises the
  25.5× ceiling — different hardware, not "faster on this 5080."

---

## 6. Recommendations

1. **Land both bug fixes** (fps duration, GPU device glob) — done in `handler.py`
   / `test_handler.py`. Without Bug B's fix the worker silently runs on CPU on any
   GPU index ≠ 0.
2. **Monitor NVDEC/NVENC, not `utilization.gpu`** — use `nvidia-smi dmon -s u`.
   Alert on dec/enc %, not the SM number.
3. **For batch throughput:** the 5080 is the clear winner — ~3× the 4090's
   single-stream speed and 2× concurrency headroom, at lower power. Run **2
   concurrent jobs per 5080**.
4. **For single-file latency:** add an optional **segment-parallel** path (auto-
   split when duration exceeds a threshold, N concurrent encodes, keyframe-aligned
   concat, audio re-encoded per segment). Cuts a long file's wall-clock to the
   NVDEC ceiling (~25.5× realtime on a 5080).
5. **Hardware choice for this decode-bound 4K workload:** prefer cards by total
   NVDEC throughput, not raw FLOPs/NVENC. The 4090 (1 NVDEC) is decode-walled;
   Blackwell decodes far faster. Compute and NVENC sit nearly idle either way.

---

## Note on data location

This document is the durable record. The transcoded outputs
(`dl1_normalized.mp4`, `joined.mp4`) and raw per-second logs
(`runlogs_full/{gpu_dmon,gpu_query,cpu,handler}.log`) lived only on the two rented
instances, which are no longer reachable. The numbers above were captured from
those runs. The source `dl1.mp4` and the code fixes are local in this directory.
