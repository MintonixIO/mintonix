"""Backend model server for the video-det PyWorker.

Mirrors workers/vast/video-normalization/server.py: this is the HTTP service the
vast.ai PyWorker proxies to. It does the work; worker.py only reports load.

Contract (request_parser unwraps {"input": {...}}; this server also accepts a
still-wrapped body):

    POST /detect/sync
        {
          "request_id": "...",                 # job_id
          "input_url": "...",                  # presigned GET or file://
          "output_upload_url": "...",          # presigned PUT or file:// for detections.json
          "callback_url": "...",               # jobs/callback
          "callback_token": "...",             # Bearer token (HMAC JWT)
          # optional: SlimSAM label mask PNG (0=bg, 1..N=player) for ReID seeds
          "player_mask_url": "..."
        }
      -> 200 { "request_id", "frame_count", "elapsed_sec" }
      -> 422 / 500 { "request_id", "error" }

    GET /health -> 200 { "status": "ok", "models_loaded": bool }

Callback (from the job thread, Authorization: Bearer <callback_token>):
    { "request_id", "status": "success"|"failed", "frame_count"?, "error"? }

No Realtime progress in MVP — re-add later if the UI needs a progress bar.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path

import cv2
import uvicorn
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from detect import DetectConfig, VideoDetector
from io_util import download, post_callback, upload_file

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("video-det.server")

HOST = os.environ.get("MODEL_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))

app = FastAPI(title="video-det")
_detector: VideoDetector | None = None
_config: DetectConfig | None = None


@app.on_event("startup")
async def _load_models() -> None:
    """Load models when engines exist; CI/smoke can start without weights."""
    global _detector, _config
    cfg = DetectConfig.from_env()
    _config = cfg
    if not cfg.pose_engine.is_file() or not cfg.shuttle_ckpt.is_file():
        log.warning(
            "startup: models missing (pose=%s shuttle=%s) — /health ok, jobs will fail",
            cfg.pose_engine,
            cfg.shuttle_ckpt,
        )
        return
    if cfg.reid_engine is None:
        log.warning(
            "startup: ReID engine missing — player_id will be null (check REID_ENGINE)"
        )
    _detector = VideoDetector.from_config(cfg)
    log.info(
        "startup: VideoDetector loaded (pose_feed=%s reid=%s conf=%s)",
        cfg.pose_feed,
        cfg.reid_engine is not None,
        cfg.conf,
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "models_loaded": _detector is not None}


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
    player_mask_url = body.get("player_mask_url")

    if not input_url or not output_upload_url:
        return JSONResponse(
            {
                "request_id": request_id,
                "error": "input_url and output_upload_url are required",
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
                player_mask_url=player_mask_url,
            )
        except Exception as e:
            if callback_url:
                post_callback(
                    callback_url,
                    callback_token,
                    {
                        "request_id": request_id,
                        "status": "failed",
                        "error": str(e),
                    },
                )
            raise
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

    try:
        result = await run_in_threadpool(run_and_report)
        return JSONResponse({"request_id": request_id, **result})
    except Exception as e:  # noqa: BLE001
        log.exception("detect(failed): request_id=%s", request_id)
        return JSONResponse(
            {"request_id": request_id, "error": str(e)},
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
    player_mask_url: str | None,
) -> dict:
    assert _detector is not None
    t0 = time.monotonic()

    video_fd, video_name = tempfile.mkstemp(suffix=".mp4")
    os.close(video_fd)
    video_tmp = Path(video_name)
    json_fd, json_name = tempfile.mkstemp(suffix=".json")
    os.close(json_fd)
    json_tmp = Path(json_name)
    mask_tmp: Path | None = None

    try:
        download(input_url, video_tmp)

        player_mask = None
        if player_mask_url:
            mask_fd, mask_name = tempfile.mkstemp(suffix=".png")
            os.close(mask_fd)
            mask_tmp = Path(mask_name)
            download(player_mask_url, mask_tmp)
            player_mask = cv2.imread(str(mask_tmp), cv2.IMREAD_GRAYSCALE)

        frame_count = _stream_detections_json(
            json_tmp, request_id=request_id, video_path=video_tmp, player_mask=player_mask
        )
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
        if mask_tmp is not None:
            mask_tmp.unlink(missing_ok=True)


def _stream_detections_json(
    dest: Path,
    *,
    request_id: str | None,
    video_path: Path,
    player_mask,
) -> int:
    """Write detections.json incrementally so long matches stay memory-bounded."""
    assert _detector is not None
    frame_count = 0
    first = True
    with dest.open("w", encoding="utf-8") as f:
        f.write('{"job_id":')
        f.write(json.dumps(request_id))
        f.write(',"frames":[')
        for chunk_results, _done, _total in _detector.run(
            video_path, player_mask=player_mask
        ):
            for fr in chunk_results:
                if not first:
                    f.write(",")
                f.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                first = False
                frame_count += 1
        f.write("]}")
    return frame_count


if __name__ == "__main__":
    log.info("startup: listening on %s:%s", HOST, PORT)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
