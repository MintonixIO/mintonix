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
    return {
        "request_id": "benchmark",
        "input_url": os.environ.get("BENCHMARK_INPUT_URL", "file:///app/sample.mp4"),
        "output_upload_url": f"file:///tmp/benchmark_{uuid.uuid4().hex}.mp4",
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
