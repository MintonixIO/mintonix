"""Court-visibility NCC only. Scoreboard OCR is not used.

Decode: keyframes for template bootstrap + subsampled NCC pass (NVDEC when
a short trial succeeds).
"""

from __future__ import annotations

import csv
import logging
import os
import subprocess
import tempfile
import time

import numpy as np

log = logging.getLogger("video-preprocess.bwf.detect")


def _cv2():
    import cv2
    return cv2

LOG_INTERVAL_SEC = float(os.environ.get("VALID_FRAMES_LOG_INTERVAL_SEC", "15"))

SW, SH = 384, 216
NCC_W, NCC_H = 192, 108
GREEN_LO = np.array([40, 80, 80])
GREEN_HI = np.array([85, 255, 255])

DEFAULT_NCC_ON = 0.80
DEFAULT_NCC_OFF = 0.70
DEFAULT_MIN_VALID_RUN = 5
DEFAULT_NCC_FPS = 5.0


def _ncc_fps_from_env(src_fps: float) -> float:
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
    """Map per-sample decisions onto a full source-frame boolean mask."""
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


def _pipe_frames(cmd):
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


def _hwaccel_prefix(video_path: str) -> list[str]:
    """Try one NVDEC setup; fall back to software decode."""
    try:
        from normalize import use_gpu
        if not use_gpu():
            return []
    except Exception:  # noqa: BLE001
        return []

    codec = ""
    try:
        from normalize import probe
        codec = (probe(video_path).get("codec") or "").lower()
    except Exception:  # noqa: BLE001
        pass

    candidates: list[list[str]] = []
    if codec == "av1":
        candidates.append(
            ["-hwaccel", "cuda", "-hwaccel_device", "0", "-c:v", "av1_cuvid"]
        )
    candidates.append(["-hwaccel", "cuda", "-hwaccel_device", "0"])

    for prefix in candidates:
        cmd = [
            "ffmpeg", "-v", "error", *prefix, "-i", video_path,
            "-frames:v", "3", "-f", "null", "-",
        ]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if p.returncode == 0:
                log.info("valid_frames(decode): NVDEC via %s", " ".join(prefix))
                return list(prefix)
        except Exception:  # noqa: BLE001
            continue
    log.info("valid_frames(decode): software decode (NVDEC trial failed)")
    return []


def _iter_keyframes(video_path):
    yield from _pipe_frames([
        "ffmpeg", "-v", "error",
        "-skip_frame", "nokey", "-i", video_path,
        "-vf", f"scale={SW}:{SH}", "-vsync", "0",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ])


def _decode_ncc(video_path, *, ncc_fps: float | None = None):
    if ncc_fps is not None and ncc_fps > 0:
        ncc_vf = f"fps={ncc_fps:.6g},scale={SW}:{SH}"
    else:
        ncc_vf = f"scale={SW}:{SH}"
    yield from _pipe_frames([
        "ffmpeg", "-v", "error", *_hwaccel_prefix(video_path), "-i", video_path,
        "-vf", ncc_vf,
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ])


def _gray_small(frame):
    cv2 = _cv2()
    small = cv2.resize(frame, (NCC_W, NCC_H), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)


def _normalize(img):
    z = img - img.mean()
    return z / (np.linalg.norm(z) + 1e-6)


def _green_mask(corners, width, height):
    cv2 = _cv2()
    pts = np.array(corners, np.float32)
    pts[:, 0] *= SW / float(width)
    pts[:, 1] *= SH / float(height)
    mask = np.zeros((SH, SW), np.uint8)
    cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
    return mask, max(1, int((mask > 0).sum()))


