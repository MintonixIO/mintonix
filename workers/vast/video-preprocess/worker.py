"""Vast.ai PyWorker for video-preprocess (normalize + detect)."""

import os

import aiohttp.web

# Import the serverless classes from the submodule. `from vastai import
# BenchmarkConfig` can bind None: vastai/__init__.py swallows any ImportError
# in that try-block (missing distutils, aiohttp, …) and sets the names to None.
from vastai.serverless.server.worker import (
    BenchmarkConfig,
    HandlerConfig,
    LogActionConfig,
    Worker,
    WorkerConfig,
)

# SDK AppRunner(handler_cancellation=True)
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
MODEL_LOG_FILE = os.environ.get("MODEL_LOG", "/var/log/portal/video-preprocess.log")
MODEL_HEALTHCHECK_ENDPOINT = "/health"

# Gate on TRT load, not uvicorn's "Application startup complete." (that can
# fire before engines are ready). PyWorker then benchmarks — see ping below.
MODEL_LOAD_LOG_MSG = ["VideoDetector loaded"]
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


def ping_benchmark_generator() -> dict:
    # PyWorker treats only HTTP 200 as a successful benchmark. GPU routes
    # return 202. Ping is 200 and does not start GPU work.
    return {"ping": True}


worker_config = WorkerConfig(
    model_server_url=MODEL_SERVER_URL,
    model_server_port=MODEL_SERVER_PORT,
    model_log_file=MODEL_LOG_FILE,
    model_healthcheck_url=MODEL_HEALTHCHECK_ENDPOINT,
    handlers=[
        HandlerConfig(
            route="/preprocess/sync",
            workload_calculator=lambda _data: DETECT_WORKLOAD,
            allow_parallel_requests=ALLOW_PARALLEL,
            request_parser=request_parser,
            max_queue_time=900.0,
        ),
        HandlerConfig(
            route="/detect/sync",
            workload_calculator=lambda _data: DETECT_WORKLOAD,
            allow_parallel_requests=ALLOW_PARALLEL,
            request_parser=request_parser,
            max_queue_time=900.0,
        ),
        HandlerConfig(
            route="/benchmark/ping",
            workload_calculator=lambda _data: 1.0,
            allow_parallel_requests=True,
            request_parser=request_parser,
            max_queue_time=0.0,
            benchmark_config=BenchmarkConfig(
                generator=ping_benchmark_generator,
                concurrency=1,
                runs=1,
                do_warmup=False,
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
