"""Backend model server for the video-det PyWorker.

Mirrors workers/vast/video-preprocess/server.py: this is the HTTP service the
vast.ai PyWorker proxies to. It does the work; worker.py only reports load.

Contract (request_parser unwraps {"input": {...}}; this server also accepts a
still-wrapped body):

    POST /detect/sync
        {
          "request_id": "...",                 # job_id
          "input_url": "...",                  # presigned GET or file://
          "output_upload_url": "...",          # presigned PUT or file:// for detections.json
          "callback_url": "...",               # jobs/callback
          "callback_token": "..."              # Bearer token (HMAC JWT)
        }
      -> 200 { "request_id", "frame_count", "elapsed_sec" }
      -> 422 / 500 { "request_id", "error" }

    GET /health
        -> 200 { "status": "ok", "models_loaded": true } when detector is ready
        -> 503 { "status": "not_ready", "models_loaded": false } otherwise

Callback (from the job thread, Authorization: Bearer <callback_token>):
    { "request_id", "status": "success"|"failed", "frame_count"?, "error"? }

No Realtime progress in MVP — re-add later if the UI needs it.

Startup requires pose + shuttle TensorRT engines on disk unless
ALLOW_MISSING_MODELS=1 (CI). There is no PyTorch /.pt fallback — missing or
bad engines fail the job.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from detect import DetectConfig, VideoDetector
from io_util import download, post_callback, safe_error_message, upload_file

_DEFAULT_CALLBACK_PATH_SUFFIX = "/functions/v1/jobs/callback"


def _callback_prefix() -> str:
    return (
        os.environ.get("CALLBACK_URL_PREFIX")
        or os.environ.get("SUPABASE_URL")
        or ""
    ).rstrip("/")


def _callback_url_allowed(url: str | None) -> bool:
    """Same policy as video-preprocess: prefix-required, path suffix, fail-closed."""
    if not url:
        return True
    if os.environ.get("ALLOW_UNSAFE_CALLBACK", "0").lower() in (
        "1",
        "true",
        "yes",
    ):
        return True
    prefix = _callback_prefix()
    if not prefix:
        return False
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return False
    if parsed.scheme not in ("https", "http"):
        return False
    path = parsed.path or ""
    if not path.endswith(_DEFAULT_CALLBACK_PATH_SUFFIX):
        return False
    return url.startswith(prefix + "/") or url.startswith(prefix + "?") or url == prefix


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("video-det.server")

HOST = os.environ.get("MODEL_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))

_detector: VideoDetector | None = None


def _allow_missing_models() -> bool:
    return os.environ.get("ALLOW_MISSING_MODELS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


async def _load_models() -> None:
    """Load TRT engines at startup. Fail hard unless ALLOW_MISSING_MODELS=1."""
    global _detector
    cfg = DetectConfig.from_env()
    allow_missing = _allow_missing_models()
    if not cfg.pose_engine.is_file() or not cfg.shuttle_engine.is_file():
        msg = (
            f"startup: engines missing (pose={cfg.pose_engine} "
            f"shuttle={cfg.shuttle_engine})"
        )
        if allow_missing:
            log.warning("%s — ALLOW_MISSING_MODELS=1; /health not ready", msg)
            return
        log.error("%s — refusing to start (set ALLOW_MISSING_MODELS=1 for CI)", msg)
        raise FileNotFoundError(msg)
    try:
        _detector = VideoDetector.from_config(cfg)
    except Exception:
        # Engine deserialize / CUDA init failure → job cannot run.
        log.exception("startup: failed to load TRT engines")
        raise
    log.info(
        "startup: VideoDetector loaded (batch=%d conf=%s)",
        _detector.pose_batch,
        cfg.conf,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern FastAPI lifespan: load models on startup (fail-hard unless allowed)."""
    await _load_models()
    yield


app = FastAPI(title="video-det", lifespan=lifespan)


@app.get("/health")
async def health() -> JSONResponse:
    if _detector is None:
        return JSONResponse(
            {"status": "not_ready", "models_loaded": False},
            status_code=503,
        )
    return JSONResponse({"status": "ok", "models_loaded": True})


