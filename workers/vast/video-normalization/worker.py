"""Vast.ai PyWorker for the video-normalization endpoint.

A PyWorker is a thin HTTP proxy that the vast.ai serverless autoscaler runs in
front of a backend "model server" (here: server.py / FastAPI on 127.0.0.1).
It does NOT do the work itself — it forwards requests to the backend, reports
per-request load to the autoscaler, and signals readiness by watching the
backend's log for an on_load line.

The PyWorker framework ships in the `vastai-sdk` package, which vast's
start_server.sh installs on serverless instances before running this file as
`python3 -m worker`.

Request envelope (the SDK delivers {"input": {...}}; request_parser unwraps it):
    { "input": { "input_url": "...", "output_upload_url": "...",
                 "request_id": "..." } }
"""

import os
import uuid

import aiohttp.web

from vastai import Worker, WorkerConfig, HandlerConfig, LogActionConfig, BenchmarkConfig

# The SDK hardcodes AppRunner(handler_cancellation=True), so a client that
# disconnects mid-request cancels the in-flight handler. Our dispatcher is a
# Supabase edge function whose fetch dies at the runtime's wall clock (~150s),
# while a normalize job runs for many minutes: on disconnect the job itself
# survives (server.py runs it in a thread and reports via /jobs/callback), but
# the cancel zeroes this PyWorker's reported load and the autoscaler then stops
# the instance mid-transcode (observed live: instance killed at 21% ffmpeg).
# The HTTP response is disposable in our protocol — the request must stay
# alive purely so the load accounting keeps the instance alive until the job
# finishes. Force handler_cancellation off.


class _DetachedAppRunner(aiohttp.web.AppRunner):
    def __init__(self, app, **kwargs):
        kwargs["handler_cancellation"] = False
        super().__init__(app, **kwargs)


aiohttp.web.AppRunner = _DetachedAppRunner

# Backend model server (server.py). Must match MODEL_SERVER_HOST/PORT there.
MODEL_SERVER_URL = os.environ.get("MODEL_SERVER_URL", "http://127.0.0.1")
MODEL_SERVER_PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))
MODEL_LOG_FILE = os.environ.get("MODEL_LOG", "/var/log/portal/video-normalization.log")
MODEL_HEALTHCHECK_ENDPOINT = "/health"

# uvicorn prints this once the FastAPI app is serving; that's our readiness gate.
MODEL_LOAD_LOG_MSG = ["Application startup complete."]
MODEL_ERROR_LOG_MSGS = [
    "Traceback (most recent call last):",
    "ERROR:    Application startup failed.",
]
MODEL_INFO_LOG_MSGS = ['"download(start)', "ffmpeg(command)"]

# One 4K60 normalization saturates a single GPU's NVDEC decode engine (see
# FINDINGS.md: the workload is decode-bound). Packing a second job onto the same
# GPU yields ~no extra throughput on a 4090 and only ~2x on a 5080, so we keep a
# worker to one job at a time and let the autoscaler add GPUs for parallelism.
ALLOW_PARALLEL = False

# A long, roughly fixed-cost job. The autoscaler uses this as the per-request
# load weight; a large constant keeps it from over-packing a busy worker.
NORMALIZE_WORKLOAD = 10000.0


def request_parser(request: dict) -> dict:
    """Unwrap the {"input": {...}} envelope the autoscaler delivers."""
    if request.get("input") is not None:
        return request["input"]
    return request


# The autoscaler runs this at startup to measure a worker's capacity. It must
# produce a real, runnable job. We use the sample clip baked into the image
# (/app/sample.mov) as input and a throwaway local file as output, so the
# benchmark is self-contained — no external hosting or upload target needed.
# Each call gets a unique output path so concurrent benchmark runs don't clobber.
BENCHMARK_INPUT_URL = os.environ.get("BENCHMARK_INPUT_URL", "file:///app/sample.mov")


def benchmark_generator() -> dict:
    return {
        "input_url": BENCHMARK_INPUT_URL,
        "output_upload_url": f"file:///tmp/benchmark_{uuid.uuid4().hex}.mp4",
        "request_id": "benchmark",
    }


worker_config = WorkerConfig(
    model_server_url=MODEL_SERVER_URL,
    model_server_port=MODEL_SERVER_PORT,
    model_log_file=MODEL_LOG_FILE,
    model_healthcheck_url=MODEL_HEALTHCHECK_ENDPOINT,
    handlers=[
        HandlerConfig(
            route="/normalize/sync",
            workload_calculator=lambda _data: NORMALIZE_WORKLOAD,
            allow_parallel_requests=ALLOW_PARALLEL,
            request_parser=request_parser,
            # A 4K60 master can run minutes; give the autoscaler room to spin up
            # a worker before a queued request times out.
            max_queue_time=900.0,
            # Required by the SDK (Worker() raises "Missing EndpointHandler with
            # BenchmarkConfig" without it). concurrency=1 because the workload is
            # decode-bound — one job saturates a GPU's NVDEC, so measuring with a
            # single in-flight job reflects real per-worker capacity.
            benchmark_config=BenchmarkConfig(
                generator=benchmark_generator,
                concurrency=1,
                runs=2,
            ),
        ),
    ],
    log_action_config=LogActionConfig(
        on_load=MODEL_LOAD_LOG_MSG,
        on_error=MODEL_ERROR_LOG_MSGS,
        on_info=MODEL_INFO_LOG_MSGS,
    ),
)

if __name__ == "__main__":
    Worker(worker_config).run()
