"""Backend "model server" for the video-normalization PyWorker.

This is the HTTP service the vast.ai PyWorker (worker.py) proxies to. It does
the actual work by calling the provider-neutral core in normalize.py.

Contract (the PyWorker's request_parser unwraps the outer {"input": ...}, so
this server receives the inner object):

    POST /normalize/sync
        { "input_url": "...",                # presigned GET (parallel ranges),
                                             # or a YouTube URL (worker fetches
                                             # it itself with yt-dlp)
          "request_id": "...",
          # optional, youtube sources: presigned PUT archiving the pristine
          # download to B2 (required upload — B2 is canonical after this job)
          "original_upload_url": "...",
          # exactly one primary output destination:
          # Production jobs: parallel multipart (CDN op=MULTIPART + jobs dispatcher).
          "output_upload": {                 # preferred: parallel multipart
              "part_urls": [...], "complete_url": "...",
              "abort_url": "...", "part_size": 67108864 },
          # Single presigned PUT (local file:// / small CLI); production uses multipart.
          "output_upload_url": "...",
          # optional: presigned PUT for a random-frame JPEG thumbnail; presign a
          # .jpg key in the same directory as the output.
          "thumbnail_upload_url": "...",
          # optional BWF cleaned path: detect court∧scoreboard on source, one
          # GPU encode of keep-ranges into the primary output (normalized.mp4).
          # manifest_upload_url required; scoreboard geometry optional (defaults).
          "valid_frames_config": {
              "court_corners": [[x,y],[x,y],[x,y],[x,y]],
              "player_names": ["...", "..."],
              "scoreboard_crop": {"x":0,"y":0,"w":0,"h":0},  # optional
              "score_sub_crop": {"x":0,"y":0,"w":0,"h":0},   # optional
              "row_split_y": 0 },                             # optional
          "manifest_upload_url": "...",         # ranges CSV (old/new start/end)
          # optional youtube pristine archive (multipart preferred, or single PUT)
          "original_upload": { "part_urls": [...], "complete_url": "...",
                               "abort_url": "...", "part_size": 67108864 },
          "original_upload_url": "...",
          # optional async report channel: when given, the worker POSTs the
          # result (success or failure, same shape as the HTTP response body,
          # plus "status": "success"|"failed") to callback_url with
          # `Authorization: Bearer <callback_token>` from inside the job
          # thread — the dispatching client is long gone by the time a real
          # job finishes. Failure payloads include "original_archived": true
          # when the pristine-source archive made it to B2 before the error.
          "callback_url": "...",
          "callback_token": "..." }
      -> 200 { "request_id", "width", "height", "fps", "codec", "audio_codec",
               "pixel_fmt", "duration", "file_size", "source", "elapsed_sec",
               # when thumbnail_upload_url given (best-effort):
               "thumbnail": { "width", "height", "file_size", "timestamp_sec" }
                            | null, "thumbnail_error"?,
               # when valid_frames_config given (fails the job on error instead):
               "valid_frames"?: { "width", "height", "fps", "duration", "file_size",
                                  "source_frame_count", "valid_frame_count",
                                  "num_ranges", "manifest_file_size" } }
      -> 422 { "request_id", "error" }   # malformed request (missing in/out,
                                         # bad valid_frames_config shape)
      -> 500 { "request_id", "error" }

    GET /health  -> 200 { "status": "ok", "gpu": <bool> }

Listens on 127.0.0.1:18000 by default (MODEL_SERVER_PORT). The PyWorker reads
uvicorn's "Application startup complete." line for readiness (LogActionConfig
on_load) — keep that line emitted on stdout.
"""

import logging
import os
import time
from urllib.parse import urlparse

import uvicorn
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import normalize

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("video-normalization.server")

HOST = os.environ.get("MODEL_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))

# Production-safe default path when CALLBACK_URL_PREFIX / SUPABASE_URL unset:
# stock jobs edge function endpoint (any https host).
_DEFAULT_CALLBACK_PATH_SUFFIX = "/functions/v1/jobs/callback"

app = FastAPI(title="video-normalization")


def _callback_prefix() -> str:
    return (
        os.environ.get("CALLBACK_URL_PREFIX")
        or os.environ.get("SUPABASE_URL")
        or ""
    ).rstrip("/")


def _callback_url_allowed(url: str | None) -> bool:
    """Allow callback_url under a tight allowlist (Bearer token exfil risk).

    Priority:
      1. ALLOW_UNSAFE_CALLBACK=1 — any URL (local/dev only).
      2. CALLBACK_URL_PREFIX or SUPABASE_URL — URL must start with that prefix
         and path must end with /functions/v1/jobs/callback.
      3. Prefix empty — **fail closed** (path-suffix-only was host-open).
    """
    if not url:
        return True
    if os.environ.get("ALLOW_UNSAFE_CALLBACK", "0").lower() in (
        "1", "true", "yes",
    ):
        return True
    prefix = _callback_prefix()
    if not prefix:
        return False
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001 — reject unparseable URLs
        return False
    if parsed.scheme not in ("https", "http"):
        return False
    path = parsed.path or ""
    if not path.endswith(_DEFAULT_CALLBACK_PATH_SUFFIX):
        return False
    return url.startswith(prefix + "/") or url.startswith(prefix + "?") or url == prefix


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "gpu": normalize.use_gpu()}


