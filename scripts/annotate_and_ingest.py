#!/usr/bin/env python3
"""Annotate a video, enqueue pipeline work, and (by default) run as a DEV test suite.

Simulates the website flow (ARCHITECTURE.md §2b/§2c), then **monitors Supabase + B2**
until normalize → detect complete (or until failure / timeout).

Two source modes
────────────────
  BWF (system catalog) — match row already exists (match-data scraper). This
  script does **not** create or rewrite catalog metadata. It only:

    1. uploads ``annotation.json`` under ``bwf/<match_id>/`` (service presign)
    2. enqueues a normalize job via matches-ingest (id + queue only, upsert=false)

  Resolve the catalog row with ``--match-id`` (preferred) or ``--url`` (lookup
  by ``source_url`` / YouTube id). Optional ``--file`` is a local scrub proxy
  for the OpenCV UI (must match pipeline resolution).

    python3 scripts/annotate_and_ingest.py --match-id <catalog_sha> --dispatch
    python3 scripts/annotate_and_ingest.py --url "https://www.youtube.com/watch?v=…" \\
        --annotation ann.json --dispatch
    # scrub local copy: add --file worlds_final.mkv

  Local file (user upload) — browser lane §2b: test user JWT → cdn-access
  upload original.mp4 + annotation.json under ``users/<uid>/<match_id>/``,
  then matches-ingest creates the user match + job.

    python3 scripts/annotate_and_ingest.py --file my_match.mp4

Test-suite / monitor flags
──────────────────────────
  (default) after enqueue: poll match + job + B2 until --until stage is done
  --no-monitor          annotate + enqueue only (no polling)
  --dispatch            POST /jobs/dispatch once after enqueue (cron also runs ~1m)
  --until normalize|detect   success bar (default: detect → match ready)
  --timeout-sec N       overall monitor budget (default 7200)
  --poll-sec N          poll interval (default 15)
  --annotation FILE     skip OpenCV UI; load annotation.json from disk
  --monitor-only --match-id ID   only watch an existing match (no annotate/enqueue)
  --dry-run             annotate + print; write nothing

UI flow (OpenCV; skipped with --annotation or --monitor-only)
  pick frame → court corners TL→TR→BR→BL → SlimSAM player clicks + names

Secrets (~/.mintonix/dev-secrets.env)
  PIPELINE_SERVICE_TOKEN, SUPABASE_SERVICE_ROLE_KEY, PRESIGN_SERVICE_TOKEN
  SUPABASE_ANON_KEY + SUPABASE_TEST_EMAIL/PASSWORD (upload lane)
  Optional: SUPABASE_URL, CDN_PRESIGN_URL
  SlimSAM: pip install torch transformers torchvision Pillow
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import ssl_certs  # noqa: E402, F401  — fix empty macOS python.org CA store before HTTPS
from ops_stage import (  # noqa: E402
    STAGE_ORDER,
    STAGE_PRIMARY,
    basenames_from_keys,
    stage_completeness,
)

# ── defaults (DEV project) ────────────────────────────────────────────────────

SECRETS_FILE = os.path.expanduser("~/.mintonix/dev-secrets.env")
DEFAULT_SUPABASE_URL = "https://xaxyuytvgcdbdnndhgwj.supabase.co"
DEFAULT_CDN_PRESIGN = "https://mintonix-cdn-dev.peterouyang14.workers.dev/presign"
HTTP_USER_AGENT = "Mintonix-annotate-test/1.0 (+scripts/annotate_and_ingest.py)"

# Same format preference as the worker's download_youtube() — annotation
# coordinates are only valid at the resolution the pipeline will process.
YTDLP_FORMAT = "bv*/b"
MAX_DISPLAY_W, MAX_DISPLAY_H = 1400, 850
WINDOW = "annotate"

# Secondary B2 artifacts (nice-to-have; not hard fail if missing).
STAGE_SECONDARY: dict[str, tuple[str, ...]] = {
    "normalize": ("thumbnail.jpg",),
    "detect": (),
    "analyze": (),
}
# BWF-only extras after normalize.
BWF_NORMALIZE_EXTRA = ("frame_ranges.csv",)


# ── secrets / HTTP ────────────────────────────────────────────────────────────


def load_secrets(path: str = SECRETS_FILE) -> dict[str, str]:
    secrets: dict[str, str] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    secrets[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    # Process env fills gaps; DEV_ prefix overrides for this script's DEV focus.
    for k, v in os.environ.items():
        if not v:
            continue
        if k.startswith("DEV_"):
            secrets[k[4:]] = v
        elif k.startswith("PROD_"):
            continue
        elif k not in secrets:
            secrets[k] = v
    return secrets


def supabase_url(secrets: dict[str, str]) -> str:
    return (secrets.get("SUPABASE_URL") or DEFAULT_SUPABASE_URL).rstrip("/")


def functions_base(secrets: dict[str, str]) -> str:
    return f"{supabase_url(secrets)}/functions/v1"


def cdn_presign_url(secrets: dict[str, str]) -> str:
    return (secrets.get("CDN_PRESIGN_URL") or DEFAULT_CDN_PRESIGN).rstrip("/")


def service_key(secrets: dict[str, str]) -> str:
    return (
        secrets.get("SUPABASE_SERVICE_ROLE_KEY")
        or secrets.get("SUPABASE_SERVICE_KEY")
        or ""
    )


def require_secrets(secrets: dict[str, str], *keys: str) -> None:
    miss: list[str] = []
    for k in keys:
        if k in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"):
            if not service_key(secrets):
                miss.append("SUPABASE_SERVICE_ROLE_KEY")
        elif not secrets.get(k):
            miss.append(k)
    # de-dupe while preserving order
    ordered: list[str] = []
    seen: set[str] = set()
    for k in miss:
        if k not in seen:
            seen.add(k)
            ordered.append(k)
    if ordered:
        sys.exit(f"missing secret(s) in {SECRETS_FILE}: {', '.join(ordered)}")


def http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict | None = None,
    *,
    timeout: float = 60,
) -> Any:
    data = None if body is None else json.dumps(body).encode()
    hdrs = {"User-Agent": HTTP_USER_AGENT, **headers}
    req = urllib.request.Request(url, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code} on {method} {url}: {detail}") from e
    except urllib.error.URLError as e:
        reason = e.reason
        hint = ""
        if "CERTIFICATE_VERIFY_FAILED" in str(reason):
            hint = (
                " (macOS python.org CA store empty — install certifi in this "
                "interpreter, or run Applications/Python*/Install Certificates.command)"
            )
        raise RuntimeError(f"Network error on {method} {url}: {reason}{hint}") from e


def rest_headers(secrets: dict[str, str]) -> dict[str, str]:
    key = service_key(secrets)
    if not key:
        raise RuntimeError(
            "Need SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) for monitoring"
        )
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def post_fn(secrets: dict[str, str], path: str, headers: dict[str, str], body: dict) -> dict:
    out = http_json(
        "POST",
        f"{functions_base(secrets)}{path}",
        {"Content-Type": "application/json", **headers},
        body,
    )
    return out if isinstance(out, dict) else {}


# ── Supabase REST (monitor) ───────────────────────────────────────────────────


MATCH_SELECT = (
    "id,owner_id,source_url,tournament,status,duration_sec,"
    "width,height,fps,team1_player1,team1_player2,team2_player1,team2_player2,"
    "created_at"
)

# YouTube ids are 11 chars; accept common watch / youtu.be / shorts / embed forms.
_YT_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^#]*&)?v=|embed/|shorts/|live/))"
    r"([A-Za-z0-9_-]{11})"
)
_YT_ID_BARE_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_video_id(url_or_id: str | None) -> str | None:
    if not url_or_id:
        return None
    s = url_or_id.strip()
    if _YT_ID_BARE_RE.match(s):
        return s
    m = _YT_ID_RE.search(s)
    return m.group(1) if m else None


def fetch_match(secrets: dict[str, str], match_id: str) -> dict | None:
    url = (
        f"{supabase_url(secrets)}/rest/v1/matches"
        f"?id=eq.{urllib.parse.quote(match_id, safe='')}"
        f"&select={MATCH_SELECT}"
    )
    rows = http_json("GET", url, rest_headers(secrets)) or []
    return rows[0] if rows else None


def fetch_matches_by_youtube_id(secrets: dict[str, str], video_id: str) -> list[dict]:
    """Find system catalog rows whose source_url contains this YouTube id."""
    # PostgREST: source_url ilike %video_id% — catalog stores watch?v= form.
    url = (
        f"{supabase_url(secrets)}/rest/v1/matches"
        f"?source_url=ilike.*{urllib.parse.quote(video_id, safe='')}*"
        f"&owner_id=is.null"
        f"&select={MATCH_SELECT}"
        f"&order=created_at.desc&limit=20"
    )
    rows = http_json("GET", url, rest_headers(secrets)) or []
    return [r for r in rows if isinstance(r, dict)]


def resolve_bwf_catalog_match(
    secrets: dict[str, str],
    *,
    match_id: str | None,
    url: str | None,
) -> dict:
    """BWF rows already exist (scraper). Resolve one; never invent a new id."""
    if match_id:
        m = fetch_match(secrets, match_id)
        if not m:
            sys.exit(
                f"no matches row for id={match_id} — BWF catalog must already "
                "contain the match (match-data scrape). Do not create rows here."
            )
        if m.get("owner_id") is not None:
            sys.exit(
                f"match {match_id} is user-owned (owner_id set); "
                "BWF lane requires a system catalog row (owner_id null)"
            )
        return m

    if not url:
        sys.exit(
            "BWF lane needs --match-id (catalog id) or --url (lookup by source_url)"
        )

    vid = youtube_video_id(url)
    if not vid:
        # Exact source_url match fallback for non-YouTube URLs.
        q = (
            f"{supabase_url(secrets)}/rest/v1/matches"
            f"?source_url=eq.{urllib.parse.quote(url, safe='')}"
            f"&owner_id=is.null"
            f"&select={MATCH_SELECT}"
            f"&limit=5"
        )
        rows = http_json("GET", q, rest_headers(secrets)) or []
        if not rows:
            sys.exit(
                f"no BWF catalog match with source_url={url!r}. "
                "Scrape/load match-data first, or pass --match-id."
            )
        if len(rows) > 1:
            ids = ", ".join(r.get("id", "?")[:12] + "…" for r in rows)
            sys.exit(
                f"multiple BWF matches share source_url={url!r}: {ids}. "
                "Pass --match-id to disambiguate."
            )
        return rows[0]

    rows = fetch_matches_by_youtube_id(secrets, vid)
    # Prefer exact watch URL if present among hits.
    canon = f"https://www.youtube.com/watch?v={vid}"
    exact = [r for r in rows if (r.get("source_url") or "") == canon]
    pool = exact or rows
    if not pool:
        sys.exit(
            f"no BWF catalog match with YouTube id {vid} in source_url. "
            "Catalog scrape sets source_url separately from pipeline enqueue; "
            "load match-data (with video links) first, or pass --match-id."
        )
    if len(pool) > 1:
        print(
            f"[warn] {len(pool)} catalog rows share YouTube id {vid}; "
            f"using newest id={pool[0].get('id')} "
            f"({pool[0].get('tournament') or 'no tournament'}). "
            "Pass --match-id to pin one."
        )
    return pool[0]


def fetch_latest_job(secrets: dict[str, str], match_id: str) -> dict | None:
    url = (
        f"{supabase_url(secrets)}/rest/v1/jobs"
        f"?match_id=eq.{urllib.parse.quote(match_id, safe='')}"
        f"&select=id,match_id,status,stage,queue,attempt,error,msg_id,"
        f"created_at,updated_at,started_at,finished_at"
        f"&order=created_at.desc&limit=1"
    )
    rows = http_json("GET", url, rest_headers(secrets)) or []
    return rows[0] if rows else None


# ── B2 via CDN /presign (service token) ───────────────────────────────────────


def cdn_control(secrets: dict[str, str], body: dict, *, timeout: float = 60) -> dict:
    require_secrets(secrets, "PRESIGN_SERVICE_TOKEN")
    out = http_json(
        "POST",
        cdn_presign_url(secrets),
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secrets['PRESIGN_SERVICE_TOKEN']}",
        },
        body,
        timeout=timeout,
    )
    return out if isinstance(out, dict) else {}


def list_prefix_keys(secrets: dict[str, str], prefix: str) -> list[str]:
    keys: list[str] = []
    token: str | None = None
    while True:
        body: dict[str, Any] = {"op": "LIST", "prefix": prefix, "maxKeys": 1000}
        if token:
            body["continuationToken"] = token
        result = cdn_control(secrets, body)
        keys.extend(result.get("keys") or [])
        if not result.get("isTruncated"):
            break
        token = result.get("nextContinuationToken")
        if not token:
            break
    return keys


def put_bytes_presigned(url: str, data: bytes, content_type: str = "application/json") -> None:
    req = urllib.request.Request(
        url,
        method="PUT",
        data=data,
        headers={
            "User-Agent": HTTP_USER_AGENT,
            "Content-Type": content_type,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()


def upload_b2_json(secrets: dict[str, str], key: str, obj: dict) -> None:
    """Service-token PUT of JSON under any prefix (including bwf/)."""
    signed = cdn_control(secrets, {"op": "PUT", "key": key})
    url = signed.get("url")
    if not url:
        raise RuntimeError(f"CDN PUT presign returned no url for {key}: {signed}")
    put_bytes_presigned(url, json.dumps(obj, indent=2).encode(), "application/json")


def match_b2_prefix(owner_id: str | None, match_id: str) -> str:
    if owner_id:
        return f"users/{owner_id}/{match_id}/"
    return f"bwf/{match_id}/"


# ── video sources ─────────────────────────────────────────────────────────────


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
    """Fallback for streams OpenCV can't seek: one ffmpeg snapshot per timestamp."""

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


