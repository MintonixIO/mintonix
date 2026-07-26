#!/usr/bin/env python3
"""Annotate a video and create a pipeline job — the local browser-UI stand-in.

Simulates the website flow end to end (ARCHITECTURE.md §2b/§2c): pick a
video, click the court corners, click the players (each click prompts
**SlimSAM** point segmentation locally — the same model class the browser
will run via transformers.js — and the mask-derived bbox becomes the label
evidence), then create the job through Supabase.

Two source modes:

  YouTube (BWF broadcast) — the system ingest lane. The worker downloads the
  video itself; this script POSTs `matches-ingest` with the pipeline token
  (owner_id null, constructable prefix `bwf/<match_id>/`). Geometry is printed
  as `annotation.json` shape; materializing that file under `bwf/…` is a
  service-side follow-up (clients cannot write the BWF namespace).

    python3 scripts/annotate_and_ingest.py \
        --url "https://www.youtube.com/watch?v=…" \
        --tournament "2025 BWF World Championships" --dispatch
    # scrub a local copy of the SAME video: add --file worlds_final.mkv

  Local file (user upload) — the browser lane, exactly §2b: sign in as the
  dev test user, presign via cdn-access (op:"upload"), PUT original.mp4 to B2
  under `users/<uid>/<match_id>/`, confirm via matches-ingest `{id, upload:true}`
  (user JWT), then PUT `annotation.json` through the same cdn-access path.
  No scoreboard steps: valid-frames/OCR is BWF-broadcast-only.

    python3 scripts/annotate_and_ingest.py --file my_match.mp4 --dispatch

  --dry-run annotates and prints everything, writes nothing anywhere.

UI flow (one OpenCV window; Enter accepts a step, Esc goes back):
    pick frame     a/d ±2s, s/w ±30s, z/x ±10min — a RALLY frame, court fully
                   visible (+ scoreboard overlay up, for BWF)
    court corners  click 4 points, order TL → TR → BR → BL (worker contract)
    players        click a player → SlimSAM segments them → mask+box shown →
                   type their name IN THE TERMINAL (for BWF, exactly as the
                   scoreboard shows it — that string is what the OCR matches)

The BWF scoreboard geometry is NOT annotated: the OCR crop is fixed to the
top-left quadrant of the frame (scoreboard_crop = score_sub_crop = quadrant,
row_split_y = quadrant midline). With a crop that coarse the digit-rows
fallback is a guess, so valid-frames hinges on the NAME matches.

Coordinate contract (SUPABASE.md annotation.json / valid_frames.py):
    corners          video-native (source) pixels
    scoreboard_crop  {x,y,w,h} absolute pixels on the source frame
    score_sub_crop   {x,y,w,h} INSIDE scoreboard_crop (band-relative 0,0)
    row_split_y      y INSIDE score_sub_crop
Detection runs on the *source* (not pre-normalized video). The worker then
writes the cleaned court∧scoreboard cut to normalized.mp4 (detect always
reads that key). Annotate on the same stream the worker will fetch
(YouTube best format bv*+ba/b, or --file); refuse mismatched resolution.

Secrets from ~/.mintonix/dev-secrets.env: PIPELINE_SERVICE_TOKEN (BWF ingest
+ dispatch), SUPABASE_ANON_KEY + SUPABASE_TEST_EMAIL/PASSWORD (upload lane).
SlimSAM needs `pip install torch transformers` (first run downloads ~150 MB
of weights from Hugging Face). DEV only.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

import cv2
import numpy as np

SECRETS_FILE = os.path.expanduser("~/.mintonix/dev-secrets.env")
FUNCTIONS_BASE = "https://xaxyuytvgcdbdnndhgwj.supabase.co/functions/v1"
# Same format preference as the worker's download_youtube() — annotation
# coordinates are only valid at the resolution the pipeline will process.
YTDLP_FORMAT = "bv*/b"
MAX_DISPLAY_W, MAX_DISPLAY_H = 1400, 850
WINDOW = "annotate"


def load_secrets() -> dict:
    secrets = {}
    try:
        with open(SECRETS_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    secrets[k] = v
    except FileNotFoundError:
        pass
    return secrets


# ---------------------------------------------------------------- video sources


class FrameSource:
    """Random-access frames by timestamp, from a local file or a remote stream."""

    def __init__(self, path_or_url: str, duration: float | None):
        self.cap = cv2.VideoCapture(path_or_url)
        if not self.cap.isOpened():
            raise RuntimeError(f"OpenCV could not open {path_or_url[:80]}…")
        self.duration = duration or (
            self.cap.get(cv2.CAP_PROP_FRAME_COUNT) / (self.cap.get(cv2.CAP_PROP_FPS) or 30)
        )
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    def frame_at(self, t: float) -> np.ndarray | None:
        self.cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
        ok, frame = self.cap.read()
        return frame if ok else None


class FfmpegSnapshotSource:
    """Fallback for streams OpenCV can't seek (e.g. some AV1/webm formats):
    one ffmpeg fast-seek snapshot per requested timestamp (~1–3 s each)."""

    def __init__(self, url: str, duration: float, width: int, height: int):
        self.url, self.duration, self.width, self.height = url, duration, width, height

    def frame_at(self, t: float) -> np.ndarray | None:
        with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
            r = subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0.0, t):.3f}",
                 "-i", self.url, "-frames:v", "1", tmp.name],
                capture_output=True, text=True, timeout=60,
            )
            if r.returncode != 0:
                return None
            return cv2.imread(tmp.name)


def probe_youtube(url: str) -> dict:
    """Resolve the best-format stream URL + geometry via yt-dlp."""
    r = subprocess.run(
        ["yt-dlp", "-f", YTDLP_FORMAT, "--no-playlist",
         "--print", "%(width)s %(height)s %(duration)s %(id)s", "--print", "urls", url],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {r.stderr.strip()[:400]}")
    lines = r.stdout.strip().splitlines()
    w, h, dur, vid = lines[0].split()
    return {"width": int(w), "height": int(h), "duration": float(dur),
            "video_id": vid, "stream_url": lines[1]}


def open_source(args) -> tuple[object, dict | None]:
    yt = probe_youtube(args.url) if args.url else None
    if args.file:
        src = FrameSource(args.file, None)
        if yt and (src.width, src.height) != (yt["width"], yt["height"]):
            sys.exit(
                f"--file is {src.width}x{src.height} but the pipeline will process this "
                f"YouTube video at {yt['width']}x{yt['height']} (yt-dlp {YTDLP_FORMAT}); "
                "crop coordinates would not transfer. Re-download at best quality "
                "or drop --file to annotate the remote stream."
            )
        return src, yt
    assert yt is not None
    try:
        src = FrameSource(yt["stream_url"], yt["duration"])
        if src.frame_at(min(60.0, yt["duration"] / 2)) is None:
            raise RuntimeError("stream opened but frames unreadable")
        return src, yt
    except Exception as e:
        print(f"[info] OpenCV can't read the stream ({e}); falling back to "
              "per-seek ffmpeg snapshots (slower per keypress — consider --file)")
        return FfmpegSnapshotSource(yt["stream_url"], yt["duration"],
                                    yt["width"], yt["height"]), yt


# ---------------------------------------------------------------- SlimSAM

class SlimSam:
    """Point-prompted segmentation, mirroring the browser design (§2c): the
    image encoder runs ONCE per frame, then each click is a cheap mask-decoder
    pass against the cached embedding — same split transformers.js uses."""

    MODEL_ID = "Zigeng/SlimSAM-uniform-77"

    def __init__(self):
        try:
            import torch
            from transformers import SamModel, SamProcessor
        except ImportError:
            sys.exit("SlimSAM needs torch + transformers:  pip install torch transformers")
        self.torch = torch
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"[info] loading SlimSAM ({self.MODEL_ID}) on {self.device}…")
        self.model = SamModel.from_pretrained(self.MODEL_ID).to(self.device).eval()
        self.processor = SamProcessor.from_pretrained(self.MODEL_ID)
        self._rgb = None
        self._embeddings = None

    def set_image(self, frame_bgr: np.ndarray) -> None:
        self._rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        t0 = time.monotonic()
        inputs = self.processor(images=self._rgb, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            self._embeddings = self.model.get_image_embeddings(inputs["pixel_values"])
        print(f"[info] frame encoded in {time.monotonic() - t0:.1f}s "
              "(one-time; each click is now fast)")

    def click(self, x: int, y: int) -> tuple[np.ndarray, list[int], float]:
        """Decode the mask for one click. Returns (bool mask HxW, bbox
        [x,y,w,h] native px, iou score of the chosen mask)."""
        assert self._embeddings is not None, "set_image first"
        # Keep sizes on CPU: MPS has no float64, and post-processing wants CPU.
        inputs = self.processor(
            images=self._rgb, input_points=[[[float(x), float(y)]]],
            return_tensors="pt")
        points = inputs["input_points"].to(self.device, dtype=self.torch.float32)
        with self.torch.no_grad():
            out = self.model(input_points=points,
                             image_embeddings=self._embeddings,
                             multimask_output=True)
        masks = self.processor.image_processor.post_process_masks(
            out.pred_masks.cpu(), inputs["original_sizes"],
            inputs["reshaped_input_sizes"])[0][0]   # (3, H, W) bool
        scores = out.iou_scores[0][0].cpu()
        # SAM's three masks are part/subpart/whole granularities and argmax-iou
        # sometimes picks a part (a click on shorts segments just the shorts).
        # Prefer the LARGEST mask among those scoring near the top — for a
        # click on a person that reliably selects the whole body.
        near_top = [i for i in range(len(scores))
                    if float(scores[i]) >= float(scores.max()) - 0.15]
        best = max(near_top, key=lambda i: int(masks[i].sum()))
        mask = masks[best].numpy().astype(bool)
        ys, xs = np.nonzero(mask)
        if xs.size == 0:
            raise RuntimeError("SlimSAM returned an empty mask for this click")
        bbox = [int(xs.min()), int(ys.min()),
                int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
        return mask, bbox, float(scores[best])


# ---------------------------------------------------------------- upload lane

def sign_in_test_user(secrets: dict) -> tuple[str, str]:
    """Password-grant sign-in as the dev test user → (access_token, uid).
    This is what makes the script's cdn-access/matches-ingest calls
    indistinguishable from the browser's."""
    need = ["SUPABASE_ANON_KEY", "SUPABASE_TEST_EMAIL", "SUPABASE_TEST_PASSWORD"]
    if any(k not in secrets for k in need):
        sys.exit(f"upload lane needs {'/'.join(need)} in {SECRETS_FILE}")
    req = urllib.request.Request(
        "https://xaxyuytvgcdbdnndhgwj.supabase.co/auth/v1/token?grant_type=password",
        method="POST",
        data=json.dumps({"email": secrets["SUPABASE_TEST_EMAIL"],
                         "password": secrets["SUPABASE_TEST_PASSWORD"]}).encode(),
        headers={"Content-Type": "application/json",
                 "apikey": secrets["SUPABASE_ANON_KEY"]},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    return data["access_token"], data["user"]["id"]


def cdn_presign_upload(user_jwt: str, key: str) -> str:
    """cdn-access op:"upload" → presigned B2 PUT URL (the §2b step-1 call)."""
    req = urllib.request.Request(
        f"{FUNCTIONS_BASE}/cdn-access", method="POST",
        data=json.dumps({"op": "upload", "key": key}).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {user_jwt}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)["url"]


def put_file(url: str, path: str) -> None:
    """PUT a (possibly large) file with curl so we get streaming + a progress
    bar — the browser equivalent is the direct-to-B2 XHR PUT."""
    r = subprocess.run(["curl", "-#", "-fSL", "-X", "PUT",
                        "--upload-file", path, url])
    if r.returncode != 0:
        raise RuntimeError(f"upload PUT failed (curl exit {r.returncode})")


def put_json(url: str, obj: dict) -> int:
    body = json.dumps(obj, indent=2).encode()
    req = urllib.request.Request(url, method="PUT", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()
    return len(body)


def build_annotation_json(config: dict, labels: list[dict],
                          labeled_by: str) -> dict:
    """Single B2 file shape from SUPABASE.md (court + labels)."""
    court: dict = {"corners": config["corners"]}
    if config.get("scoreboard_crop") is not None:
        court["scoreboard_crop"] = config["scoreboard_crop"]
        court["score_sub_crop"] = config["score_sub_crop"]
        court["row_split_y"] = config["row_split_y"]
    return {
        "court": court,
        "labels": [
            {
                "frame_idx": l["frame_idx"],
                "anchor": l["anchor"],
                "display_name": l["display_name"],
                "labeled_by": labeled_by,
            }
            for l in labels
        ],
        "frame_width": config.get("frame_width"),
        "frame_height": config.get("frame_height"),
        "annotated_at_sec": config.get("annotated_at_sec"),
    }


# ---------------------------------------------------------------- UI helpers


def fit_scale(w: int, h: int) -> float:
    return min(1.0, MAX_DISPLAY_W / w, MAX_DISPLAY_H / h)


def put_help(img: np.ndarray, lines: list[str]) -> None:
    for i, line in enumerate(lines):
        y = 28 + 26 * i
        cv2.putText(img, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 0), 4)
        cv2.putText(img, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (80, 255, 80), 1)


def pick_frame(source, start_t: float) -> tuple[np.ndarray, float] | None:
    """Step 1: scrub to a rally frame. Returns (frame, t) or None on abort."""
    t = start_t
    frame = source.frame_at(t)
    while True:
        if frame is None:
            frame = np.zeros((source.height, source.width, 3), np.uint8)
        s = fit_scale(source.width, source.height)
        disp = cv2.resize(frame, None, fx=s, fy=s)
        put_help(disp, [
            f"PICK FRAME   t={t:7.1f}s / {source.duration:.0f}s",
            "a/d +-2s   s/w +-30s   z/x +-10min   Enter=use frame   Esc=abort",
            "pick a RALLY frame: court fully visible AND scoreboard overlay up",
        ])
        cv2.imshow(WINDOW, disp)
        key = cv2.waitKey(0) & 0xFF
        step = {ord("a"): -2, ord("d"): 2, ord("s"): -30, ord("w"): 30,
                ord("z"): -600, ord("x"): 600}.get(key)
        if step is not None:
            t = min(max(0.0, t + step), max(0.0, source.duration - 1))
            frame = source.frame_at(t)
        elif key in (13, 32) and frame.any():  # Enter/Space
            return frame, t
        elif key == 27:  # Esc
            return None


def click_points(frame: np.ndarray, n: int, title: str, hint: str,
                 closed: bool) -> list[list[int]] | None:
    """Click n points on the (display-scaled) frame; returns native-pixel points."""
    s = fit_scale(frame.shape[1], frame.shape[0])
    pts: list[list[int]] = []
    pending: list[int] | None = None

    def on_mouse(event, x, y, _flags, _param):
        nonlocal pending
        # On macOS, committing on button release lets the HighGUI event pump
        # finish focusing the window before the point reaches the UI loop.
        if event == cv2.EVENT_LBUTTONUP and len(pts) < n:
            pending = [int(round(x / s)), int(round(y / s))]

    try:
        while True:
            disp = cv2.resize(frame, None, fx=s, fy=s)
            for i, p in enumerate(pts):
                q = (int(p[0] * s), int(p[1] * s))
                cv2.circle(disp, q, 5, (0, 0, 255), -1)
                cv2.putText(disp, str(i + 1), (q[0] + 8, q[1] - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            if len(pts) >= 2:
                poly = np.array([[int(p[0] * s), int(p[1] * s)] for p in pts])
                cv2.polylines(disp, [poly], closed and len(pts) == n, (0, 0, 255), 2)
            put_help(disp, [title, hint, f"{len(pts)}/{n} points   u=undo   "
                            "Enter=accept (when all placed)   Esc=back"])
            cv2.imshow(WINDOW, disp)
            cv2.setMouseCallback(WINDOW, on_mouse)
            key = cv2.waitKey(30) & 0xFF
            if pending is not None and len(pts) < n:
                pts.append(pending)
                print(f"[info] {title.lower()} point {len(pts)}/{n}: {pending}")
                pending = None
            elif key == ord("u") and pts:
                pts.pop()
            elif key in (13, 32) and len(pts) == n:
                return pts
            elif key == 27:
                return None
    finally:
        cv2.setMouseCallback(WINDOW, lambda *a: None)


def label_players(frame: np.ndarray, t: float, fps: float,
                  sam: SlimSam) -> list[dict] | None:
    """Players step, exactly the website's labeling UI (§2c): a click prompts
    SlimSAM, the returned mask is shown for confirmation, and the name typed
    in the terminal attaches to the instance. Returns label evidence
    [{display_name, frame_idx, anchor:{x,y,bbox}}, …] or None on Esc."""
    sam.set_image(frame)
    s = fit_scale(frame.shape[1], frame.shape[0])
    labels: list[dict] = []   # + private _mask for the overlay
    state = {"click": None}
    colors = [(0, 0, 255), (255, 120, 0), (0, 200, 0), (200, 0, 200)]

    def on_mouse(event, x, y, _flags, _param):
        if event == cv2.EVENT_LBUTTONDOWN:
            state["click"] = (int(round(x / s)), int(round(y / s)))

    def draw_labels(candidate: dict | None = None) -> np.ndarray:
        disp = cv2.resize(frame, None, fx=s, fy=s)
        visible = labels + ([candidate] if candidate else [])
        for i, l in enumerate(visible):
            color = colors[i % len(colors)]
            small = cv2.resize(l["_mask"].astype(np.uint8), None, fx=s, fy=s,
                               interpolation=cv2.INTER_NEAREST).astype(bool)
            disp[small] = disp[small] // 2 + np.array(color, np.uint8) // 2
            bx, by, bw, bh = [int(v * s) for v in l["anchor"]["bbox"]]
            cv2.rectangle(disp, (bx, by), (bx + bw, by + bh), color, 2)
            if l.get("display_name"):
                cv2.putText(disp, l["display_name"], (bx, max(20, by - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        return disp

    cv2.setMouseCallback(WINDOW, on_mouse)
    try:
        while True:
            disp = draw_labels()
            put_help(disp, [
                "PLAYERS (SlimSAM click-to-label, as in the browser)",
                "click a player -> mask appears -> TYPE THEIR NAME IN THE "
                "TERMINAL (BWF: as the scoreboard shows it)",
                f"{len(labels)} labeled   u=undo   Enter=done (need >=1, "
                "usually 2)   Esc=back",
            ])
            cv2.imshow(WINDOW, disp)
            key = cv2.waitKey(30) & 0xFF

            if state["click"]:
                x, y = state["click"]
                state["click"] = None
                try:
                    mask, bbox, score = sam.click(x, y)
                except RuntimeError as e:
                    print(f"[info] {e}; try clicking closer to the player's torso")
                    continue
                candidate = {
                    "display_name": "",
                    "anchor": {"x": x, "y": y, "bbox": bbox},
                    "_mask": mask,
                }
                preview = draw_labels(candidate)
                put_help(preview, [
                    "MASK PREVIEW",
                    "Review the highlighted mask, then name it in the terminal "
                    "(blank rejects it)",
                ])
                cv2.imshow(WINDOW, preview)
                cv2.waitKey(1)  # Flush the preview before terminal input blocks the UI.
                print(f"[info] mask iou={score:.2f} bbox={bbox}")
                name = input("    player name (blank to reject the mask): ").strip()
                if name:
                    candidate["display_name"] = name
                    candidate["frame_idx"] = int(round(t * fps))
                    labels.append(candidate)
            elif key == ord("u") and labels:
                labels.pop()
            elif key in (13, 32) and labels:
                return [{k: v for k, v in l.items() if k != "_mask"} for l in labels]
            elif key == 27:
                return None
    finally:
        cv2.setMouseCallback(WINDOW, lambda *a: None)


def annotate(source, sam: SlimSam, with_geometry: bool,
             with_scoreboard: bool) -> dict | None:
    """Run the UI; returns the annotation config or None on abort.
    with_geometry=False (reusing a preset) skips straight to player labeling.
    with_scoreboard=True attaches the BWF OCR geometry, which is NOT annotated
    by hand: the scoreboard is assumed to live in the TOP-LEFT QUADRANT of the
    frame, so scoreboard_crop = score_sub_crop = that quadrant. With a crop
    this coarse the digit-rows fallback (row_split_y) is a guess — validity is
    effectively carried by the player-NAME matches, so type names exactly as
    the scoreboard shows them."""
    cv2.namedWindow(WINDOW)
    t = min(300.0, source.duration / 3)  # skip pre-match ceremony by default
    try:
        while True:  # frame-pick loop (Esc in a later step returns here)
            picked = pick_frame(source, t)
            if picked is None:
                return None
            frame, t = picked
            corners = None

            if with_geometry:
                corners = click_points(
                    frame, 4, "COURT CORNERS",
                    "click the 4 court corners IN ORDER: top-left, top-right, "
                    "bottom-right, bottom-left", closed=True)
                if corners is None:
                    continue

            fps = 30.0
            if isinstance(source, FrameSource):
                fps = source.cap.get(cv2.CAP_PROP_FPS) or 30.0
            labels = label_players(frame, t, fps, sam)
            if labels is None:
                continue

            qw, qh = source.width // 2, source.height // 2
            quad = {"x": 0, "y": 0, "w": qw, "h": qh}
            return {
                "corners": corners,
                "scoreboard_crop": dict(quad) if with_scoreboard else None,
                "score_sub_crop": dict(quad) if with_scoreboard else None,
                "row_split_y": qh // 2 if with_scoreboard else None,
                "player_labels": labels,
                "frame_width": source.width,
                "frame_height": source.height,
                "annotated_at_sec": round(t, 1),
            }
    finally:
        cv2.destroyAllWindows()
        cv2.waitKey(1)  # let macOS actually close the window


# ---------------------------------------------------------------- create


def post_json(path: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(
        f"{FUNCTIONS_BASE}{path}", method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {path} -> HTTP {e.code}: {e.read().decode()[:300]}") from e


# ---------------------------------------------------------------- main


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", help="YouTube URL — BWF lane, the worker downloads it")
    p.add_argument("--file", help="local video: alone = upload lane (§2b); with --url = scrub proxy")
    p.add_argument("--tournament", help="tournament label stored on matches (BWF lane)")
    p.add_argument("--queue", default="jobs_bulk", choices=["jobs_bulk", "jobs_interactive"])
    p.add_argument("--dispatch", action="store_true", help="also POST /jobs/dispatch at the end")
    p.add_argument("--dry-run", action="store_true", help="annotate + print; write nothing anywhere")
    args = p.parse_args()

    if not args.url and not args.file:
        p.error("need --url (BWF lane) and/or --file (upload lane)")
    lane = "bwf" if args.url else "upload"
    creating = not args.dry_run
    if lane == "upload" and args.tournament:
        p.error("--tournament is BWF-only")
    if creating and lane == "bwf" and not args.tournament:
        p.error("BWF lane needs --tournament (or --dry-run)")
    if lane == "upload" and args.file:
        ext = (os.path.splitext(args.file)[1].lstrip(".").lower() or "mp4")
        if ext != "mp4":
            p.error("user uploads must be .mp4 (cdn-access allowlist: original.mp4)")

    secrets = load_secrets()
    if creating:
        if (lane == "bwf" or args.dispatch) and "PIPELINE_SERVICE_TOKEN" not in secrets:
            sys.exit(f"missing PIPELINE_SERVICE_TOKEN in {SECRETS_FILE}")

    sam = SlimSam()   # load before the UI so the first click isn't a stall
    source, yt = open_source(args)
    print(f"[info] annotating at {source.width}x{source.height}, "
          f"duration {source.duration:.0f}s"
          + (f" (youtube id {yt['video_id']})" if yt else ""))
    config = annotate(source, sam,
                      with_geometry=True,
                      with_scoreboard=lane == "bwf")
    if config is None:
        sys.exit("aborted in UI, nothing created")

    labels = config.pop("player_labels")
    players = [l["display_name"] for l in labels]

    print("\ngeometry:")
    print(json.dumps({k: v for k, v in config.items()
                      if v is not None or lane == "bwf"}, indent=2))
    annotation = build_annotation_json(config, labels, "annotate_and_ingest.py")
    print("\nannotation.json (SUPABASE.md shape):")
    print(json.dumps(annotation, indent=2))
    if lane == "bwf":
        print(f"\nplayer_names for ingest: {players}")

    if not creating:
        print("\n[dry-run] nothing uploaded, no rows inserted, no job created")
        return

    if lane == "bwf":
        # System lane: content id = YouTube video id when known (stable, short);
        # otherwise hash the URL. Client cannot write bwf/… — print annotation
        # for a follow-up service upload under bwf/<id>/annotation.json.
        match_id = (yt or {}).get("video_id") or uuid.uuid4().hex
        service_hdr = {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]}
        # Map labels into roster columns (first four names, order of labeling).
        slots = players + [None, None, None, None]
        ingest = post_json("/matches-ingest", service_hdr, {
            "id": match_id,
            "source_url": args.url,
            "tournament": args.tournament,
            "team1_player1": slots[0],
            "team1_player2": slots[1],
            "team2_player1": slots[2],
            "team2_player2": slots[3],
            "queue": args.queue,
            "upsert": True,
        })
        print("[info] BWF annotation.json not uploaded (bwf/ is service-only); "
              "materialize under bwf/<match_id>/ when the service path lands")
    else:
        # §2b: sign in → presign → PUT original.mp4 → matches-ingest confirm →
        # PUT annotation.json under users/<uid>/<match_id>/.
        jwt, uid = sign_in_test_user(secrets)
        print(f"\n[info] signed in as dev test user {uid}")
        match_id = str(uuid.uuid4())
        prefix = f"users/{uid}/{match_id}/"
        print(f"[info] uploading {args.file} -> {prefix}original.mp4")
        put_file(cdn_presign_upload(jwt, f"{prefix}original.mp4"), args.file)

        ingest = post_json("/matches-ingest", {"Authorization": f"Bearer {jwt}"}, {
            "id": match_id,
            "ext": "mp4",
            "upload": True,
        })

        annotation = build_annotation_json(config, labels, uid)
        put_json(cdn_presign_upload(jwt, f"{prefix}annotation.json"), annotation)
        print(f"[info] annotation.json uploaded -> {prefix}annotation.json")

    print(f"job queued: {json.dumps(ingest)}")

    if args.dispatch:
        result = post_json("/jobs/dispatch",
                           {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]}, {})
        print(f"dispatched: {json.dumps(result)}")
    else:
        print("\nto run it:  curl -X POST "
              f"{FUNCTIONS_BASE}/jobs/dispatch -H 'x-pipeline-token: …' -d '{{}}'")


if __name__ == "__main__":
    main()