@app.post("/detect/sync")
async def detect_sync(request: Request) -> JSONResponse:
    body = await request.json()
    if "input_url" not in body and isinstance(body.get("input"), dict):
        body = body["input"]

    request_id = body.get("request_id")
    input_url = body.get("input_url")
    output_upload_url = body.get("output_upload_url")
    callback_url = body.get("callback_url")
    callback_token = body.get("callback_token")

    if not input_url or not output_upload_url:
        return JSONResponse(
            {
                "request_id": request_id,
                "error": "input_url and output_upload_url are required",
            },
            status_code=422,
        )
    if callback_url and not _callback_url_allowed(callback_url):
        return JSONResponse(
            {
                "request_id": request_id,
                "error": (
                    "callback_url not allowed (must match CALLBACK_URL_PREFIX "
                    "/ SUPABASE_URL and end with /functions/v1/jobs/callback)"
                ),
            },
            status_code=422,
        )
    if _detector is None:
        return JSONResponse(
            {"request_id": request_id, "error": "models not loaded"},
            status_code=503,
        )

    # Job work is blocking (download + GPU); run off the event loop. Callback
    # POSTs inside the thread so a disconnected dispatcher still gets the result.
    def run_and_report() -> dict:
        try:
            result = _run_job(
                request_id=request_id,
                input_url=input_url,
                output_upload_url=output_upload_url,
            )
        except Exception as e:
            err = safe_error_message(e)
            if callback_url:
                post_callback(
                    callback_url,
                    callback_token,
                    {
                        "request_id": request_id,
                        "status": "failed",
                        "error": err,
                    },
                )
            # Re-raise with redacted message so outer handler cannot leak secrets.
            raise RuntimeError(err) from None
        if callback_url:
            code = post_callback(
                callback_url,
                callback_token,
                {
                    "request_id": request_id,
                    "status": "success",
                    **result,
                },
            )
            # Do not claim HTTP success if settlement never reached jobs —
            # otherwise the job can sit processing until VT reclaim.
            if code is None or code >= 400:
                raise RuntimeError(
                    f"callback failed after successful detect (HTTP {code})"
                )
        return result

    try:
        result = await run_in_threadpool(run_and_report)
        return JSONResponse({"request_id": request_id, **result})
    except Exception as e:  # noqa: BLE001
        err = safe_error_message(e)
        log.exception("detect(failed): request_id=%s error=%s", request_id, err)
        return JSONResponse(
            {"request_id": request_id, "error": err},
            status_code=500,
        )


# ---------------------------------------------------------------------------
# Job body
# ---------------------------------------------------------------------------

def _run_job(
    *,
    request_id: str | None,
    input_url: str,
    output_upload_url: str,
) -> dict:
    assert _detector is not None
    t0 = time.monotonic()

    video_fd, video_name = tempfile.mkstemp(suffix=".mp4")
    os.close(video_fd)
    video_tmp = Path(video_name)
    json_fd, json_name = tempfile.mkstemp(suffix=".json")
    os.close(json_fd)
    json_tmp = Path(json_name)

    try:
        download(input_url, video_tmp)

        frame_count = _stream_detections_json(
            json_tmp, request_id=request_id, video_path=video_tmp
        )
        if frame_count == 0:
            raise RuntimeError("no frames decoded from video")
        upload_file(json_tmp, output_upload_url, content_type="application/json")

        elapsed = time.monotonic() - t0
        log.info(
            "detect(done): request_id=%s frames=%d elapsed=%.1fs",
            request_id,
            frame_count,
            elapsed,
        )
        return {"frame_count": frame_count, "elapsed_sec": round(elapsed, 3)}
    finally:
        video_tmp.unlink(missing_ok=True)
        json_tmp.unlink(missing_ok=True)


def _stream_detections_json(
    dest: Path,
    *,
    request_id: str | None,
    video_path: Path,
) -> int:
    """Write detections.json incrementally so long matches stay memory-bounded."""
    assert _detector is not None
    frame_count = 0
    first = True
    with dest.open("w", encoding="utf-8") as f:
        f.write('{"job_id":')
        f.write(json.dumps(request_id))
        f.write(',"frames":[')
        for chunk_results in _detector.run(video_path):
            for fr in chunk_results:
                if not first:
                    f.write(",")
                f.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                first = False
                frame_count += 1
        f.write("]}")
    return frame_count


if __name__ == "__main__":
    import uvicorn  # runtime only — keep import server CPU-safe for CI/tests

    log.info("startup: listening on %s:%s", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