def open_source(args: argparse.Namespace) -> tuple[object, dict | None]:
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


# ── SlimSAM ───────────────────────────────────────────────────────────────────


class SlimSam:
    """Point-prompted segmentation (browser design §2c)."""

    MODEL_ID = "Zigeng/SlimSAM-uniform-77"

    def __init__(self):
        try:
            import torch
            from transformers import SamModel, SamProcessor
        except ImportError:
            sys.exit(
                "SlimSAM needs torch + transformers:  "
                "pip install torch transformers torchvision Pillow"
            )
        # SamProcessor image backends (fail late with a clear message if missing).
        try:
            import PIL  # noqa: F401
        except ImportError:
            sys.exit("SlimSAM needs Pillow:  pip install Pillow")
        try:
            import torchvision  # noqa: F401
        except ImportError:
            # Older transformers may work with Pillow only; newer ones need torchvision.
            pass
        self.torch = torch
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"[info] loading SlimSAM ({self.MODEL_ID}) on {self.device}…")
        try:
            self.model = SamModel.from_pretrained(self.MODEL_ID).to(self.device).eval()
            self.processor = SamProcessor.from_pretrained(self.MODEL_ID)
        except ValueError as e:
            msg = str(e)
            if "Pillow" in msg or "torchvision" in msg or "image processor" in msg.lower():
                sys.exit(
                    f"{e}\n"
                    "Install SlimSAM image backends:  "
                    "pip install torchvision Pillow"
                )
            raise
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
        assert self._embeddings is not None, "set_image first"
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
            inputs["reshaped_input_sizes"])[0][0]
        scores = out.iou_scores[0][0].cpu()
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


