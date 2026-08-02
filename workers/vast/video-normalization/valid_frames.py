"""Valid-frame detection: court-visibility NCC + scoreboard-visibility OCR,
combined into keep-ranges plus a compact old→new range manifest.

Ported from the sibling `valid-frames` project (court-det's fast_detector.py
NCC court detector + score-det's read_scores_hd.py scoreboard OCR +
valid-frames' build_rallies.py combine logic). That project hardcodes one
broadcast's geometry (fixed crop pixels, player names, court corners); here
those become per-request parameters since this worker normalizes arbitrary
source videos, not one fixed match.

Definition (unchanged from valid-frames): a frame is valid iff
  the main court camera is visible (NCC hysteresis, no run/gap cleanup --
    cleanup would erase the short cutaways this is meant to detect as invalid)
  AND
  the scoreboard is visible (OCR presence check, sampled once per second).

Detection runs on the *source* video (annotation coordinates are source-native).
normalize_job then does ONE NVDEC encode of the kept ranges (same time-window
primitive as full-timeline segment-parallel) into primary `normalized.mp4`.

Decode cost is one keyframes-only pass (template bootstrap) plus ONE full
decode fanned out to both detectors (NVDEC when available): the NCC stream
and the 1fps scoreboard crops come from a single ffmpeg. OCR overlaps the
band decode via a producer-consumer queue.
"""

from __future__ import annotations

import csv
import logging
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
import cv2
import numpy as np

log = logging.getLogger("video-normalization.valid_frames")

LOG_INTERVAL_SEC = 30.0

# Court NCC detector geometry (matches fast_detector.py's downscale factor;
# not user-configurable since it's an internal detection resolution, not the
# video's actual resolution).
SW, SH = 384, 216
NCC_W, NCC_H = 192, 108
GREEN_LO = np.array([40, 80, 80])
GREEN_HI = np.array([85, 255, 255])

DEFAULT_NCC_ON = 0.80
DEFAULT_NCC_OFF = 0.70
DEFAULT_OCR_CONF_MIN = 0.6
DEFAULT_MIN_VALID_RUN = 5  # frames
# Court NCC sample rate (detection fps). Full-timeline every-frame NCC on long
# broadcasts was ~16 wall-fps and multi-hour; sample at 5 Hz and expand to
# source frame indices. Override with NCC_FPS (0 or "src" = every source frame).
DEFAULT_NCC_FPS = 5.0

# OCR worker threads. CPU: multi-worker helps on fat hosts (cap 4–8). GPU: one
# engine only — measured peak ~19 bands/s @ 1 worker on RTX 5080; multi-worker
# regresses under VRAM contention. Override with OCR_WORKERS.
# OCR_DEVICE=gpu|cpu|auto (default auto): auto uses GPU only after a non-empty
# proof crop (never claim GPU without n_dt/rec_texts > 0).
#
# Det resize: PaddleOCR 3 defaults to limit_side_len=64/min which shrinks
# scoreboard bands too hard and kills detection. Use a sane max-side limit.
OCR_DET_LIMIT_SIDE_LEN = int(os.environ.get("OCR_DET_LIMIT_SIDE_LEN", "960"))
OCR_DET_LIMIT_TYPE = (os.environ.get("OCR_DET_LIMIT_TYPE") or "max").strip() or "max"
# Empty → PaddleOCR default models (PP-OCRv5/v6 series depending on paddleocr).
# CPU hosts often prefer mobile for latency; set explicitly if needed:
#   OCR_DET_MODEL=PP-OCRv5_mobile_det OCR_REC_MODEL=en_PP-OCRv5_mobile_rec
OCR_DET_MODEL = (os.environ.get("OCR_DET_MODEL") or "").strip()
OCR_REC_MODEL = (os.environ.get("OCR_REC_MODEL") or "").strip()

# Avoid mid-job model-source CDN checks when models are already cached/baked.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

_ocr_device_lock = threading.Lock()
_ocr_device_resolved: str | None = None


def _paddle_cuda_available() -> bool:
    try:
        import paddle
        return bool(paddle.device.is_compiled_with_cuda() and paddle.device.cuda.device_count() > 0)
    except Exception:  # noqa: BLE001
        return False


