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

from vastai import Worker, WorkerConfig, HandlerConfig, LogActionConfig

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
            # NOTE: no BenchmarkConfig. The vast examples attach one so the
            # autoscaler can measure per-worker capacity at startup; without it,
            # scaling falls back to the fixed workload weight above and may be
            # less precise. Add one (with a small hosted sample clip) once an
            # endpoint is live and we can measure a representative job.
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