# ── upload lane (user) ────────────────────────────────────────────────────────


def sign_in_test_user(secrets: dict[str, str]) -> tuple[str, str]:
    need = ["SUPABASE_ANON_KEY", "SUPABASE_TEST_EMAIL", "SUPABASE_TEST_PASSWORD"]
    if any(k not in secrets for k in need):
        sys.exit(f"upload lane needs {'/'.join(need)} in {SECRETS_FILE}")
    data = http_json(
        "POST",
        f"{supabase_url(secrets)}/auth/v1/token?grant_type=password",
        {
            "Content-Type": "application/json",
            "apikey": secrets["SUPABASE_ANON_KEY"],
        },
        {
            "email": secrets["SUPABASE_TEST_EMAIL"],
            "password": secrets["SUPABASE_TEST_PASSWORD"],
        },
    )
    return data["access_token"], data["user"]["id"]


def cdn_presign_upload(secrets: dict[str, str], user_jwt: str, key: str) -> str:
    """cdn-access op:upload → presigned B2 PUT (user namespace only)."""
    out = post_fn(
        secrets,
        "/cdn-access",
        {"Authorization": f"Bearer {user_jwt}"},
        {"op": "upload", "key": key},
    )
    url = out.get("url")
    if not url:
        raise RuntimeError(f"cdn-access upload failed: {out}")
    return url


