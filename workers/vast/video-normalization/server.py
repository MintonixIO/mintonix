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
          # exactly one output destination:
          "output_upload_url": "...",        # single presigned PUT, OR
          "output_upload": {                 # parallel multipart (preferred)
              "part_urls": [...], "complete_url": "...",
              "abort_url": "...", "part_size": 67108864 },
          # optional: presigned PUT for a random-frame JPEG thumbnail; presign a
          # .jpg key in the same directory as the output.
          "thumbnail_upload_url": "...",
          # optional: filter the normalized output down to "valid" frames
          # (main court camera visible AND scoreboard present) -- see
          # valid_frames.extract_valid_frames for the config shape. All three
          # of valid_frames_config, a valid_frames upload destination, and
          # manifest_upload_url are required together.
          "valid_frames_config": {
              "court_corners": [[x,y],[x,y],[x,y],[x,y]],
              "scoreboard_crop": {"x":0,"y":0,"w":0,"h":0},
              "score_sub_crop": {"x":0,"y":0,"w":0,"h":0},
              "row_split_y": 0,
              "player_names": ["...", "..."] },
          "valid_frames_upload_url": "...",     # single presigned PUT, OR
          "valid_frames_upload": { "...": "... (same shape as output_upload)" },
          "manifest_upload_url": "...",         # presigned PUT for the frame manifest CSV
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

app = FastAPI(title="video-normalization")


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
    valid_frames_upload_url = body.get("valid_frames_upload_url")
    valid_frames_upload = body.get("valid_frames_upload")
    manifest_upload_url = body.get("manifest_upload_url")
    original_upload_url = body.get("original_upload_url")  # archive PUT for youtube sources
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
    if valid_frames_config is not None:
        # Reject a malformed valid-frames request here, before the job burns a
        # download + full transcode only to fail on it at the end.
        err = normalize.validate_valid_frames_request(
            valid_frames_config,
            has_destination=bool(valid_frames_upload or valid_frames_upload_url),
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
        try:
            result = normalize.normalize_job(
                input_url, output_upload_url, output_upload,
                thumbnail_upload_url, valid_frames_config,
                valid_frames_upload_url, valid_frames_upload,
                manifest_upload_url, original_upload_url, progress=progress,
            )
        except Exception as e:
            if callback_url:
                normalize.post_callback(callback_url, callback_token, {
                    "request_id": request_id, "status": "failed",
                    "error": str(e), **progress,
                })
            raise
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
            {"request_id": request_id, "error": str(e)}, status_code=500
        )


if __name__ == "__main__":
    # Warm the GPU/filter detection once so the first request isn't slowed and
    # the chosen path is visible in the startup logs.
    log.info("startup: gpu=%s scale_cuda=%s", normalize.use_gpu(), normalize.has_scale_cuda())
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
