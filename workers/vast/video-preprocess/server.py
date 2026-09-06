"""Backend model server for video-preprocess (normalize + detect).

PyWorker proxies here. Contract (unwraps {"input": {...}}):

    POST /preprocess/sync  fused encode + detect (product path)
    POST /detect/sync      detect-only ops retry
      -> 202 { "request_id" } as soon as the job thread is running; the
         connection is held until GPU + callback finish (PyWorker load).
         Callback is the settle path; a later job failure does not change 202.
      -> 422 / 429 / 503 { "request_id", "error" }  (sync; no job thread)

    GET /health
        -> 200 { "status": "ok", "models_loaded": true } when detector is ready
        -> 503 { "status": "not_ready", "models_loaded": false } otherwise

    POST /benchmark/ping -> 200 { "ok": true } (no GPU)

Callback (from the job thread, Authorization: Bearer <callback_token>):
    { "request_id", "status": "success"|"failed", "frame_count"?, "error"? }

No Realtime progress in MVP — re-add later if the UI needs it.

Startup requires pose + shuttle TensorRT engines on disk unless
ALLOW_MISSING_MODELS=1 (CI). There is no PyTorch /.pt fallback — missing or
bad engines fail the job. This image always needs TRT on GPU routes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from callback import callback_allowed as _callback_url_allowed, post_callback
from detect import DetectConfig, VideoDetector
from io_util import safe_error_message
from job import JobFailed, run_preprocess_job
import detect_job


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("video-preprocess.server")

HOST = os.environ.get("MODEL_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))

_detector: VideoDetector | None = None
# One GPU job at a time (matches PyWorker allow_parallel_requests=False).
_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu-job")
_JOB_BUSY = threading.Lock()


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
    # Exact MODEL_LOG prefix for PyWorker on_load (MODEL_LOAD_LOG_MSG).
    print("VideoDetector loaded", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern FastAPI lifespan: load models on startup (fail-hard unless allowed)."""
    await _load_models()
    yield


app = FastAPI(title="video-preprocess", lifespan=lifespan)


