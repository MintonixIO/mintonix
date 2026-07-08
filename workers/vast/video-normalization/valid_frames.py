"""Valid-frame detection: court-visibility NCC + scoreboard-visibility OCR,
combined into "keep these frames" ranges plus an old->new frame-index manifest.

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

Detection runs on the already-normalized video (not the raw source), so court
NCC and scoreboard OCR coordinates are in that single, consistent coordinate
system/frame-rate -- no cross-resolution or cross-fps frame-index mapping.
normalize_job forces that video to CFR when this feature is requested, so
frame index n and timestamp n/fps agree.

This module only detects and maps: it returns keep-ranges, the manifest, and
the ffmpeg `select` expression. normalize.py owns the actual encode -- the
encoder choice and progress-logging convention live there, once.

Decode cost is one keyframes-only pass (template bootstrap) plus ONE full
decode fanned out to both detectors: the NCC stream and the 1fps scoreboard
crops come from a single ffmpeg invocation (verified byte-identical to
separate passes in the sibling project's SYSTEM.md) -- decode dominates
detection time, so it isn't done twice.
"""

import csv
import logging
import os
import re
import subprocess
import tempfile
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


def _iter_keyframes(video_path):
    """Decode only I-frames (fast, coarse) for reference bootstrapping."""
    yield from _pipe_frames([
        "ffmpeg", "-v", "error", "-skip_frame", "nokey", "-i", video_path,
        "-vf", f"scale={SW}:{SH}", "-vsync", "0",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ])


def _decode_fanout(video_path, crop, band_dir):
    """Single full decode fanned out to both detectors: yields the SWxSH NCC
    frames from stdout while the same ffmpeg writes 1fps scoreboard-band JPEGs
    into band_dir."""
    pattern = os.path.join(band_dir, "band_%06d.jpg")
    yield from _pipe_frames([
        "ffmpeg", "-v", "error", "-i", video_path,
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


def _read_scoreboard_frame(ocr, path, sub_crop, row_split_y, name_re, conf_min):
    """True iff the scoreboard reads as present: a player name is detected,
    or at least one digit token appears in each of the two score rows (split
    by row_split_y)."""
    img = cv2.imread(path)
    if img is None:
        return False
    x0, y0 = sub_crop["x"], sub_crop["y"]
    x1, y1 = x0 + sub_crop["w"], y0 + sub_crop["h"]
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


def _ocr_scoreboard(band_paths, sub_crop, row_split_y, player_names, conf_min):
    """Per-second scoreboard-visibility mask over the extracted band JPEGs."""
    from paddleocr import PaddleOCR  # heavy import, deferred so the pure-logic
                                       # helpers stay importable/testable
                                       # without the OCR runtime.

    names = [n for n in player_names if n.strip()]
    if not names:
        # An empty alternation would match every token and silently degrade
        # validity to court-only. Validated upfront too; this is the backstop.
        raise RuntimeError("valid_frames: player_names must contain a non-empty name")
    name_re = re.compile("|".join(re.escape(n) for n in names), re.I)
    ocr = PaddleOCR(lang="en", use_doc_orientation_classify=False,
                     use_doc_unwarping=False, use_textline_orientation=False)

    t0 = time.time()
    last_log = t0
    visible = []
    for path in band_paths:
        visible.append(
            _read_scoreboard_frame(ocr, path, sub_crop, row_split_y, name_re, conf_min)
        )
        now = time.time()
        if now - last_log >= LOG_INTERVAL_SEC:
            last_log = now
            log.info("valid_frames(ocr): %d/%d seconds @ %.1f/s",
                     len(visible), len(band_paths), len(visible) / (now - t0))
    log.info("valid_frames(scoreboard): %d seconds in %.1fs, %d visible",
             len(visible), time.time() - t0, sum(visible))
    return visible


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
    """Run both detectors over `video_path` (a CFR video of the given fps and
    dimensions -- the coordinate system `config` geometry is expressed in) and
    return (ranges, total_frame_count), where ranges is the sorted list of
    inclusive (start, end) frame-index ranges to keep.

    `config` (all required except the ncc_on/off, ocr_conf_min, min_valid_run
    tunables, which default to the valid-frames project's operating point):
      court_corners:   [[x,y]]*4, the main-camera court polygon
      scoreboard_crop: {x,y,w,h}, the scoreboard band sampled at 1fps
      score_sub_crop:  {x,y,w,h}, tight OCR window inside scoreboard_crop
      row_split_y:     y (within score_sub_crop) separating the two score rows
      player_names:    [str, str], anchors for the name-detected heuristic

    Raises if no valid ranges are found (almost certainly a bad config).
    """
    mask, area = _green_mask(config["court_corners"], width, height)
    t0 = time.time()
    ref = _build_court_reference(video_path, mask, area)
    log.info("valid_frames(reference): bootstrapped in %.1fs", time.time() - t0)

    with tempfile.TemporaryDirectory() as band_dir:
        t0 = time.time()
        last_log = t0
        ncc = []
        for frame in _decode_fanout(video_path, config["scoreboard_crop"], band_dir):
            ncc.append(float((_normalize(_gray_small(frame)) * ref).sum()))
            now = time.time()
            if now - last_log >= LOG_INTERVAL_SEC:
                last_log = now
                log.info("valid_frames(decode): %d frames @ %.0f fps",
                         len(ncc), len(ncc) / (now - t0))
        court = _hysteresis(np.array(ncc, np.float32),
                            config.get("ncc_on", DEFAULT_NCC_ON),
                            config.get("ncc_off", DEFAULT_NCC_OFF))
        log.info("valid_frames(court): %d frames in %.1fs, %d visible",
                 len(court), time.time() - t0, int(court.sum()))

        bands = sorted(
            os.path.join(band_dir, f) for f in os.listdir(band_dir) if f.endswith(".jpg")
        )
        svis = _ocr_scoreboard(
            bands, config["score_sub_crop"], config["row_split_y"],
            config["player_names"], config.get("ocr_conf_min", DEFAULT_OCR_CONF_MIN),
        )

    ranges = compute_valid_ranges(
        court, svis, fps, config.get("min_valid_run", DEFAULT_MIN_VALID_RUN),
    )
    if not ranges:
        raise RuntimeError(
            "valid_frames: no valid frame ranges found -- check court_corners "
            "and scoreboard_crop/score_sub_crop against this video"
        )
    return ranges, len(court)


def build_frame_manifest(ranges):
    """[(old_start, old_end), ...] (sorted, non-overlapping, inclusive) ->
    list of (old_frame, new_frame) pairs; new indices are sequential in kept
    (chronological) order."""
    manifest = []
    new_idx = 0
    for old_start, old_end in ranges:
        for old_idx in range(old_start, old_end + 1):
            manifest.append((old_idx, new_idx))
            new_idx += 1
    return manifest


def write_manifest_csv(manifest, path):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["old_frame", "new_frame"])
        w.writerows(manifest)


def build_select_expr(ranges):
    """ffmpeg `select` filter boolean expression keeping frame numbers `n`
    that fall in any of `ranges` (inclusive)."""
    return "+".join(f"between(n,{a},{b})" for a, b in ranges)
