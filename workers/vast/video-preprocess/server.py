"""FastAPI model server: /health + /preprocess/sync."""

from __future__ import annotations

import logging
import os

import uvicorn
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import callback
from io_util import sanitize_error
from job import run_preprocess_job

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("video-preprocess")

app = FastAPI(title="video-preprocess")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/preprocess/sync")
async def preprocess_sync(request: Request) -> JSONResponse:
    body = await request.json()
    if "input_url" not in body and isinstance(body.get("input"), dict):
        body = body["input"]

    rid = body.get("request_id")
    cb_url, cb_tok = body.get("callback_url"), body.get("callback_token")

    if not body.get("input_url") or not (
        body.get("output_upload_url") or body.get("output_upload")
    ):
        return JSONResponse(
            {"request_id": rid, "error": "input_url and output destination required"},
            status_code=422,
        )
    if cb_url and not callback.callback_allowed(cb_url):
        return JSONResponse(
            {"request_id": rid, "error": "callback_url not allowed"},
            status_code=422,
        )

    def run() -> dict:
        try:
            result = run_preprocess_job(body)
        except Exception as e:
            if cb_url:
                callback.post_callback(cb_url, cb_tok, {
                    "request_id": rid, "status": "failed",
                    "error": sanitize_error(e),
                })
            raise
        if cb_url:
            # Wire status must be success|failed for jobs/callback.
            # Job result uses status "ok" — put wire status after **result.
            callback.post_callback(cb_url, cb_tok, {
                **result, "request_id": rid, "status": "success",
            })
        return result

    try:
        result = await run_in_threadpool(run)
        return JSONResponse({"request_id": rid, **result})
    except Exception as e:  # noqa: BLE001
        log.exception("preprocess failed")
        return JSONResponse(
            {"request_id": rid, "error": sanitize_error(e)}, status_code=500,
        )


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("MODEL_SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("MODEL_SERVER_PORT", "18000")),
        log_level="info",
    )
