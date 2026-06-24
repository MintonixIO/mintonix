"""Backend "model server" for the video-normalization PyWorker.

This is the HTTP service the vast.ai PyWorker (worker.py) proxies to. It does
the actual work by calling the provider-neutral core in normalize.py.

Contract (the PyWorker's request_parser unwraps the outer {"input": ...}, so
this server receives the inner object):

    POST /normalize/sync
        { "input_url": "...",                # presigned GET (parallel ranges)
          "request_id": "...",
          # exactly one output destination:
          "output_upload_url": "...",        # single presigned PUT, OR
          "output_upload": {                 # parallel multipart (preferred)
              "part_urls": [...], "complete_url": "...",
              "abort_url": "...", "part_size": 67108864 } }
      -> 200 { "request_id", "width", "height", "fps", "codec", "audio_codec",
               "pixel_fmt", "duration", "file_size", "source", "elapsed_sec" }
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
    if not input_url or not (output_upload_url or output_upload):
        return JSONResponse(
            {"request_id": request_id,
             "error": "input_url and one of output_upload_url / output_upload are required"},
            status_code=422,
        )

    # normalize_job is blocking (ffmpeg, large I/O); run it off the event loop.
    try:
        result = await run_in_threadpool(
            normalize.normalize_job, input_url, output_upload_url, output_upload
        )
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