def _make_scoreboard_proof_bgr(w: int = 450, h: int = 220) -> np.ndarray:
    """Synthetic tight scoreboard-like crop for GPU proof (not a product sample)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = (20, 20, 20)
    # High-contrast white text where real BWF bands put names/scores.
    cv2.putText(img, "MIYAZAKI", (20, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)
    cv2.putText(img, "5", (360, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 2)
    cv2.putText(img, "CHEN Y.F.", (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 2)
    cv2.putText(img, "8", (360, 160), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 2)
    return img


def _paddle_ocr_kwargs(device: str) -> dict:
    """Common PaddleOCR constructor kwargs for this worker."""
    kw: dict = {
        "lang": "en",
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "enable_mkldnn": False,
        "device": device,
        "text_det_limit_side_len": OCR_DET_LIMIT_SIDE_LEN,
        "text_det_limit_type": OCR_DET_LIMIT_TYPE,
    }
    if OCR_DET_MODEL:
        kw["text_detection_model_name"] = OCR_DET_MODEL
    if OCR_REC_MODEL:
        kw["text_recognition_model_name"] = OCR_REC_MODEL
    return kw


def _ocr_result_nonempty(result) -> bool:
    """True if a PaddleOCR predict/ocr result has at least one det/rec item."""
    if result is None:
        return False
    # PaddleOCR 3.x predict → list of dict-like results
    if isinstance(result, list):
        if not result:
            return False
        result = result[0]
    if isinstance(result, dict):
        texts = result.get("rec_texts") or []
        polys = result.get("rec_polys") or result.get("dt_polys") or []
        return bool(len(texts) > 0 or len(polys) > 0)
    return False


def _prove_gpu_ocr(device: str = "gpu:0") -> bool:
    """Mandatory GPU gate: non-empty det/rec on a proof crop before using GPU.

    Hard rule: never claim GPU OCR works without n_dt / rec_texts > 0.
    Wrong CUDA index or sm_120 + bad wheel → empty det while models load in VRAM.
    """
    try:
        import paddle
        from paddleocr import PaddleOCR
        try:
            paddle.set_device(device)
        except Exception:  # noqa: BLE001
            pass
        ocr = PaddleOCR(**_paddle_ocr_kwargs(device))
        img = _make_scoreboard_proof_bgr()
        try:
            out = ocr.predict(img)
        except Exception:  # noqa: BLE001
            # Older API fallback
            out = ocr.ocr(img)
        ok = _ocr_result_nonempty(out)
        if not ok:
            log.warning(
                "valid_frames(ocr): GPU proof EMPTY det/rec on %s — fail closed to CPU",
                device,
            )
        else:
            log.info("valid_frames(ocr): GPU proof OK on %s (non-empty det/rec)", device)
        return ok
    except Exception as e:  # noqa: BLE001
        log.warning("valid_frames(ocr): GPU proof failed (%s) — using CPU", e)
        return False


def _resolve_ocr_device() -> str:
    """Resolve OCR_DEVICE once per process: auto|gpu|cpu (+ optional gpu:N).

    auto → GPU only if paddle CUDA is available AND proof crop is non-empty.
    gpu  → still proof; fall back to CPU on empty det (product correctness).
    cpu  → always CPU.
    """
    global _ocr_device_resolved
    with _ocr_device_lock:
        if _ocr_device_resolved is not None:
            return _ocr_device_resolved

        env = (os.environ.get("OCR_DEVICE") or "auto").strip().lower()
        if env in ("cpu", "cpu:0"):
            _ocr_device_resolved = "cpu"
            return _ocr_device_resolved

        want_gpu = env in ("", "auto", "gpu", "gpu:0", "cuda", "cuda:0")
        device = "gpu:0"
        if env not in ("", "auto", "gpu", "gpu:0", "cuda", "cuda:0", "cpu", "cpu:0"):
            # Pass through e.g. gpu:1
            device = env
            want_gpu = device.startswith("gpu") or device.startswith("cuda")

        if not want_gpu:
            _ocr_device_resolved = "cpu"
            return _ocr_device_resolved

        if not _paddle_cuda_available():
            log.info("valid_frames(ocr): paddle CUDA unavailable → cpu")
            _ocr_device_resolved = "cpu"
            return _ocr_device_resolved

        if _prove_gpu_ocr(device if device.startswith("gpu") else "gpu:0"):
            _ocr_device_resolved = device if device.startswith("gpu") else "gpu:0"
        else:
            _ocr_device_resolved = "cpu"
        return _ocr_device_resolved


def _ocr_device() -> str:
    """PaddleOCR device string: 'gpu:0' or 'cpu' (cached after proof)."""
    return _resolve_ocr_device()


def _default_ocr_workers(device: str | None = None) -> int:
    env = os.environ.get("OCR_WORKERS")
    if env is not None and env.strip() != "":
        return max(1, int(env))
    dev = device if device is not None else _ocr_device()
    # GPU: single instance is peak throughput (~19 bands/s on 5080).
    if dev.startswith("gpu"):
        return 1
    cores = os.cpu_count() or 4
    # CPU best around 2–4 workers (measured); soft-cap 4 for scoreboard OCR.
    return max(2, min(4, cores // 4))


def _ocr_workers() -> int:
    """Current OCR worker count (env override or device-aware default)."""
    return _default_ocr_workers()


# Back-compat module attribute: env override if set, else conservative 1.
# detect_valid_ranges uses _default_ocr_workers(resolved_device) instead.
_env_workers = os.environ.get("OCR_WORKERS")
OCR_WORKERS = (
    max(1, int(_env_workers))
    if _env_workers is not None and str(_env_workers).strip() != ""
    else 1
)


def _ncc_fps_from_env(src_fps: float) -> float:
    """Detection sample rate for court NCC; always ≤ source fps."""
    env = (os.environ.get("NCC_FPS") or "").strip().lower()
    if env in ("", "default"):
        rate = DEFAULT_NCC_FPS
    elif env in ("0", "src", "source", "full"):
        return float(src_fps)
    else:
        rate = float(env)
    if rate <= 0:
        return float(src_fps)
    return min(float(src_fps), rate)


def expand_samples_to_source_frames(
    samples: np.ndarray | list,
    *,
    n_src: int,
    src_fps: float,
    sample_fps: float,
) -> np.ndarray:
    """Map per-sample NCC/court decisions onto a full source-frame boolean mask.

    Sample i covers source frames near i * (src_fps / sample_fps). Edges clamp
    to [0, n_src). When sample_fps >= src_fps, samples are treated as 1:1 with
    a length of min(len(samples), n_src).
    """
    samples = np.asarray(samples, dtype=bool)
    n_src = int(n_src)
    out = np.zeros(n_src, dtype=bool)
    if n_src <= 0 or len(samples) == 0:
        return out
    if sample_fps >= src_fps - 1e-6:
        n = min(len(samples), n_src)
        out[:n] = samples[:n]
        return out
    step = float(src_fps) / float(sample_fps)
    for i, val in enumerate(samples):
        if not val:
            continue
        f0 = int(round(i * step))
        f1 = int(round((i + 1) * step))
        f0 = max(0, min(f0, n_src))
        f1 = max(f0 + 1, min(f1, n_src))
        out[f0:f1] = True
    return out

_DIGIT_TOKEN = re.compile(r"^[\d ]+$")
_DIGIT_RE = re.compile(r"\d{1,2}")


def _pipe_frames(cmd):
    """Yield SW x SH BGR frames from an ffmpeg rawvideo-on-stdout command.
    Raises with ffmpeg's stderr tail if the decode itself fails."""
    frame_size = SW * SH * 3
    with tempfile.TemporaryFile("w+") as errf:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errf)
        try:
            while True:
                buf = proc.stdout.read(frame_size)
                if len(buf) < frame_size:
                    break
                yield np.frombuffer(buf, np.uint8).reshape(SH, SW, 3)
            if proc.wait() != 0:
                errf.seek(0)
                raise RuntimeError(
                    f"valid_frames: ffmpeg decode failed (exit {proc.returncode}):\n"
                    + errf.read()[-2000:]
                )
        finally:
            proc.stdout.close()
            proc.terminate()
            proc.wait()