def put_file(url: str, path: str) -> None:
    r = subprocess.run(
        ["curl", "-#", "-fSL", "-X", "PUT", "--upload-file", path, url],
    )
    if r.returncode != 0:
        raise RuntimeError(f"upload PUT failed (curl exit {r.returncode})")


def build_annotation_json(config: dict, labels: list[dict], labeled_by: str) -> dict:
    """Single B2 file shape from supabase/README.md (court + labels)."""
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


def load_annotation_file(path: str) -> dict:
    with open(path) as f:
        obj = json.load(f)
    if not isinstance(obj, dict) or "court" not in obj:
        sys.exit(f"--annotation must be annotation.json with a court object: {path}")
    corners = (obj.get("court") or {}).get("corners")
    if not (isinstance(corners, list) and len(corners) == 4):
        sys.exit(f"--annotation court.corners must be 4 points: {path}")
    return obj


# ── OpenCV UI ─────────────────────────────────────────────────────────────────


def fit_scale(w: int, h: int) -> float:
    return min(1.0, MAX_DISPLAY_W / w, MAX_DISPLAY_H / h)


def put_help(img: np.ndarray, lines: list[str]) -> None:
    for i, line in enumerate(lines):
        y = 28 + 26 * i
        cv2.putText(img, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 0), 4)
        cv2.putText(img, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (80, 255, 80), 1)


def pick_frame(source, start_t: float) -> tuple[np.ndarray, float] | None:
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
        elif key in (13, 32) and frame.any():
            return frame, t
        elif key == 27:
            return None


def click_points(frame: np.ndarray, n: int, title: str, hint: str,
                 closed: bool) -> list[list[int]] | None:
    s = fit_scale(frame.shape[1], frame.shape[0])
    pts: list[list[int]] = []
    pending: list[int] | None = None

    def on_mouse(event, x, y, _flags, _param):
        nonlocal pending
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
    sam.set_image(frame)
    s = fit_scale(frame.shape[1], frame.shape[0])
    labels: list[dict] = []
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
                cv2.waitKey(1)
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
    cv2.namedWindow(WINDOW)
    t = min(300.0, source.duration / 3)
    try:
        while True:
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
        cv2.waitKey(1)


# ── monitor / test suite ──────────────────────────────────────────────────────


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Snapshot:
    match: dict | None
    job: dict | None
    basenames: set[str]
    prefix: str
    completeness: dict[str, str]
    t_elapsed: float


@dataclass
class MonitorReport:
    match_id: str
    lane: str
    until: str
    ok: bool
    reason: str
    elapsed_sec: float
    checks: list[CheckResult] = field(default_factory=list)
    final: Snapshot | None = None


def _fmt_job(job: dict | None) -> str:
    if not job:
        return "job=(none)"
    err = job.get("error")
    err_s = f" err={str(err)[:80]}" if err else ""
    return (
        f"job={str(job.get('id') or '')[:8]}… "
        f"status={job.get('status')} stage={job.get('stage')} "
        f"attempt={job.get('attempt')} q={job.get('queue')}{err_s}"
    )


def _fmt_match(m: dict | None) -> str:
    if not m:
        return "match=(missing)"
    probe = ""
    if m.get("duration_sec") is not None:
        probe = (
            f" probe={m.get('width')}x{m.get('height')}@"
            f"{m.get('fps')}fps {m.get('duration_sec')}s"
        )
    return f"match.status={m.get('status')}{probe}"


def take_snapshot(
    secrets: dict[str, str],
    match_id: str,
    owner_id: str | None,
    t0: float,
) -> Snapshot:
    m = fetch_match(secrets, match_id)
    if m is not None and m.get("owner_id") is not None:
        owner_id = m.get("owner_id")
    prefix = match_b2_prefix(owner_id, match_id)
    keys = list_prefix_keys(secrets, prefix)
    bases = basenames_from_keys(keys, prefix)
    return Snapshot(
        match=m,
        job=fetch_latest_job(secrets, match_id),
        basenames=bases,
        prefix=prefix,
        completeness=stage_completeness(bases),
        t_elapsed=time.monotonic() - t0,
    )