def _build_court_reference(video_path, mask, area, n_ref=120):
    cv2 = _cv2()
    grays, greens = [], []
    for frame in _iter_keyframes(video_path):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        green = cv2.inRange(hsv, GREEN_LO, GREEN_HI)
        greens.append(float((green[mask > 0] > 0).sum()) / area)
        grays.append(_gray_small(frame))
    if not grays:
        raise RuntimeError(
            "valid_frames: no keyframes decoded for court reference bootstrap"
        )
    green_arr = np.array(greens, np.float32)
    grays_arr = np.stack(grays)
    candidates = np.where(green_arr >= 0.88)[0]
    if len(candidates) == 0:
        candidates = np.argsort(green_arr)[-n_ref:]
    step = max(1, len(candidates) // n_ref)
    selected = candidates[::step][:n_ref]
    return _normalize(np.median(grays_arr[selected], axis=0))


def hysteresis(ncc, on, off):
    n = len(ncc)
    out = np.zeros(n, bool)
    state = False
    for i in range(n):
        state = (state and ncc[i] >= off) or ((not state) and ncc[i] > on)
        out[i] = state
    return out


def runs_of_true(mask, min_len):
    """Inclusive [start, end] runs of True with length >= min_len."""
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


def compute_valid_ranges(court_visible, min_valid_run=DEFAULT_MIN_VALID_RUN):
    return runs_of_true(np.asarray(court_visible, dtype=bool), min_valid_run)


def detect_valid_ranges(video_path, config, fps, width, height):
    """Court-only detect. Returns (ranges, total_frame_count, timings)."""
    src_fps = float(fps)
    ncc_fps = float(config.get("ncc_fps") or _ncc_fps_from_env(src_fps))
    ncc_fps = min(ncc_fps, src_fps) if ncc_fps > 0 else src_fps
    use_ncc_subsample = ncc_fps < src_fps - 1e-6

    timings: dict[str, float] = {}
    t_all = time.time()

    mask, area = _green_mask(config["court_corners"], width, height)

    t = time.time()
    ref = _build_court_reference(video_path, mask, area)
    timings["reference_sec"] = round(time.time() - t, 2)
    log.info("valid_frames(reference): %.1fs", timings["reference_sec"])

    n_src_hint = config.get("source_frame_count")
    if n_src_hint is not None:
        n_src_hint = int(n_src_hint)
    ncc_expect = None
    if n_src_hint and src_fps > 0:
        if use_ncc_subsample:
            ncc_expect = max(1, int(round(n_src_hint * (ncc_fps / src_fps))))
        else:
            ncc_expect = int(n_src_hint)

    log.info(
        "valid_frames(detect): src_fps=%.3f ncc_fps=%.3f subsample=%s",
        src_fps, ncc_fps, use_ncc_subsample,
    )

    ncc: list[float] = []
    t0 = time.time()
    last_log = t0
    t = time.time()
    for frame in _decode_ncc(
        video_path,
        ncc_fps=ncc_fps if use_ncc_subsample else None,
    ):
        ncc.append(float((_normalize(_gray_small(frame)) * ref).sum()))
        now = time.time()
        if now - last_log >= LOG_INTERVAL_SEC:
            last_log = now
            rate = len(ncc) / max(now - t0, 1e-6)
            extra = ""
            if ncc_expect and ncc_expect > 0:
                extra = f" {100.0 * min(1.0, len(ncc) / ncc_expect):.0f}%"
            log.info(
                "valid_frames(decode): %d/%s @ %.1f samp/s%s",
                len(ncc), ncc_expect or "?", rate, extra,
            )
    timings["ncc_decode_sec"] = round(time.time() - t, 2)

    t = time.time()
    court_samples = hysteresis(
        np.array(ncc, np.float32),
        config.get("ncc_on", DEFAULT_NCC_ON),
        config.get("ncc_off", DEFAULT_NCC_OFF),
    )

    if use_ncc_subsample:
        n_src = n_src_hint
        if n_src is None:
            n_src = max(
                int(round(len(court_samples) * (src_fps / ncc_fps))),
                len(court_samples),
            )
        court = expand_samples_to_source_frames(
            court_samples, n_src=n_src, src_fps=src_fps, sample_fps=ncc_fps,
        )
    else:
        court = np.asarray(court_samples, dtype=bool)
        n_src = len(court)

    ranges = compute_valid_ranges(
        court, config.get("min_valid_run", DEFAULT_MIN_VALID_RUN),
    )
    timings["range_build_sec"] = round(time.time() - t, 2)
    timings["detect_total_sec"] = round(time.time() - t_all, 2)

    if not ranges:
        raise RuntimeError(
            "valid_frames: no valid frame ranges found — check court_corners"
        )

    kept = sum(e - s + 1 for s, e in ranges)
    log.info(
        "valid_frames(ranges): %d ranges, kept=%d/%d",
        len(ranges), kept, n_src,
    )
    return ranges, n_src, timings


def output_frame_count_for_range(n_src: int, src_fps: float, out_fps: float) -> int:
    if n_src <= 0:
        return 0
    if not src_fps or src_fps <= 0 or not out_fps or out_fps <= 0:
        return n_src
    if abs(out_fps - src_fps) < 1e-6:
        return n_src
    return max(1, int(round(n_src * (out_fps / src_fps))))


def build_range_manifest(ranges, src_fps: float | None = None,
                         out_fps: float | None = None):
    """Compact range map: list of {old_start, old_end, new_start, new_end}."""
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
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["old_start", "old_end", "new_start", "new_end"])
        for r in range_manifest:
            w.writerow([r["old_start"], r["old_end"], r["new_start"], r["new_end"]])