def _probe_video_codec(video_path: str) -> str | None:
    """Best-effort codec_name for the primary video stream (e.g. h264, av1)."""
    try:
        from ffmpeg_ops import probe
        info = probe(video_path)
        codec = (info.get("codec") or info.get("codec_name") or "").strip().lower()
        return codec or None
    except Exception:  # noqa: BLE001
        pass
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name", "-of",
                "default=noprint_wrappers=1:nokey=1", video_path,
            ],
            text=True, timeout=30,
        ).strip().lower()
        return out or None
    except Exception:  # noqa: BLE001
        return None


# Codecs with reliable NVDEC on rent GPUs. AV1+CUDA often fails on stock
# host ffmpeg ("Missing Sequence Header" / assert) — use software for those.
_NVDEC_CODECS = frozenset({"h264", "avc", "hevc", "h265", "mpeg2video", "mpeg4", "vp9"})


def _hwaccel_prefix(video_path: str | None = None) -> list[str]:
    """Use NVDEC when a GPU is present and the codec is supported.

    Output stays system memory (software scale/crop after hw decode). Safe on
    CPU-only hosts (empty prefix). AV1 and unknown codecs force software so
    detect does not hard-fail mid-stream.
    """
    if video_path:
        codec = _probe_video_codec(video_path)
        if codec and codec not in _NVDEC_CODECS:
            log.info(
                "valid_frames(decode): software decode for codec=%s (no reliable NVDEC)",
                codec,
            )
            return []
    try:
        from ffmpeg_ops import use_gpu
        if use_gpu():
            return ["-hwaccel", "cuda", "-hwaccel_device", "0"]
    except Exception:  # noqa: BLE001 — detect must work without GPU probe
        pass
    return []