@app.post("/normalize/sync")
async def normalize_sync(request: Request) -> JSONResponse:
    body = await request.json()
    # The PyWorker's request_parser unwraps the {"input": {...}} envelope, but
    # tolerate a still-wrapped body too — whether the proxy forwards the wrapped
    # or unwrapped payload is the one piece of the contract not verifiable
    # without a live deploy, so accept both shapes.
    if "input_url" not in body and isinstance(body.get("input"), dict):
        body = body["input"]

    request_id = body.get("request_id")
    input_url = body.get("input_url")
    output_upload_url = body.get("output_upload_url")
    output_upload = body.get("output_upload")  # multipart spec (dict) or None
    thumbnail_upload_url = body.get("thumbnail_upload_url")  # presigned PUT or None
    valid_frames_config = body.get("valid_frames_config")
    # Preferred production path: raw annotation.json + roster; worker maps.
    annotation = body.get("annotation")
    roster = body.get("roster") if isinstance(body.get("roster"), dict) else None
    manifest_upload_url = body.get("manifest_upload_url")
    original_upload_url = body.get("original_upload_url")  # archive PUT (legacy / local)
    original_upload = body.get("original_upload")  # archive multipart (production youtube)
    # Async report channel: the dispatcher disconnects long before a real job
    # finishes (it runs in an edge function with a wall-clock limit), so when
    # it provides callback_url the worker POSTs the result there itself,
    # authing with the single-use callback_token from the envelope.
    callback_url = body.get("callback_url")
    callback_token = body.get("callback_token")
    if not input_url or not (output_upload_url or output_upload):
        return JSONResponse(
            {"request_id": request_id,
             "error": "input_url and one of output_upload_url / output_upload are required"},
            status_code=422,
        )
    # Early request fingerprint (before validation work) so cold-start logs show
    # whether the job was accepted and which path it takes.
    log.info(
        "normalize(request): request_id=%s bwf=%s annotation=%s multipart=%s "
        "thumb=%s manifest=%s archive=%s callback=%s youtube=%s "
        "callback_prefix_set=%s ncc_fps=%s ocr_device=%s ocr_workers=%s",
        request_id,
        valid_frames_config is not None or annotation is not None,
        annotation is not None,
        bool(output_upload),
        bool(thumbnail_upload_url),
        bool(manifest_upload_url),
        bool(original_upload or original_upload_url),
        bool(callback_url),
        bool(input_url and ("youtube.com" in str(input_url) or "youtu.be" in str(input_url))),
        bool(_callback_prefix()),
        os.environ.get("NCC_FPS", ""),
        os.environ.get("OCR_DEVICE", "auto"),
        os.environ.get("OCR_WORKERS", ""),
    )

    if callback_url and not _callback_url_allowed(callback_url):
        log.warning(
            "normalize(reject): request_id=%s callback_url not allowed "
            "(prefix_set=%s)",
            request_id, bool(_callback_prefix()),
        )
        return JSONResponse(
            {"request_id": request_id,
             "error": ("callback_url not allowed (set CALLBACK_URL_PREFIX or "
                       "SUPABASE_URL; URL must match that prefix and end with "
                       "/functions/v1/jobs/callback)")},
            status_code=422,
        )
    if annotation is not None and valid_frames_config is None:
        from annotation_map import annotation_to_valid_frames_config
        valid_frames_config = annotation_to_valid_frames_config(
            annotation if isinstance(annotation, dict) else {},
            roster=roster,
        )
        if valid_frames_config is None:
            return JSONResponse(
                {
                    "request_id": request_id,
                    "error": (
                        "annotation unusable (need court.corners + player "
                        "names/labels or roster)"
                    ),
                },
                status_code=422,
            )
    if valid_frames_config is not None:
        # Primary cleaned asset is output_upload(_url). Manifest (ranges CSV) required.
        err = normalize.validate_valid_frames_request(
            valid_frames_config,
            has_destination=bool(output_upload or output_upload_url),
            has_manifest=bool(manifest_upload_url),
        )
        if err:
            return JSONResponse(
                {"request_id": request_id, "error": err}, status_code=422
            )

    # normalize_job is blocking (ffmpeg, large I/O); run it off the event loop.
    # The callback POST happens INSIDE the worker thread, not after the await:
    # a disconnected client cancels this coroutine, but a threadpool thread
    # always runs to completion — so the result is reported even when the
    # dispatcher hung up an hour ago.
    def run_and_report() -> dict:
        progress: dict = {}
        t0 = time.time()
        log.info("normalize(run,start): request_id=%s", request_id)
        try:
            result = normalize.normalize_job(
                input_url, output_upload_url, output_upload,
                thumbnail_upload_url, valid_frames_config,
                manifest_upload_url, original_upload_url,
                original_upload=original_upload, progress=progress,
            )
        except Exception as e:
            log.exception(
                "normalize(run,failed): request_id=%s elapsed=%.1fs",
                request_id, time.time() - t0,
            )
            if callback_url:
                normalize.post_callback(callback_url, callback_token, {
                    "request_id": request_id, "status": "failed",
                    "error": normalize.sanitize_error(e), **progress,
                })
            raise
        log.info(
            "normalize(run,ok): request_id=%s elapsed=%.1fs stage_timings=%s",
            request_id,
            time.time() - t0,
            result.get("stage_timings"),
        )
        if callback_url:
            normalize.post_callback(callback_url, callback_token, {
                "request_id": request_id, "status": "success", **result,
            })
        return result

    try:
        result = await run_in_threadpool(run_and_report)
        return JSONResponse({"request_id": request_id, **result})
    except Exception as e:  # noqa: BLE001 — report any job failure as 500
        log.exception("normalize(failed): request_id=%s", request_id)
        return JSONResponse(
            {"request_id": request_id, "error": normalize.sanitize_error(e)},
            status_code=500,
        )


if __name__ == "__main__":
    # Warm the GPU/filter detection once so the first request isn't slowed and
    # the chosen path is visible in the startup logs.
    log.info("startup: gpu=%s scale_cuda=%s", normalize.use_gpu(), normalize.has_scale_cuda())
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