def evaluate_success(snap: Snapshot, *, until: str, lane: str) -> list[CheckResult]:
    """Hard checks for pipeline success at --until stage.

    Soft/optional notes use ok=True with detail text so they never block PASS
    but still show up in the report.
    """
    checks: list[CheckResult] = []
    m, job, bases = snap.match, snap.job, snap.basenames
    need_detect = until == "detect"

    checks.append(CheckResult(
        "match_row",
        m is not None,
        f"id={m.get('id')}" if m else "not found",
    ))
    checks.append(CheckResult(
        "annotation.json",
        "annotation.json" in bases,
        "present" if "annotation.json" in bases else f"missing under {snap.prefix}",
    ))

    # ── normalize ─────────────────────────────────────────────────────────────
    n_primary = STAGE_PRIMARY["normalize"]
    checks.append(CheckResult(
        f"b2.{n_primary}",
        n_primary in bases,
        "present" if n_primary in bases else "missing",
    ))
    for sec in STAGE_SECONDARY["normalize"]:
        checks.append(CheckResult(
            f"b2.{sec}",
            True,
            "present" if sec in bases else "missing (optional)",
        ))
    if lane == "bwf":
        for extra in BWF_NORMALIZE_EXTRA:
            checks.append(CheckResult(
                f"b2.{extra}",
                True,
                "present" if extra in bases else "missing (BWF expected, non-fatal)",
            ))

    if m and n_primary in bases:
        probes_ok = all(
            m.get(k) is not None for k in ("duration_sec", "width", "height", "fps")
        )
        checks.append(CheckResult(
            "match.probe_fields",
            probes_ok,
            (
                f"{m.get('width')}x{m.get('height')} @ {m.get('fps')} "
                f"{m.get('duration_sec')}s"
                if probes_ok
                else "normalized.mp4 present but duration/width/height/fps incomplete"
            ),
        ))

    if until == "normalize":
        # Normalize settle: artifact present AND job left normalize stage
        # (callback advances to detect) OR match is processing/ready.
        advanced = bool(
            job
            and (
                job.get("stage") in ("detect", "analyze")
                or (
                    job.get("status") == "complete"
                    and job.get("stage") != "normalize"
                )
            )
        )
        status_ok = bool(m and m.get("status") in ("processing", "ready"))
        checks.append(CheckResult(
            "normalize.settled",
            n_primary in bases and (advanced or status_ok),
            f"{_fmt_job(job)}; {_fmt_match(m)}",
        ))
        return checks

    # ── detect (terminal for MVP) ─────────────────────────────────────────────
    if need_detect:
        d_primary = STAGE_PRIMARY["detect"]
        checks.append(CheckResult(
            f"b2.{d_primary}",
            d_primary in bases,
            "present" if d_primary in bases else "missing",
        ))
        checks.append(CheckResult(
            "match.status_ready",
            bool(m and m.get("status") == "ready"),
            f"status={m.get('status') if m else None}",
        ))
        job_ok = bool(
            job
            and job.get("status") == "complete"
            and job.get("stage") == "detect"
        )
        checks.append(CheckResult(
            "job.terminal_complete",
            job_ok,
            _fmt_job(job) if job else "no job row",
        ))

    return checks


def is_hard_success(checks: list[CheckResult]) -> bool:
    return all(c.ok for c in checks)


def detect_terminal_failure(snap: Snapshot) -> str | None:
    """Return a failure reason if the run is dead, else None."""
    m, job = snap.match, snap.job
    if m is None:
        return "match row disappeared"
    if m.get("status") == "failed":
        err = (job or {}).get("error") or "match.status=failed"
        return f"match failed: {err}"
    if job and job.get("status") == "failed":
        return f"job failed at stage={job.get('stage')}: {job.get('error') or '(no error)'}"
    if job and job.get("status") == "canceled":
        return f"job canceled at stage={job.get('stage')}"
    return None


def maybe_dispatch(secrets: dict[str, str], *, max_jobs: int = 1) -> dict:
    return post_fn(
        secrets,
        "/jobs/dispatch",
        {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]},
        {"max": max_jobs},
    )