def _iter_keyframes(video_path):
    """Decode only I-frames (fast, coarse) for reference bootstrapping.

    Uses software decode: ``-skip_frame nokey`` + CUDA hwaccel trips assert
    failures on some builds/codecs (observed with AV1 + 5080 host ffmpeg).
    Keyframe-only SW decode is cheap relative to the full detect pass.
    """
    yield from _pipe_frames([
        "ffmpeg", "-v", "error",
        "-skip_frame", "nokey", "-i", video_path,
        "-vf", f"scale={SW}:{SH}", "-vsync", "0",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ])


def _decode_fanout(video_path, crop, band_dir, *, ncc_fps: float | None = None):
    """Single decode fanned out to both detectors: yields SWxSH NCC frames from
    stdout while the same ffmpeg writes 1fps scoreboard-band JPEGs into
    band_dir. Prefers NVDEC when available (CPU scale after hw decode).

    When ``ncc_fps`` is set and below source rate, the NCC branch uses
    ``fps=ncc_fps`` so we do not rawvideo-pipe every source frame into Python.
    """
    pattern = os.path.join(band_dir, "band_%06d.jpg")
    if ncc_fps is not None and ncc_fps > 0:
        ncc_vf = f"fps={ncc_fps:.6g},scale={SW}:{SH}"
    else:
        ncc_vf = f"scale={SW}:{SH}"
    yield from _pipe_frames([
        "ffmpeg", "-v", "error", *_hwaccel_prefix(video_path), "-i", video_path,
        "-map", "0:v:0", "-vf", ncc_vf,
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
        "-map", "0:v:0",
        "-vf", f"fps=1,crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']}",
        "-q:v", "2", pattern,
    ])


def _gray_small(frame):
    small = cv2.resize(frame, (NCC_W, NCC_H), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)


def _normalize(img):
    z = img - img.mean()
    return z / (np.linalg.norm(z) + 1e-6)


def _green_mask(corners, width, height):
    """Court polygon mask on the SWxSH detection canvas. Corners are in the
    video's own pixel coordinates; ffmpeg's scale=SW:SH stretches to fill, so
    x and y scale independently by the video's actual dimensions."""
    pts = np.array(corners, np.float32)
    pts[:, 0] *= SW / float(width)
    pts[:, 1] *= SH / float(height)
    mask = np.zeros((SH, SW), np.uint8)
    cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
    return mask, max(1, int((mask > 0).sum()))


