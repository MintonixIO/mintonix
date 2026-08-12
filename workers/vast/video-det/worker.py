"""Vast.ai PyWorker for the video-det endpoint.

Mirrors workers/vast/video-preprocess/worker.py — thin HTTP proxy the
autoscaler runs in front of the backend model server (server.py). Does not do
detection itself.

Request envelope (SDK delivers {"input": {...}}; request_parser unwraps it):
    { "input": { "input_url": "...", "output_upload_url": "...",
                 "request_id": "...", "callback_url": "...",
                 "callback_token": "..." } }
"""

import os
import uuid

import aiohttp.web

from vastai import Worker, WorkerConfig, HandlerConfig, LogActionConfig, BenchmarkConfig

# Same patch as the video-preprocess worker: SDK AppRunner(handler_cancellation=True)
# turns a dispatcher disconnect into a cancel, which zeroes reported load and
# lets the autoscaler stop the instance mid-job. Jobs report via callback; keep
# the request (and load accounting) alive until the job finishes.


class _DetachedAppRunner(aiohttp.web.AppRunner):
    def __init__(self, app, **kwargs):
        kwargs["handler_cancellation"] = False
        super().__init__(app, **kwargs)


aiohttp.web.AppRunner = _DetachedAppRunner

MODEL_SERVER_URL = os.environ.get("MODEL_SERVER_URL", "http://127.0.0.1")
MODEL_SERVER_PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))
MODEL_LOG_FILE = os.environ.get("MODEL_LOG", "/var/log/portal/video-det.log")
MODEL_HEALTHCHECK_ENDPOINT = "/health"

# uvicorn prints this once the FastAPI app is serving; readiness gate.
MODEL_LOAD_LOG_MSG = ["Application startup complete."]
MODEL_ERROR_LOG_MSGS = [
    "Traceback (most recent call last):",
    "ERROR:    Application startup failed.",
]

# One video per GPU (pose TRT + TrackNet share the device).
ALLOW_PARALLEL = False
DETECT_WORKLOAD = 10000.0


def request_parser(request: dict) -> dict:
    """Unwrap the {"input": {...}} envelope the autoscaler delivers."""
    if request.get("input") is not None:
        return request["input"]
    return request


def benchmark_generator() -> dict:
    # Self-contained local paths so the autoscaler can measure capacity without
    # external hosting. Fails fast if sample/engines are missing — preferred
    # over routing real jobs to an unproven image.
    return {
        "input_url": os.environ.get("BENCHMARK_INPUT_URL", "file:///app/sample.mp4"),
        "output_upload_url": f"file:///tmp/benchmark_{uuid.uuid4().hex}.json",
        "request_id": "benchmark",
    }


worker_config = WorkerConfig(
    model_server_url=MODEL_SERVER_URL,
    model_server_port=MODEL_SERVER_PORT,
    model_log_file=MODEL_LOG_FILE,
    model_healthcheck_url=MODEL_HEALTHCHECK_ENDPOINT,
    handlers=[
        HandlerConfig(
            route="/detect/sync",
            workload_calculator=lambda _data: DETECT_WORKLOAD,
            allow_parallel_requests=ALLOW_PARALLEL,
            request_parser=request_parser,
            max_queue_time=900.0,
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
    ),
)

if __name__ == "__main__":
    Worker(worker_config).run()
