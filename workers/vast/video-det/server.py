"""Backend model server for the video-det PyWorker.

Mirrors workers/vast/video-preprocess/server.py: this is the HTTP service the
vast.ai PyWorker proxies to. It does the work; worker.py only reports load.

Contract (request_parser unwraps {"input": {...}}; this server also accepts a
still-wrapped body):

    POST /detect/sync
        {
          "request_id": "...",                 # job_id
          "input_url": "...",                  # presigned GET or file:// normalized.mp4
          "output_upload_url": "...",          # presigned PUT or file:// for detections.json
          "annotation_url": "...",             # optional presigned GET annotation.json
          "preprocess_log_url": "...",         # optional presigned GET preprocess-log.json
          "annotation": { … },                 # optional inline (tests / local)
          "preprocess_log": { … },             # optional inline (tests / local)
          "callback_url": "...",               # jobs/callback
          "callback_token": "..."              # Bearer token (HMAC JWT)
        }
      -> 202 { "request_id" } as soon as the job thread is running; the
         connection is held until GPU + callback finish (PyWorker load).
         Callback is the settle path; a later job failure does not change 202.
      -> 422 / 503 { "request_id", "error" }  (sync; no job thread)

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

import asyncio
import json
import logging
import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from detect import DetectConfig, VideoDetector
from detect.output import (
    build_segments_for_video,
    probe_video,
    write_detections_json,
)
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
# One GPU job at a time (matches PyWorker allow_parallel_requests=False).
_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="detect-job")


def _allow_missing_models() -> bool:
    return os.environ.get("ALLOW_MISSING_MODELS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _assert_trt_loaded() -> None:
    """Fail startup if native nvinfer is not loadable (version 0.0.x)."""
    import tensorrt as trt

    ver = getattr(trt, "__version__", "") or ""
    log.info("startup: tensorrt %s", ver)
    if not ver or ver.startswith("0.0"):
        raise RuntimeError(f"native TensorRT not loaded (version={ver!r})")


async def _load_models() -> None:
    """Load TRT engines at startup. Fail hard unless ALLOW_MISSING_MODELS=1."""
    global _detector
    cfg = DetectConfig.from_env()
    allow_missing = _allow_missing_models()
    _assert_trt_loaded()
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


class _HoldUntilDone(StreamingResponse):
    """Chunked JSON 202; keep the ASGI handler alive until the iterator ends.

    Starlette's StreamingResponse (ASGI spec < 2.4, including uvicorn 2.3)
    cancels the stream on http.disconnect. PyWorker load is in-flight HTTP, so
    we must not return when the dispatcher leaves — only when the job thread
    finishes.
    """

    async def __call__(self, scope, receive, send) -> None:  # noqa: ARG002
        try:
            await self.stream_response(send)
        except Exception:  # noqa: BLE001
            try:
                async for _ in self.body_iterator:
                    pass
            except Exception as e:  # noqa: BLE001
                log.exception("detect: job wait after disconnect: %s", safe_error_message(e))
        if self.background is not None:
            await self.background()


@app.get("/health")
async def health() -> JSONResponse:
    if _detector is None:
        return JSONResponse(
            {"status": "not_ready", "models_loaded": False},
            status_code=503,
        )
    return JSONResponse({"status": "ok", "models_loaded": True})


@app.post("/detect/sync")
async def detect_sync(request: Request) -> Response:
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
    annotation = body.get("annotation") if isinstance(body.get("annotation"), dict) else None
    preprocess_log = (
        body.get("preprocess_log")
        if isinstance(body.get("preprocess_log"), dict)
        else None
    )
    annotation_url = body.get("annotation_url")
    preprocess_log_url = body.get("preprocess_log_url")

    def run_and_report() -> dict:
        try:
            result = _run_job(
                request_id=request_id,
                input_url=input_url,
                output_upload_url=output_upload_url,
                annotation=annotation,
                preprocess_log=preprocess_log,
                annotation_url=annotation_url,
                preprocess_log_url=preprocess_log_url,
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

    # 202 is visible as soon as the worker is running; the ASGI handler does
    # not return until run_and_report finishes so PyWorker in-flight load
    # stays non-zero (Vast must not see load=0 mid-job).
    running = threading.Event()

    def _entry() -> dict:
        running.set()
        return run_and_report()

    future = _JOB_EXECUTOR.submit(_entry)
    await asyncio.to_thread(running.wait)
    payload = json.dumps({"request_id": request_id}).encode("utf-8")
    done = asyncio.wrap_future(future)

    async def _hold_until_done():
        yield payload
        try:
            await done
        except Exception as e:  # noqa: BLE001
            err = safe_error_message(e)
            log.exception(
                "detect(failed): request_id=%s error=%s", request_id, err
            )

    return _HoldUntilDone(
        _hold_until_done(),
        status_code=202,
        media_type="application/json",
    )


# ---------------------------------------------------------------------------
# Job body
# ---------------------------------------------------------------------------

def _download_json(url: str | None, *, label: str) -> dict | None:
    """Best-effort GET of a small JSON sidecar. Missing URL or HTTP fail → None."""
    if not url or not isinstance(url, str):
        return None
    fd, name = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    tmp = Path(name)
    try:
        download(url, tmp, max_bytes=32 * 1024 * 1024)
        data = json.loads(tmp.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception as e:  # noqa: BLE001
        log.warning("optional %s download failed: %s", label, safe_error_message(e))
        return None
    finally:
        tmp.unlink(missing_ok=True)


def _run_job(
    *,
    request_id: str | None,
    input_url: str,
    output_upload_url: str,
    annotation: dict | None = None,
    preprocess_log: dict | None = None,
    annotation_url: str | None = None,
    preprocess_log_url: str | None = None,
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

        if annotation is None:
            annotation = _download_json(annotation_url, label="annotation.json")
        if preprocess_log is None:
            preprocess_log = _download_json(
                preprocess_log_url, label="preprocess-log.json"
            )

        meta = probe_video(video_tmp)
        segments = build_segments_for_video(
            video_path=video_tmp,
            annotation=annotation,
            preprocess_log=preprocess_log,
            frame_count_hint=int(meta.get("frame_count_hint") or 0),
        )

        frame_count = _stream_detections_json(
            json_tmp,
            request_id=request_id,
            video_path=video_tmp,
            segments=segments,
            fps=float(meta.get("fps") or 0.0),
            width=int(meta.get("width") or 0),
            height=int(meta.get("height") or 0),
        )
        if frame_count == 0:
            raise RuntimeError("no frames decoded from video")
        upload_file(json_tmp, output_upload_url, content_type="application/json")

        elapsed = time.monotonic() - t0
        log.info(
            "detect(done): request_id=%s frames=%d segments=%d elapsed=%.1fs",
            request_id,
            frame_count,
            len(segments),
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
    segments: list | None = None,
    fps: float = 0.0,
    width: int = 0,
    height: int = 0,
) -> int:
    """Write Engine detections.json (meta + segments + streamed frames)."""
    assert _detector is not None
    return write_detections_json(
        dest,
        request_id=request_id,
        video_path=video_path,
        frame_chunks=_detector.run(video_path),
        segments=segments or [],
        fps=fps,
        width=width,
        height=height,
    )


if __name__ == "__main__":
    import uvicorn  # runtime only — keep import server CPU-safe for CI/tests

    log.info("startup: listening on %s:%s", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