def monitor_pipeline(
    secrets: dict[str, str],
    *,
    match_id: str,
    owner_id: str | None,
    lane: str,
    until: str,
    timeout_sec: float,
    poll_sec: float,
    dispatch: bool,
    redispatch_if_queued_sec: float = 90.0,
) -> MonitorReport:
    """Poll Supabase + B2 until success, terminal failure, or timeout."""
    if until not in STAGE_ORDER:
        raise ValueError(f"until must be one of {STAGE_ORDER}, got {until}")

    print("\n══ pipeline test monitor ══════════════════════════════════════")
    print(f"  match_id   {match_id}")
    print(f"  lane       {lane}")
    print(f"  until      {until}  (primary={STAGE_PRIMARY[until]})")
    print(f"  timeout    {timeout_sec:.0f}s   poll every {poll_sec:.0f}s")
    print(f"  supabase   {supabase_url(secrets)}")
    print(f"  cdn        {cdn_presign_url(secrets)}")
    print("══════════════════════════════════════════════════════════════\n")

    t0 = time.monotonic()
    last_line = ""
    last_dispatch_at = 0.0
    if dispatch:
        try:
            result = maybe_dispatch(secrets)
            last_dispatch_at = time.monotonic()
            print(f"[dispatch] {json.dumps(result)}")
        except Exception as e:
            print(f"[dispatch] warn: {e}")

    final: Snapshot | None = None
    while True:
        elapsed = time.monotonic() - t0
        if elapsed > timeout_sec:
            final = take_snapshot(secrets, match_id, owner_id, t0)
            checks = evaluate_success(final, until=until, lane=lane)
            return MonitorReport(
                match_id=match_id,
                lane=lane,
                until=until,
                ok=False,
                reason=f"timeout after {timeout_sec:.0f}s",
                elapsed_sec=elapsed,
                checks=checks,
                final=final,
            )

        try:
            snap = take_snapshot(secrets, match_id, owner_id, t0)
        except Exception as e:
            print(f"[monitor] poll error: {e}")
            time.sleep(poll_sec)
            continue

        final = snap
        if snap.match and snap.match.get("owner_id") is not None:
            owner_id = snap.match.get("owner_id")

        comp = snap.completeness
        objects = ", ".join(sorted(snap.basenames)) or "(none)"
        line = (
            f"[{snap.t_elapsed:7.1f}s] {_fmt_match(snap.match)} | {_fmt_job(snap.job)} | "
            f"b2 n={comp.get('normalize')} d={comp.get('detect')} a={comp.get('analyze')} "
            f"| {objects}"
        )
        if line != last_line:
            print(line)
            last_line = line

        fail = detect_terminal_failure(snap)
        if fail:
            checks = evaluate_success(snap, until=until, lane=lane)
            return MonitorReport(
                match_id=match_id,
                lane=lane,
                until=until,
                ok=False,
                reason=fail,
                elapsed_sec=snap.t_elapsed,
                checks=checks,
                final=snap,
            )

        checks = evaluate_success(snap, until=until, lane=lane)
        if is_hard_success(checks):
            return MonitorReport(
                match_id=match_id,
                lane=lane,
                until=until,
                ok=True,
                reason="all checks passed",
                elapsed_sec=snap.t_elapsed,
                checks=checks,
                final=snap,
            )

        # Re-kick dispatch if still queued and flag was set
        job = snap.job
        if (
            dispatch
            and job
            and job.get("status") == "queued"
            and (time.monotonic() - last_dispatch_at) >= redispatch_if_queued_sec
        ):
            try:
                result = maybe_dispatch(secrets)
                last_dispatch_at = time.monotonic()
                print(f"[dispatch] re-kick (still queued): {json.dumps(result)}")
            except Exception as e:
                print(f"[dispatch] re-kick failed: {e}")

        time.sleep(poll_sec)


def print_report(report: MonitorReport) -> None:
    print("\n══ test report ════════════════════════════════════════════════")
    print(f"  result     {'PASS' if report.ok else 'FAIL'}")
    print(f"  reason     {report.reason}")
    print(f"  match_id   {report.match_id}")
    print(f"  lane       {report.lane}")
    print(f"  until      {report.until}")
    print(f"  elapsed    {report.elapsed_sec:.1f}s")
    if report.final:
        print(f"  prefix     {report.final.prefix}")
        print(f"  objects    {', '.join(sorted(report.final.basenames)) or '(none)'}")
        print(f"  {_fmt_match(report.final.match)}")
        print(f"  {_fmt_job(report.final.job)}")
    print("  checks:")
    for c in report.checks:
        mark = "✓" if c.ok else "✗"
        print(f"    {mark}  {c.name}: {c.detail}")
    print("══════════════════════════════════════════════════════════════\n")


# ── ingest ────────────────────────────────────────────────────────────────────


def enqueue_bwf(
    secrets: dict[str, str],
    *,
    match_id: str,
    annotation: dict,
    queue: str,
) -> dict:
    """Catalog match already exists: PUT annotation.json, then enqueue only.

    matches-ingest is called with id + queue and upsert=false so we never
    rewrite scraper metadata (tournament, roster, source_url). The RPC still
    creates a normalize job + pgmq message when none is live.
    """
    require_secrets(secrets, "PIPELINE_SERVICE_TOKEN", "PRESIGN_SERVICE_TOKEN")
    ann_key = f"bwf/{match_id}/annotation.json"
    print(f"[info] uploading {ann_key} via CDN service presign…")
    upload_b2_json(secrets, ann_key, annotation)
    print(f"[info] annotation.json uploaded → {ann_key}")

    service_hdr = {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]}
    print(f"[info] enqueue normalize job for catalog match {match_id} "
          f"(upsert=false, queue={queue})…")
    result = post_fn(secrets, "/matches-ingest", service_hdr, {
        "id": match_id,
        "queue": queue,
        "upsert": False,
    })
    return result


def ingest_upload(
    secrets: dict[str, str],
    *,
    file_path: str,
    annotation: dict,
    labels: list[dict],
    config: dict,
) -> tuple[str, str | None, dict]:
    """User lane: PUT original + confirm ingest + PUT annotation."""
    jwt, uid = sign_in_test_user(secrets)
    print(f"[info] signed in as dev test user {uid}")
    match_id = str(uuid.uuid4())
    prefix = f"users/{uid}/{match_id}/"
    print(f"[info] uploading {file_path} → {prefix}original.mp4")
    put_file(cdn_presign_upload(secrets, jwt, f"{prefix}original.mp4"), file_path)

    ingest = post_fn(
        secrets,
        "/matches-ingest",
        {"Authorization": f"Bearer {jwt}"},
        {"id": match_id, "ext": "mp4", "upload": True},
    )
    ann = build_annotation_json(config, labels, uid) if labels else annotation
    put_bytes_presigned(
        cdn_presign_upload(secrets, jwt, f"{prefix}annotation.json"),
        json.dumps(ann, indent=2).encode(),
    )
    print(f"[info] annotation.json uploaded → {prefix}annotation.json")
    return match_id, uid, ingest