class _HoldUntilDone(StreamingResponse):
    """Chunked JSON 202; keep the ASGI handler alive until the job future ends.

    Starlette's StreamingResponse (ASGI spec < 2.4, including uvicorn 2.3)
    cancels the stream on http.disconnect. Re-iterating body_iterator after
    send() fails aclose()s the generator and does not wait for the job.
    Await the thread-pool future (shielded) so load stays non-zero until
    run_and_report finishes.
    """

    def __init__(self, content, *, done, request_id=None, **kwargs):
        super().__init__(content, **kwargs)
        self._done = done
        self._request_id = request_id

    async def _await_job(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            try:
                await asyncio.shield(asyncio.wrap_future(self._done, loop=loop))
                return
            except asyncio.CancelledError:
                task = asyncio.current_task()
                if task is not None and hasattr(task, "uncancel"):
                    task.uncancel()
                if self._done.done():
                    return
            except Exception as e:  # noqa: BLE001
                log.error(
                    "job(failed): request_id=%s error=%s",
                    self._request_id,
                    safe_error_message(e),
                )
                return

    async def __call__(self, scope, receive, send) -> None:  # noqa: ARG002
        try:
            await self.stream_response(send)
        except Exception:  # noqa: BLE001
            pass
        except asyncio.CancelledError:
            task = asyncio.current_task()
            if task is not None and hasattr(task, "uncancel"):
                task.uncancel()
        await self._await_job()
        if self.background is not None:
            await self.background()


async def submit_and_hold(
    request_id,
    run_and_report: Callable[[], dict],
) -> Response:
    """202 + hold the connection. 429 immediately if a GPU job is already running."""
    if not _JOB_BUSY.acquire(blocking=False):
        return JSONResponse(
            {"request_id": request_id, "error": "gpu busy"},
            status_code=429,
        )
    running = threading.Event()

    def _entry() -> dict:
        running.set()
        try:
            return run_and_report()
        finally:
            _JOB_BUSY.release()

    try:
        future = _JOB_EXECUTOR.submit(_entry)
    except BaseException:
        _JOB_BUSY.release()
        raise
    await asyncio.to_thread(running.wait)
    payload = json.dumps({"request_id": request_id}).encode("utf-8")

    async def _hold_until_done():
        yield payload
        try:
            await asyncio.wrap_future(future)
        except Exception:
            pass

    return _HoldUntilDone(
        _hold_until_done(),
        done=future,
        request_id=request_id,
        status_code=202,
        media_type="application/json",
    )


def _unwrap_body(body: dict) -> dict:
    if "input_url" not in body and isinstance(body.get("input"), dict):
        return body["input"]
    return body


@app.get("/health")
async def health() -> JSONResponse:
    if _detector is None:
        return JSONResponse(
            {"status": "not_ready", "models_loaded": False},
            status_code=503,
        )
    return JSONResponse({"status": "ok", "models_loaded": True})


@app.post("/benchmark/ping")
async def benchmark_ping() -> JSONResponse:
    """HTTP 200 for PyWorker capacity probe. GPU routes are 202 and are not a benchmark."""
    return JSONResponse({"ok": True})


@app.post("/preprocess/sync")
async def preprocess_sync(request: Request) -> Response:
    body = _unwrap_body(await request.json())

    rid = body.get("request_id")
    cb_url, cb_tok = body.get("callback_url"), body.get("callback_token")
    has_local = bool(body.get("local_output_dir") or body.get("local_source"))

    if cb_url and has_local:
        return JSONResponse(
            {
                "request_id": rid,
                "error": "local_source/local_output_dir cannot be used with callback_url",
            },
            status_code=422,
        )
    if body.get("annotation") is None:
        missing = ["annotation"]
    elif body.get("local_output_dir"):
        missing = []
        if not body.get("local_source") and not body.get("input_url"):
            missing.append("input_url or local_source")
    else:
        missing = [
            k for k in (
                "input_url",
                "output_upload",
                "thumbnail_upload_url",
                "preprocess_log_upload_url",
            )
            if body.get(k) is None or body.get(k) == ""
        ]
    if missing:
        return JSONResponse(
            {
                "request_id": rid,
                "error": f"missing required fields: {', '.join(missing)}",
            },
            status_code=422,
        )
    if not has_local and not body.get("detections_upload_url"):
        return JSONResponse(
            {"request_id": rid, "error": "detections_upload_url is required"},
            status_code=422,
        )
    if cb_url and not _callback_url_allowed(cb_url):
        return JSONResponse(
            {"request_id": rid, "error": "callback_url not allowed"},
            status_code=422,
        )
    if _detector is None:
        return JSONResponse(
            {"request_id": rid, "error": "models not loaded"},
            status_code=503,
        )

    def run_and_report() -> dict:
        try:
            result = run_preprocess_job(body, detector=_detector)
        except Exception as e:
            err = safe_error_message(e)
            log.error("preprocess(failed): request_id=%s error=%s", rid, err)
            if cb_url:
                payload = {"request_id": rid, "status": "failed", "error": err}
                if isinstance(e, JobFailed):
                    for k in ("duration", "width", "height", "fps"):
                        if e.extra.get(k) is not None:
                            payload[k] = e.extra[k]
                post_callback(cb_url, cb_tok, payload)
            raise RuntimeError(err) from None
        if cb_url:
            post_callback(
                cb_url,
                cb_tok,
                {**result, "request_id": rid, "status": "success"},
            )
        return result

    return await submit_and_hold(rid, run_and_report)


@app.post("/detect/sync")
async def detect_sync(request: Request) -> Response:
    body = _unwrap_body(await request.json())

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

    def run_and_report() -> dict:
        try:
            result = detect_job.run_detect_job(body, _detector)
        except Exception as e:
            err = safe_error_message(e)
            log.error("detect(failed): request_id=%s error=%s", request_id, err)
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
            raise RuntimeError(err) from None
        if callback_url:
            post_callback(
                callback_url,
                callback_token,
                {
                    "request_id": request_id,
                    "status": "success",
                    **result,
                },
            )
        return result

    return await submit_and_hold(request_id, run_and_report)


if __name__ == "__main__":
    import uvicorn  # runtime only — keep import server CPU-safe for CI/tests

    log.info("startup: listening on %s:%s", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
