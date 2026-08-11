"""Vast PyWorker: proxy /preprocess/sync → local model server."""

from __future__ import annotations

import os
import uuid

import aiohttp.web
from vastai import (
    BenchmarkConfig,
    HandlerConfig,
    LogActionConfig,
    Worker,
    WorkerConfig,
)


class _DetachedAppRunner(aiohttp.web.AppRunner):
    """Do not cancel long jobs when the client disconnects."""

    def __init__(self, app, **kwargs):
        kwargs["handler_cancellation"] = False
        super().__init__(app, **kwargs)


aiohttp.web.AppRunner = _DetachedAppRunner

PORT = int(os.environ.get("MODEL_SERVER_PORT", "18000"))
LOG = os.environ.get("MODEL_LOG", "/var/log/portal/video-preprocess.log")


def request_parser(request: dict) -> dict:
    return request["input"] if request.get("input") is not None else request


def benchmark_generator() -> dict:
    # Local paths only (no file://, no callback). Sample at /app/sample.mp4.
    # Path mode is user when input_url is omitted.
    out = f"/tmp/benchmark_{uuid.uuid4().hex}"
    os.makedirs(out, exist_ok=True)
    sample = os.environ.get("BENCHMARK_LOCAL_SOURCE", "/app/sample.mp4")
    return {
        "request_id": "benchmark",
        "local_source": sample,
        "local_output_dir": out,
        "annotation": {
            "court": {
                "corners": [[0, 0], [100, 0], [100, 100], [0, 100]],
                "net_poles": [[40, 40], [60, 40]],
            },
        },
    }


worker_config = WorkerConfig(
    model_server_url="http://127.0.0.1",
    model_server_port=PORT,
    model_log_file=LOG,
    model_healthcheck_url="/health",
    handlers=[
        HandlerConfig(
            route="/preprocess/sync",
            workload_calculator=lambda _: 100.0,
            allow_parallel_requests=False,
            request_parser=request_parser,
            max_queue_time=900.0,
            benchmark_config=BenchmarkConfig(
                generator=benchmark_generator, concurrency=1, runs=1,
            ),
        ),
    ],
    log_action_config=LogActionConfig(
        on_load=["Application startup complete."],
        on_error=["Traceback (most recent call last):"],
    ),
)

if __name__ == "__main__":
    Worker(worker_config).run()
