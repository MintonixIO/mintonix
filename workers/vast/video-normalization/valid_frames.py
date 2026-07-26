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

# OCR worker threads. Default scales with host cores (cap 8): PaddleOCR is
# partly GIL-bound but multi-worker still overlaps I/O + native ops on fat
# rented hosts (e.g. 48-core 5080 boxes). Override with OCR_WORKERS.
def _default_ocr_workers() -> int:
    env = os.environ.get("OCR_WORKERS")
    if env is not None and env.strip() != "":
        return max(1, int(env))
    cores = os.cpu_count() or 4
    # ~1 worker per 4 cores, floor 2, ceil 8.
    return max(2, min(8, cores // 4))


OCR_WORKERS = _default_ocr_workers()

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


def _hwaccel_prefix() -> list[str]:
    """Use NVDEC when a GPU is present so detect doesn't burn CPU on 4K decode.

    Output stays system memory (software scale/crop after hw decode). Safe on
    CPU-only hosts (empty prefix).
    """
    try:
        from ffmpeg_ops import use_gpu
        if use_gpu():
            return ["-hwaccel", "cuda", "-hwaccel_device", "0"]
    except Exception:  # noqa: BLE001 — detect must work without GPU probe
        pass
    return []


def _iter_keyframes(video_path):
    """Decode only I-frames (fast, coarse) for reference bootstrapping."""
    yield from _pipe_frames([
        "ffmpeg", "-v", "error", *_hwaccel_prefix(),
        "-skip_frame", "nokey", "-i", video_path,
        "-vf", f"scale={SW}:{SH}", "-vsync", "0",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ])


def _decode_fanout(video_path, crop, band_dir):
    """Single full decode fanned out to both detectors: yields the SWxSH NCC
    frames from stdout while the same ffmpeg writes 1fps scoreboard-band JPEGs
    into band_dir. Prefers NVDEC when available (CPU scale after hw decode)."""
    pattern = os.path.join(band_dir, "band_%06d.jpg")
    yield from _pipe_frames([
        "ffmpeg", "-v", "error", *_hwaccel_prefix(), "-i", video_path,
        "-map", "0:v:0", "-vf", f"scale={SW}:{SH}",
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
                       name_re, conf_min, stop_token):
    """Consume band JPEG paths; write results[idx] = bool.

    Incomplete JPEGs are retried **in place** (sleep + re-read) so retries never
    land after stop tokens and cannot be dropped on a full queue.
    """
    from paddleocr import PaddleOCR
    # enable_mkldnn=False: paddle 3.x OneDNN path crashes on predict with
    # ConvertPirAttribute2RuntimeAttribute (ArrayAttribute<DoubleAttribute>).
    ocr = PaddleOCR(
        lang="en",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )
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

    with tempfile.TemporaryDirectory() as band_dir:
        # Producer-consumer: as band_*.jpg files appear, OCR them while NCC
        # continues consuming the rawvideo pipe.
        band_q: queue.Queue = queue.Queue(maxsize=64)
        ocr_results: dict[int, bool] = {}
        stop = object()
        n_ocr_threads = max(1, OCR_WORKERS)
        consumers = [
            threading.Thread(
                target=_ocr_consumer_loop,
                args=(band_q, ocr_results, sub_crop, row_split_y,
                      name_re, conf_min, stop),
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
        try:
            for frame in _decode_fanout(video_path, config["scoreboard_crop"], band_dir):
                ncc.append(float((_normalize(_gray_small(frame)) * ref).sum()))
                # Poll for new band JPEGs every ~30 frames to overlap OCR.
                if len(ncc) % 30 == 0:
                    poll_new_bands(final=False)
                now = time.time()
                if now - last_log >= LOG_INTERVAL_SEC:
                    last_log = now
                    log.info("valid_frames(decode): %d frames @ %.0f fps (ocr queued %d)",
                             len(ncc), len(ncc) / (now - t0), next_band_idx)
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

        court = _hysteresis(np.array(ncc, np.float32),
                            config.get("ncc_on", DEFAULT_NCC_ON),
                            config.get("ncc_off", DEFAULT_NCC_OFF))
        log.info("valid_frames(court): %d frames in %.1fs, %d visible",
                 len(court), time.time() - t0, int(court.sum()))

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

    ranges = compute_valid_ranges(
        court, svis, fps, config.get("min_valid_run", DEFAULT_MIN_VALID_RUN),
    )
    if not ranges:
        raise RuntimeError(
            "valid_frames: no valid frame ranges found -- check court_corners "
            "and scoreboard_crop/score_sub_crop against this video"
        )
    return ranges, len(court)


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