def players_from_annotation(annotation: dict) -> list[str]:
    names: list[str] = []
    for lab in annotation.get("labels") or []:
        if isinstance(lab, dict):
            n = lab.get("display_name")
            if isinstance(n, str) and n.strip():
                names.append(n.strip())
    return names


# ── main ──────────────────────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--url",
        help="YouTube URL — BWF lane: resolve catalog match by source_url "
        "(and use as scrub stream unless --file)",
    )
    p.add_argument(
        "--file",
        help="local video: alone = upload lane (§2b); with BWF = scrub proxy",
    )
    p.add_argument(
        "--tournament",
        help="ignored (legacy): BWF tournament/roster come from the catalog row",
    )
    p.add_argument(
        "--queue",
        default="jobs_interactive",
        choices=["jobs_bulk", "jobs_interactive"],
        help="pgmq queue (default jobs_interactive for tests)",
    )
    p.add_argument(
        "--dispatch",
        action="store_true",
        help="POST /jobs/dispatch after enqueue (and re-kick while still queued)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="annotate + print; write nothing anywhere",
    )
    p.add_argument(
        "--no-monitor",
        action="store_true",
        help="skip Supabase/B2 monitoring after enqueue",
    )
    p.add_argument(
        "--until",
        default="detect",
        choices=["normalize", "detect"],
        help="success stage for the test suite (default: detect)",
    )
    p.add_argument(
        "--timeout-sec",
        type=float,
        default=7200.0,
        help="monitor timeout in seconds (default 7200)",
    )
    p.add_argument(
        "--poll-sec",
        type=float,
        default=15.0,
        help="monitor poll interval (default 15)",
    )
    p.add_argument(
        "--annotation",
        metavar="FILE",
        help="load annotation.json from disk (skip OpenCV UI)",
    )
    p.add_argument(
        "--monitor-only",
        action="store_true",
        help="only monitor an existing match (requires --match-id)",
    )
    p.add_argument(
        "--match-id",
        help="BWF catalog match id (sha256) — preferred BWF resolver; "
        "also used with --monitor-only",
    )
    p.add_argument(
        "--save-annotation",
        metavar="FILE",
        help="write annotation.json to disk after annotate (useful for retests)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    secrets = load_secrets()

    # ── monitor-only path ─────────────────────────────────────────────────────
    if args.monitor_only:
        if not args.match_id:
            sys.exit("--monitor-only requires --match-id")
        require_secrets(
            secrets,
            "SUPABASE_SERVICE_ROLE_KEY",
            "PRESIGN_SERVICE_TOKEN",
        )
        if args.dispatch:
            require_secrets(secrets, "PIPELINE_SERVICE_TOKEN")
        m = fetch_match(secrets, args.match_id)
        if not m:
            sys.exit(f"no match with id={args.match_id}")
        lane = "upload" if m.get("owner_id") else "bwf"
        report = monitor_pipeline(
            secrets,
            match_id=args.match_id,
            owner_id=m.get("owner_id"),
            lane=lane,
            until=args.until,
            timeout_sec=args.timeout_sec,
            poll_sec=args.poll_sec,
            dispatch=args.dispatch,
        )
        print_report(report)
        return 0 if report.ok else 1

    # Lane: pure local file → user upload; otherwise BWF catalog (match-id and/or url).
    if args.file and not args.url and not args.match_id:
        lane = "upload"
    elif args.url or args.match_id:
        lane = "bwf"
    elif args.annotation:
        sys.exit(
            "with --annotation alone, pass --match-id (BWF catalog) "
            "or --file (user upload)"
        )
    else:
        sys.exit(
            "need --match-id and/or --url (BWF catalog) or --file (user upload); "
            "or --monitor-only --match-id …"
        )

    if args.tournament:
        print(
            "[warn] --tournament is ignored; BWF tournament/roster live on the "
            "catalog row (match-data). Annotation labels still go to annotation.json."
        )

    creating = not args.dry_run

    if lane == "upload" and args.file:
        ext = (os.path.splitext(args.file)[1].lstrip(".").lower() or "mp4")
        if ext != "mp4":
            sys.exit("user uploads must be .mp4 (cdn-access allowlist: original.mp4)")
    if lane == "upload" and not args.file and not args.dry_run:
        sys.exit("upload lane needs --file")

    # ── BWF: resolve existing catalog row first ───────────────────────────────
    catalog: dict | None = None
    if lane == "bwf":
        if creating:
            require_secrets(secrets, "SUPABASE_SERVICE_ROLE_KEY")
            catalog = resolve_bwf_catalog_match(
                secrets, match_id=args.match_id, url=args.url,
            )
        elif service_key(secrets) and (args.match_id or args.url):
            # Dry-run: resolve when possible so scrub can use catalog source_url.
            catalog = resolve_bwf_catalog_match(
                secrets, match_id=args.match_id, url=args.url,
            )
        if catalog:
            print(
                f"[info] BWF catalog match id={catalog['id']} "
                f"tournament={catalog.get('tournament')!r} "
                f"status={catalog.get('status')} "
                f"source_url={catalog.get('source_url')!r}"
            )
            if not catalog.get("source_url"):
                print(
                    "[warn] catalog source_url is empty — normalize needs a "
                    "YouTube URL on the row (or a staged original under bwf/…)"
                )

    if creating:
        if lane == "bwf" or args.dispatch:
            require_secrets(secrets, "PIPELINE_SERVICE_TOKEN")
        if lane == "bwf" or not args.no_monitor:
            require_secrets(secrets, "PRESIGN_SERVICE_TOKEN", "SUPABASE_SERVICE_ROLE_KEY")

    # ── annotation ────────────────────────────────────────────────────────────
    annotation: dict
    labels: list[dict] = []
    config: dict = {}
    yt: dict | None = None

    # Scrub source for OpenCV / yt-dlp: explicit --url, else catalog source_url.
    scrub_url = args.url or (catalog.get("source_url") if catalog else None)

    if args.annotation:
        annotation = load_annotation_file(args.annotation)
        labels = [
            l for l in (annotation.get("labels") or [])
            if isinstance(l, dict)
        ]
        players = players_from_annotation(annotation)
        print(f"[info] loaded annotation from {args.annotation} "
              f"({len(labels)} labels, names={players})")
        if scrub_url and not args.file:
            try:
                yt = probe_youtube(scrub_url)
            except Exception as e:
                print(f"[info] yt-dlp probe skipped/failed: {e}")
    else:
        if not scrub_url and not args.file:
            sys.exit(
                "interactive annotate needs a video source: --file and/or "
                "--url, or a catalog row with source_url (--match-id)"
            )
        # open_source expects args.url / args.file; temporarily bind scrub URL.
        open_args = argparse.Namespace(url=scrub_url, file=args.file)
        sam = SlimSam()
        source, yt = open_source(open_args)
        print(f"[info] annotating at {source.width}x{source.height}, "
              f"duration {source.duration:.0f}s"
              + (f" (youtube id {yt['video_id']})" if yt else ""))
        config = annotate(
            source, sam,
            with_geometry=True,
            with_scoreboard=lane == "bwf",
        )
        if config is None:
            sys.exit("aborted in UI, nothing written")
        labels = config.pop("player_labels")
        players = [l["display_name"] for l in labels]
        print("\ngeometry:")
        print(json.dumps(
            {k: v for k, v in config.items() if v is not None or lane == "bwf"},
            indent=2,
        ))
        annotation = build_annotation_json(config, labels, "annotate_and_ingest.py")
        print("\nannotation.json:")
        print(json.dumps(annotation, indent=2))
        if lane == "bwf":
            print(f"\nplayer_names: {players}")

    if args.save_annotation:
        with open(args.save_annotation, "w") as f:
            json.dump(annotation, f, indent=2)
            f.write("\n")
        print(f"[info] wrote {args.save_annotation}")

    if not creating:
        print("\n[dry-run] nothing uploaded, no job enqueued")
        return 0

    players = players_from_annotation(annotation)
    if lane == "bwf" and not players:
        print(
            "[warn] no display_name on labels — BWF valid-frames uses label "
            "names and/or existing match roster columns"
        )

    # ── write annotation + enqueue (BWF) or create match (upload) ─────────────
    owner_id: str | None = None
    if lane == "bwf":
        if catalog is None:
            catalog = resolve_bwf_catalog_match(
                secrets, match_id=args.match_id, url=args.url or scrub_url,
            )
        match_id = catalog["id"]
        ingest = enqueue_bwf(
            secrets,
            match_id=match_id,
            annotation=annotation,
            queue=args.queue,
        )
    else:
        # config may be empty if --annotation only on upload — rebuild labels
        if not config and labels:
            court = annotation.get("court") or {}
            config = {
                "corners": court.get("corners"),
                "scoreboard_crop": court.get("scoreboard_crop"),
                "score_sub_crop": court.get("score_sub_crop"),
                "row_split_y": court.get("row_split_y"),
                "frame_width": annotation.get("frame_width"),
                "frame_height": annotation.get("frame_height"),
                "annotated_at_sec": annotation.get("annotated_at_sec"),
            }
        match_id, owner_id, ingest = ingest_upload(
            secrets,
            file_path=args.file,
            annotation=annotation,
            labels=labels,
            config=config,
        )

    print(f"[info] enqueue/ingest: {json.dumps(ingest)}")
    if ingest.get("already_queued"):
        print(
            f"[info] match already has a live job "
            f"(job_id={ingest.get('job_id')}); annotation was still uploaded"
        )
    print(f"[info] match_id={match_id}")

    if args.no_monitor:
        if args.dispatch:
            result = maybe_dispatch(secrets)
            print(f"[dispatch] {json.dumps(result)}")
        else:
            print(
                f"\nto dispatch: curl -X POST {functions_base(secrets)}/jobs/dispatch "
                f"-H 'x-pipeline-token: …' -d '{{\"max\":1}}'"
            )
            print(
                f"to monitor later:\n  python3 scripts/annotate_and_ingest.py "
                f"--monitor-only --match-id {match_id} --until {args.until}"
            )
        return 0

    report = monitor_pipeline(
        secrets,
        match_id=match_id,
        owner_id=owner_id,
        lane=lane,
        until=args.until,
        timeout_sec=args.timeout_sec,
        poll_sec=args.poll_sec,
        dispatch=args.dispatch,
    )
    print_report(report)
    return 0 if report.ok else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[info] interrupted", file=sys.stderr)
        raise SystemExit(130)
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(2)
