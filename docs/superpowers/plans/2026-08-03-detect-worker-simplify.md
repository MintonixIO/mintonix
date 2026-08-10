# Detect Worker Simplification Plan

> **For agentic workers:** Execute inline or task-by-task. Checkboxes track progress.

**Goal:** Make `workers/vast/video-det` simple and robust: download → pose + shuttle → stream JSON → upload → callback. Delete concurrency, optional ReID, and download parallelism that are not needed for the current product.

**Architecture:** Single-threaded OpenCV decode; serial GPU pose then shuttle; stream I/O; no ReID until jobs ships masks.

**Tech Stack:** Python, FastAPI, OpenCV, PyTorch TrackNet, TensorRT pose, httpx.

## Global Constraints

- Preserve job envelope: `request_id`, `input_url`, `output_upload_url`, `callback_url`, `callback_token`
- Preserve `detections.json` shape (frames with poses + shuttle); `player_id` may stay always `null`
- Preserve serial pose → shuttle (one GPU)
- No multi-ffmpeg product path; leave `tools/ffmpeg_pose_bench` alone (non-product)
- CPU-safe tests must pass without CUDA/torch where previously they did
- Do not add features; only delete and simplify

---

### Task 1: Remove ReID from product path

**Files:**
- Delete: `workers/vast/video-det/detect/reid.py`
- Modify: `detect/config.py`, `detect/__init__.py`, `detect/types.py` (keep `player_id: null`), `server.py`, `Dockerfile`, docs
- Modify tests: drop ReID suites
- Jobs: update comment in `supabase/functions/jobs/index.ts` (no mask field)

**Produces:** Product path has zero ReID/mask code.

- [x] Delete `reid.py` and all imports/branches (`player_mask_url`, `REID_ENGINE`, match/seed)
- [x] Keep JSON `player_id: null` for schema stability
- [x] Tests green for remaining suite

---

### Task 2: Single-threaded `VideoDetector.run()`

**Files:**
- Rewrite: `workers/vast/video-det/detect/__init__.py`
- Update: `server.py` consumer of generator

**Produces:**

```python
def run(self, video_path: str | Path) -> Generator[list[FrameResult], None, None]:
    ...
```

- No producer thread, Queue, EOS Event, or held-frame state machine
- Single-thread read; optional one-frame peek so shuttle `prev`/`next` stay correct at chunk seams
- Yield `list[FrameResult]` only (no progress triple)
- `_process_chunk(frames, indices, *, prev_frame, next_frame)` — pose then shuttle only

- [x] Implement rewrite
- [x] Update `server.py` loop
- [x] Replace concurrency tests with simple multi-chunk + zero-frame + open-fail tests

---

### Task 3: Thin `io_util.py`

**Files:**
- Rewrite: `workers/vast/video-det/io_util.py`
- Rewrite: `workers/vast/video-det/test_io_util.py`

**Keep:** stream GET, size cap, upload retries, callback retries, URL redaction, minimal `file://` for benchmark (`ALLOW_FILE_URLS`, read `/app`+`/tmp`, write `/tmp` only), no redirects.

**Delete:** multi-range parallel download, `DL_CONNECTIONS`, range probe, `MAX_MASK_BYTES`.

- [x] Implement thin io_util
- [x] Tests for stream download, upload, callback, file:// allowlist, redact

---

### Task 4: Flatten pose TRT surface

**Files:**
- Modify: `pose/trt_runtime.py`, `pose/engine.py`
- Update product import tests

**Produces:** `PoseEngine.run_batch` is the only product call path; internal helper may still use CUDA graph, but no public multi-buffer API / K parameter.

- [x] Add private `infer(host) -> ndarray` (or inline stage/run/sync inside `run_batch`)
- [x] Drop product tests that assert multi-K rejection vocabulary if API is private

---

### Task 5: Docs + config cleanup

**Files:**
- `ARCHITECTURE.md`, `README.md`, `entrypoint.sh`, `Dockerfile`, `detect/config.py`
- `tools/run_ds1_eval.py` if it passes `player_mask`

- [x] Docs match simplified design
- [x] Env: drop `REID_ENGINE` default from Dockerfile

---

### Task 6: Full test run

```bash
cd workers/vast/video-det
python3 -m unittest test_contract.py test_io_util.py test_server_contract.py test_detect_pipeline.py -v
```

- [x] All expected tests pass (skip torch/CUDA-only as before)
