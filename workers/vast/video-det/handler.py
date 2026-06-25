import asyncio
import json
import tempfile
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI

from broadcast import Broadcaster
from detect import VideoDetector

app = FastAPI()
_detector: VideoDetector | None = None

_POSE_ENGINE = Path("/app/models/yolo26x_pose_int8.engine")
_SHUTTLE_CKPT = Path("/app/models/tracknetv5.pt")


@app.on_event("startup")
async def _load_models() -> None:
    global _detector
    _detector = VideoDetector(pose_engine=_POSE_ENGINE, shuttle_ckpt=_SHUTTLE_CKPT)


@app.post("/process-video")
async def process_video(payload: dict, bg: BackgroundTasks):
    bg.add_task(_run, payload)
    return {"status": "accepted"}


# ---------------------------------------------------------------------------
# Background job
# ---------------------------------------------------------------------------

async def _run(payload: dict) -> None:
    job_id = payload["job_id"]
    broadcaster = Broadcaster(
        supabase_url=payload["supabase_url"],
        anon_key=payload["supabase_anon_key"],
        channel=payload["realtime_channel"],
    )

    tmp = Path(tempfile.mktemp(suffix=".mp4"))
    try:
        await _download(payload["input_url"], tmp)
        all_results = await _detect(tmp, broadcaster)
        tmp.unlink(missing_ok=True)
        await _upload(payload["output_url"], job_id, all_results)
        out_path = f"jobs/{job_id}/result.json"
        await _callback(payload["callback_url"], {
            "job_token": payload["job_token"],
            "status": "complete",
            "output_b2_path": out_path,
        })
        await broadcaster.send_final("complete", output_b2_path=out_path)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        err = str(exc)
        await _callback(payload["callback_url"], {
            "job_token": payload["job_token"],
            "status": "failed",
            "error": err,
        })
        await broadcaster.send_final("failed", error=err)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _download(url: str, dest: Path) -> None:
    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            with dest.open("wb") as f:
                async for chunk in r.aiter_bytes(65536):
                    f.write(chunk)


async def _detect(video_path: Path, broadcaster: Broadcaster) -> list:
    """Run detection in a thread, yielding control between chunks for broadcasts."""
    sentinel = object()
    gen = _detector.run(video_path)
    all_results: list = []

    while True:
        # next() runs GPU inference for one 48-frame chunk without blocking the event loop
        item = await asyncio.to_thread(next, gen, sentinel)
        if item is sentinel:
            break
        chunk_results, frames_done, frames_total = item
        all_results.extend(chunk_results)
        await broadcaster.send_progress(
            progress=frames_done / frames_total,
            frames_done=frames_done,
            frames_total=frames_total,
            detections=[r.to_dict() for r in chunk_results[-3:]],
        )

    return all_results


async def _upload(url: str, job_id: str, results: list) -> None:
    body = json.dumps({"job_id": job_id, "frames": [r.to_dict() for r in results]}).encode()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.put(url, content=body, headers={"Content-Type": "application/json"})
        r.raise_for_status()


async def _callback(url: str, body: dict) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        await client.post(url, json=body)
