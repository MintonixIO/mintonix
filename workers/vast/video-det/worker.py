"""Vast.ai PyWorker for the video-det endpoint (scaffolding).

Mirrors workers/vast/video-normalization/worker.py — the deployed, working
reference for the vastai-sdk PyWorker API. The detect stage is not wired into
the pipeline's STAGES table yet: this module stays importable and API-correct
(CI smoke-tests `import worker` against the installed SDK, which is how the
previous hand-imagined config here was caught), but the runtime wiring — an
entrypoint that launches handler:app, downloads model weights, and bakes a
benchmark sample — lands together with the detect stage contract.
"""

import os
import uuid

import aiohttp.web

from vastai import Worker, WorkerConfig, HandlerConfig, LogActionConfig, BenchmarkConfig

# Same patch as the normalization worker (see its comment for the live failure
# it fixes): the SDK's AppRunner(handler_cancellation=True) turns a dispatcher
# disconnect into a request cancel, which zeroes reported load and lets the
# autoscaler stop the instance while the job is still running. Jobs report via
# callback; the HTTP response is disposable — keep the request (and the load
# accounting) alive until the job finishes.


class _DetachedAppRunner(aiohttp.web.AppRunner):
    def __init__(self, app, **kwargs):
        kwargs["handler_cancellation"] = False
        super().__init__(app, **kwargs)


aiohttp.web.AppRunner = _DetachedAppRunner

# Backend model server (handler.py / FastAPI). Must match how the entrypoint
# launches it once the detect stage is wired up.
MODEL_SERVER_URL = os.environ.get("MODEL_SERVER_URL", "http://127.0.0.1")
MODEL_SERVER_PORT = int(os.environ.get("MODEL_SERVER_PORT", "8080"))
MODEL_LOG_FILE = os.environ.get("MODEL_LOG", "/var/log/portal/video-det.log")
MODEL_HEALTHCHECK_ENDPOINT = "/health"

# uvicorn prints this once the FastAPI app is serving; that's our readiness gate.
MODEL_LOAD_LOG_MSG = ["Application startup complete."]
MODEL_ERROR_LOG_MSGS = [
    "Traceback (most recent call last):",
    "ERROR:    Application startup failed.",
]

# Detection runs one video per GPU at a time (TensorRT engine + TrackNet share
# the device); parallelism comes from the autoscaler adding workers.
ALLOW_PARALLEL = False
DETECT_WORKLOAD = 10000.0


def request_parser(request: dict) -> dict:
    """Unwrap the {"input": {...}} envelope the autoscaler delivers."""
    if request.get("input") is not None:
        return request["input"]
    return request


def benchmark_generator() -> dict:
    # Placeholder until a sample clip + engines are baked into the image: on a
    # real vast instance this benchmark fails fast, which is what we want while
    # the worker is scaffolding — the autoscaler discards the host instead of
    # routing real jobs to an unproven image.
    return {
        "input_url": os.environ.get("BENCHMARK_INPUT_URL", "file:///app/sample.mp4"),
        "output_url": f"file:///tmp/benchmark_{uuid.uuid4().hex}.json",
        "job_id": "benchmark",
    }


worker_config = WorkerConfig(
    model_server_url=MODEL_SERVER_URL,
    model_server_port=MODEL_SERVER_PORT,
    model_log_file=MODEL_LOG_FILE,
    model_healthcheck_url=MODEL_HEALTHCHECK_ENDPOINT,
    handlers=[
        HandlerConfig(
            route="/process-video",
            workload_calculator=lambda _data: DETECT_WORKLOAD,
            allow_parallel_requests=ALLOW_PARALLEL,
            request_parser=request_parser,
            max_queue_time=900.0,
            # Required by the SDK (Worker() raises without it).
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