def _build_court_reference(video_path, mask, area, n_ref=120):
    """Bootstrap the NCC template from the greenest keyframes (memory is
    O(#keyframes), not O(#frames)) -- see fast_detector.py for the rationale."""
    grays, greens = [], []
    for frame in _iter_keyframes(video_path):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        green = cv2.inRange(hsv, GREEN_LO, GREEN_HI)
        greens.append(float((green[mask > 0] > 0).sum()) / area)
        grays.append(_gray_small(frame))
    if not grays:
        raise RuntimeError("valid_frames: no keyframes decoded for court reference bootstrap")
    green_arr = np.array(greens, np.float32)
    grays_arr = np.stack(grays)
    candidates = np.where(green_arr >= 0.88)[0]
    if len(candidates) == 0:
        candidates = np.argsort(green_arr)[-n_ref:]
    step = max(1, len(candidates) // n_ref)
    selected = candidates[::step][:n_ref]
    return _normalize(np.median(grays_arr[selected], axis=0))


def _hysteresis(ncc, on, off):
    n = len(ncc)
    out = np.zeros(n, bool)
    state = False
    for i in range(n):
        state = (state and ncc[i] >= off) or ((not state) and ncc[i] > on)
        out[i] = state
    return out


# Incomplete JPEG / transient decode — consumer may re-queue.
_INCOMPLETE = object()
OCR_IMREAD_RETRIES = 3
OCR_ITEM_TIMEOUT_SEC = float(os.environ.get("OCR_ITEM_TIMEOUT_SEC", "120"))
BAND_QUEUE_PUT_TIMEOUT_SEC = float(os.environ.get("BAND_QUEUE_PUT_TIMEOUT_SEC", "300"))


def _read_scoreboard_frame(ocr, path, sub_crop, row_split_y, name_re, conf_min):
    """Presence check on one band JPEG.

    Returns True/False for present/absent, or `_INCOMPLETE` when the file is
    not yet a readable image (ffmpeg still writing).
    """
    img = cv2.imread(path)
    if img is None:
        return _INCOMPLETE
    x0, y0 = sub_crop["x"], sub_crop["y"]
    x1, y1 = x0 + sub_crop["w"], y0 + sub_crop["h"]
    # Guard empty/out-of-bounds sub-crop on the band.
    h, w = img.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return False
    crop = img[y0:y1, x0:x1]
    result = ocr.predict(crop)[0]

    has_name = False
    top, bot = [], []
    for i, text in enumerate(result["rec_texts"]):
        token = text.strip()
        conf = result["rec_scores"][i]
        if name_re.search(token) and conf > 0.5:
            has_name = True
        if _DIGIT_TOKEN.match(token) and conf > conf_min:
            poly = result["rec_polys"][i]
            cy = sum(p[1] for p in poly) / len(poly)
            digits = _DIGIT_RE.findall(token)
            (top if cy < row_split_y else bot).extend(digits)

    return has_name or (len(top) >= 1 and len(bot) >= 1)


def _ocr_consumer_loop(band_q: queue.Queue, results: dict, sub_crop, row_split_y,
                       name_re, conf_min, stop_token, device: str | None = None):
    """Consume band JPEG paths; write results[idx] = bool.

    Incomplete JPEGs are retried **in place** (sleep + re-read) so retries never
    land after stop tokens and cannot be dropped on a full queue.
    """
    from paddleocr import PaddleOCR
    # enable_mkldnn=False: paddle 3.x OneDNN path crashes on predict with
    # ConvertPirAttribute2RuntimeAttribute (ArrayAttribute<DoubleAttribute>).
    # device: gpu:0 only after proof (see _resolve_ocr_device); else cpu.
    device = device or _ocr_device()
    log.info(
        "valid_frames(ocr worker): device=%s det=%s rec=%s det_limit=%s/%s",
        device,
        OCR_DET_MODEL or "(default)",
        OCR_REC_MODEL or "(default)",
        OCR_DET_LIMIT_SIDE_LEN,
        OCR_DET_LIMIT_TYPE,
    )
    try:
        import paddle
        if device.startswith("gpu"):
            paddle.set_device(device)
    except Exception:  # noqa: BLE001
        pass
    ocr = PaddleOCR(**_paddle_ocr_kwargs(device))
    # First GPU predict can take a while (CUDA/kernel compile); warm with a
    # text-like crop so we also re-check non-empty output.
    if device.startswith("gpu"):
        try:
            warm = _make_scoreboard_proof_bgr()
            t_w = time.time()
            try:
                out = ocr.predict(warm)
            except Exception:  # noqa: BLE001
                out = ocr.ocr(warm)
            if not _ocr_result_nonempty(out):
                log.warning(
                    "valid_frames(ocr warm): empty det on %s after proof — "
                    "continuing but results may be wrong",
                    device,
                )
            log.info("valid_frames(ocr warm): %.1fs on %s", time.time() - t_w, device)
        except Exception as e:  # noqa: BLE001
            log.warning("valid_frames(ocr warm): %s", e)
    while True:
        item = band_q.get()
        if item is stop_token:
            band_q.task_done()
            break
        idx, path = item[0], item[1]
        try:
            ok = _INCOMPLETE
            for attempt in range(OCR_IMREAD_RETRIES):
                ok = _read_scoreboard_frame(
                    ocr, path, sub_crop, row_split_y, name_re, conf_min,
                )
                if ok is not _INCOMPLETE:
                    break
                time.sleep(0.05 * (attempt + 1))
            if ok is _INCOMPLETE:
                log.warning(
                    "valid_frames(ocr item %d): unreadable after %d tries",
                    idx, OCR_IMREAD_RETRIES,
                )
                results[idx] = False
            else:
                results[idx] = bool(ok)
        except Exception as e:  # noqa: BLE001
            log.warning("valid_frames(ocr item %d): %s", idx, e)
            results[idx] = False
        band_q.task_done()


def _runs_of_true(mask, min_len):
    """[start, end] inclusive runs (0-indexed) where mask is True, length >= min_len."""
    runs = []
    i, n = 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            if j - i >= min_len:
                runs.append((i, j - 1))
            i = j
        else:
            i += 1
    return runs


def compute_valid_ranges(court_visible, scoreboard_visible_per_second, fps,
                          min_valid_run=DEFAULT_MIN_VALID_RUN):
    """valid = court_visible (per frame) AND scoreboard_visible (per second,
    upsampled: second N covers frames [round(N*fps), round((N+1)*fps)))."""
    n = len(court_visible)
    svis = np.zeros(n, dtype=bool)
    for second, vis in enumerate(scoreboard_visible_per_second):
        if not vis:
            continue
        f0 = int(round(second * fps))
        f1 = min(int(round((second + 1) * fps)), n)
        svis[f0:f1] = True
    valid = np.asarray(court_visible, dtype=bool) & svis
    return _runs_of_true(valid, min_valid_run)


def detect_valid_ranges(video_path, config, fps, width, height):
    """Run both detectors over `video_path` (source video; annotation geometry
    is in this coordinate system) and return (ranges, total_frame_count),
    where ranges is the sorted list of inclusive (start, end) frame-index
    ranges to keep.

    `config` (required: court_corners, player_names; scoreboard geometry
    should already have defaults applied by the job layer):
      court_corners:   [[x,y]]*4, the main-camera court polygon
      scoreboard_crop: {x,y,w,h}, the scoreboard band sampled at 1fps
      score_sub_crop:  {x,y,w,h}, tight OCR window inside scoreboard_crop
      row_split_y:     y (within score_sub_crop) separating the two score rows
      player_names:    [str, …], anchors for the name-detected heuristic

    Raises if no valid ranges are found (almost certainly a bad config).
    """
    src_fps = float(fps)
    ncc_fps = float(config.get("ncc_fps") or _ncc_fps_from_env(src_fps))
    ncc_fps = min(ncc_fps, src_fps) if ncc_fps > 0 else src_fps
    use_ncc_subsample = ncc_fps < src_fps - 1e-6

    mask, area = _green_mask(config["court_corners"], width, height)
    t0 = time.time()
    ref = _build_court_reference(video_path, mask, area)
    log.info("valid_frames(reference): bootstrapped in %.1fs", time.time() - t0)

    names = [n for n in config["player_names"] if isinstance(n, str) and n.strip()]
    if not names:
        raise RuntimeError("valid_frames: player_names must contain a non-empty name")
    name_re = re.compile("|".join(re.escape(n) for n in names), re.I)
    conf_min = config.get("ocr_conf_min", DEFAULT_OCR_CONF_MIN)
    sub_crop = config["score_sub_crop"]
    row_split_y = config["row_split_y"]

    # Expected source frame count for expanding subsampled NCC → full timeline.
    # Prefer duration*fps when available from probe path; fall back to sample count.
    n_src_hint = config.get("source_frame_count")
    if n_src_hint is not None:
        n_src_hint = int(n_src_hint)

    # Resolve device before spawning workers (GPU proof is process-global).
    ocr_device = _resolve_ocr_device()
    n_ocr_threads = max(1, _default_ocr_workers(ocr_device))

    with tempfile.TemporaryDirectory() as band_dir:
        # Producer-consumer: as band_*.jpg files appear, OCR them while NCC
        # continues consuming the rawvideo pipe. Queue depth 64 is enough for
        # decode overlap with a single fast GPU OCR worker (~19 bands/s).
        q_max = 64 if ocr_device.startswith("gpu") else 256
        band_q: queue.Queue = queue.Queue(maxsize=q_max)
        ocr_results: dict[int, bool] = {}
        stop = object()
        consumers = [
            threading.Thread(
                target=_ocr_consumer_loop,
                args=(band_q, ocr_results, sub_crop, row_split_y,
                      name_re, conf_min, stop, ocr_device),
                daemon=True,
            )
            for _ in range(n_ocr_threads)
        ]
        for t in consumers:
            t.start()

        seen_bands: set[str] = set()
        next_band_idx = 0

        def _enqueue(name: str) -> None:
            nonlocal next_band_idx
            path = os.path.join(band_dir, name)
            try:
                band_q.put(
                    (next_band_idx, path),
                    timeout=BAND_QUEUE_PUT_TIMEOUT_SEC,
                )
            except queue.Full as e:
                raise RuntimeError(
                    "valid_frames: OCR queue stalled (OCR_WORKERS too slow "
                    "or hung PaddleOCR) — increase OCR_WORKERS or timeout"
                ) from e
            next_band_idx += 1
            seen_bands.add(name)

        def poll_new_bands(*, final: bool = False):
            """Enqueue band JPEGs that are safe to read.

            FFmpeg writes files in place; the newest name may still be
            incomplete. Enqueue band N only once band N+1 exists (writer moved
            on), or on final=True after decode EOF (all files complete).
            """
            try:
                names_on_disk = sorted(
                    f for f in os.listdir(band_dir) if f.endswith(".jpg")
                )
            except FileNotFoundError:
                return
            for i, name in enumerate(names_on_disk):
                if name in seen_bands:
                    continue
                if not final and i == len(names_on_disk) - 1:
                    # Newest file may still be open for write.
                    continue
                path = os.path.join(band_dir, name)
                try:
                    if os.path.getsize(path) < 32:
                        if not final:
                            continue
                except OSError:
                    if not final:
                        continue
                _enqueue(name)

        t0 = time.time()
        last_log = t0
        ncc = []
        log.info(
            "valid_frames(detect): src_fps=%.3f ncc_fps=%.3f subsample=%s "
            "ocr_workers=%d ocr_device=%s",
            src_fps, ncc_fps, use_ncc_subsample, n_ocr_threads, ocr_device,
        )
        try:
            for frame in _decode_fanout(
                video_path,
                config["scoreboard_crop"],
                band_dir,
                ncc_fps=ncc_fps if use_ncc_subsample else None,
            ):
                ncc.append(float((_normalize(_gray_small(frame)) * ref).sum()))
                # Poll more often when subsampled (fewer NCC frames per second).
                poll_every = 5 if use_ncc_subsample else 30
                if len(ncc) % poll_every == 0:
                    poll_new_bands(final=False)
                now = time.time()
                if now - last_log >= LOG_INTERVAL_SEC:
                    last_log = now
                    log.info(
                        "valid_frames(decode): %d ncc_samples @ %.0f samp/s "
                        "(ocr bands enqueued %d, qsize~%d)",
                        len(ncc),
                        len(ncc) / max(now - t0, 1e-6),
                        next_band_idx,
                        band_q.qsize(),
                    )
            poll_new_bands(final=True)  # final flush — all bands complete
        finally:
            for _ in consumers:
                try:
                    band_q.put(stop, timeout=BAND_QUEUE_PUT_TIMEOUT_SEC)
                except queue.Full as e:
                    raise RuntimeError(
                        "valid_frames: could not deliver OCR stop token "
                        "(queue full — OCR stalled)"
                    ) from e
            hung = []
            for t in consumers:
                t.join(timeout=OCR_ITEM_TIMEOUT_SEC * 2)
                if t.is_alive():
                    hung.append(t.name or "ocr-consumer")
            if hung:
                raise RuntimeError(
                    f"valid_frames: OCR consumer(s) hung after join timeout: {hung}"
                )

        court_samples = _hysteresis(
            np.array(ncc, np.float32),
            config.get("ncc_on", DEFAULT_NCC_ON),
            config.get("ncc_off", DEFAULT_NCC_OFF),
        )
        log.info(
            "valid_frames(court): %d samples in %.1fs, %d visible (ncc_fps=%.2f)",
            len(court_samples), time.time() - t0, int(court_samples.sum()), ncc_fps,
        )

        # Fail-closed: every enqueued band index must have a result.
        n_seconds = next_band_idx
        missing = [i for i in range(n_seconds) if i not in ocr_results]
        if missing:
            raise RuntimeError(
                f"valid_frames: OCR missing results for {len(missing)} band "
                f"index(es) (e.g. {missing[:5]}); refusing partial scoreboard mask"
            )
        svis = [bool(ocr_results[i]) for i in range(n_seconds)]
        log.info("valid_frames(scoreboard): %d seconds, %d visible (overlapped OCR)",
                 n_seconds, sum(svis))

    # Expand court samples to source frame grid when subsampled.
    if use_ncc_subsample:
        n_src = n_src_hint
        if n_src is None:
            # Prefer OCR timeline (1 sample/sec) * src_fps as duration proxy.
            n_src = max(
                int(round(len(court_samples) * (src_fps / ncc_fps))),
                int(round(n_seconds * src_fps)),
                len(court_samples),
            )
        court = expand_samples_to_source_frames(
            court_samples, n_src=n_src, src_fps=src_fps, sample_fps=ncc_fps,
        )
    else:
        court = np.asarray(court_samples, dtype=bool)
        n_src = len(court)

    ranges = compute_valid_ranges(
        court, svis, src_fps, config.get("min_valid_run", DEFAULT_MIN_VALID_RUN),
    )
    if not ranges:
        raise RuntimeError(
            "valid_frames: no valid frame ranges found -- check court_corners "
            "and scoreboard_crop/score_sub_crop against this video"
        )
    return ranges, n_src


def output_frame_count_for_range(n_src: int, src_fps: float, out_fps: float) -> int:
    """Approximate delivery frame count for a source keep-run after fps=out_fps.

    Encode applies fps=min(src, MAX_FPS); for 60→30 this is ~half the source
    frames. Uses round(n_src * out/src) with a floor of 1 for non-empty runs.
    **Approximate:** actual ffmpeg fps-filter output may differ by ±1 frame per
    range due to timestamp rounding; sufficient for remapping / duration estimates.
    """
    if n_src <= 0:
        return 0
    if not src_fps or src_fps <= 0 or not out_fps or out_fps <= 0:
        return n_src
    if abs(out_fps - src_fps) < 1e-6:
        return n_src
    return max(1, int(round(n_src * out_fps / src_fps)))


def build_range_manifest(ranges, src_fps: float | None = None,
                         out_fps: float | None = None):
    """Compact range map: list of
    {old_start, old_end, new_start, new_end} (all inclusive).

    old_* index the **source** (detection) frame timeline.
    new_* index the **cleaned output** after delivery fps cap
    (out_fps = min(src_fps, MAX_FPS)). When src_fps/out_fps omitted, 1:1.
    """
    out = []
    new_idx = 0
    for old_start, old_end in ranges:
        n_src = old_end - old_start + 1
        if src_fps is not None and out_fps is not None:
            n_out = output_frame_count_for_range(n_src, src_fps, out_fps)
        else:
            n_out = n_src
        new_start = new_idx
        new_end = new_idx + n_out - 1 if n_out > 0 else new_idx - 1
        out.append({
            "old_start": old_start,
            "old_end": old_end,
            "new_start": new_start,
            "new_end": new_end,
        })
        new_idx = new_end + 1 if n_out > 0 else new_idx
    return out


def write_range_manifest_csv(range_manifest, path):
    """Write compact ranges CSV (not one row per frame)."""
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["old_start", "old_end", "new_start", "new_end"])
        for r in range_manifest:
            w.writerow([r["old_start"], r["old_end"], r["new_start"], r["new_end"]])


def count_kept_frames(ranges, src_fps: float | None = None,
                      out_fps: float | None = None) -> int:
    """Kept frame count in source space (default) or output space when fps given."""
    if src_fps is None or out_fps is None:
        return sum(end - start + 1 for start, end in ranges)
    total = 0
    for start, end in ranges:
        total += output_frame_count_for_range(end - start + 1, src_fps, out_fps)
    return total


def kept_duration_sec(ranges, src_fps: float) -> float:
    if not src_fps or src_fps <= 0:
        return 0.0
    return sum((end - start + 1) / src_fps for start, end in ranges)
