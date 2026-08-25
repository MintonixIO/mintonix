"""CPU-safe server / worker / product-import contract tests."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

from detect.types import FrameResult, ShuttleCandidate


class TestWorkerConfigImport(unittest.TestCase):
    def test_request_parser(self) -> None:
        import importlib.util

        path = Path(__file__).resolve().parent / "worker.py"
        try:
            import vastai  # noqa: F401
        except ImportError:
            self.skipTest("vastai-sdk not installed")
        spec = importlib.util.spec_from_file_location("video_det_worker", path)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(
            callable(mod.BenchmarkConfig),
            "BenchmarkConfig is None — vastai swallowed an ImportError "
            "(slim images need python3-setuptools for distutils.util.strtobool)",
        )
        inner = {"input_url": "x", "request_id": "j1"}
        self.assertEqual(mod.request_parser({"input": inner}), inner)
        self.assertEqual(mod.request_parser(inner), inner)

        bench = mod.benchmark_generator()
        self.assertTrue(bench["input_url"].startswith("file://"))
        self.assertTrue(bench["output_upload_url"].startswith("file://"))


class TestServerHealthAndStartup(unittest.TestCase):
    def _import_server(self):
        """Import server without requiring uvicorn (lazy-imported only for __main__)."""
        try:
            import server as server_mod

            return server_mod
        except ImportError as e:
            self.skipTest(f"server deps missing: {e}")

    def test_server_import_does_not_need_uvicorn(self) -> None:
        path = Path(__file__).resolve().parent / "server.py"
        src = path.read_text(encoding="utf-8")
        for line in src.splitlines():
            stripped = line.strip()
            if stripped.startswith("import uvicorn") or stripped.startswith(
                "from uvicorn"
            ):
                if not line.startswith((" ", "\t")):
                    self.fail(f"top-level uvicorn import: {line!r}")

    def test_health_503_and_200(self) -> None:
        server_mod = self._import_server()

        async def _run():
            server_mod._detector = None
            r = await server_mod.health()
            self.assertEqual(r.status_code, 503)
            body = json.loads(r.body)
            self.assertEqual(body["status"], "not_ready")
            self.assertFalse(body["models_loaded"])

            server_mod._detector = MagicMock()
            r2 = await server_mod.health()
            self.assertEqual(r2.status_code, 200)
            body2 = json.loads(r2.body)
            self.assertEqual(body2["status"], "ok")
            self.assertTrue(body2["models_loaded"])
            server_mod._detector = None

        asyncio.run(_run())

    def test_detect_sync_503_when_models_missing(self) -> None:
        server_mod = self._import_server()
        try:
            from fastapi.testclient import TestClient
        except ImportError as e:
            self.skipTest(f"fastapi missing: {e}")

        prev_allow = os.environ.get("ALLOW_MISSING_MODELS")
        os.environ["ALLOW_MISSING_MODELS"] = "1"
        os.environ.setdefault("POSE_ENGINE", "/nonexistent/pose.engine")
        os.environ.setdefault("SHUTTLE_ENGINE", "/nonexistent/shuttle.engine")
        try:
            with TestClient(server_mod.app, raise_server_exceptions=False) as client:
                server_mod._detector = None
                r = client.post(
                    "/detect/sync",
                    json={
                        "request_id": "j1",
                        "input_url": "https://example/in",
                        "output_upload_url": "https://example/out",
                    },
                )
            self.assertEqual(r.status_code, 503)
            self.assertIn("models not loaded", r.json()["error"])
        finally:
            if prev_allow is None:
                os.environ.pop("ALLOW_MISSING_MODELS", None)
            else:
                os.environ["ALLOW_MISSING_MODELS"] = prev_allow
            server_mod._detector = None

    def test_allow_missing_models_startup(self) -> None:
        server_mod = self._import_server()

        async def _run():
            prev_pose = os.environ.get("POSE_ENGINE")
            prev_shuttle = os.environ.get("SHUTTLE_ENGINE")
            prev_allow = os.environ.get("ALLOW_MISSING_MODELS")
            os.environ["POSE_ENGINE"] = "/nonexistent/pose.engine"
            os.environ["SHUTTLE_ENGINE"] = "/nonexistent/shuttle.engine"
            try:
                os.environ["ALLOW_MISSING_MODELS"] = "1"
                server_mod._detector = None
                with patch.object(server_mod, "_assert_trt_loaded") as assert_trt:
                    await server_mod._load_models()
                    assert_trt.assert_called()
                self.assertIsNone(server_mod._detector)

                os.environ.pop("ALLOW_MISSING_MODELS", None)
                with patch.object(server_mod, "_assert_trt_loaded") as assert_trt:
                    with self.assertRaises(FileNotFoundError):
                        await server_mod._load_models()
                    assert_trt.assert_called()
            finally:
                for key, prev in (
                    ("POSE_ENGINE", prev_pose),
                    ("SHUTTLE_ENGINE", prev_shuttle),
                    ("ALLOW_MISSING_MODELS", prev_allow),
                ):
                    if prev is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = prev
                server_mod._detector = None

        asyncio.run(_run())

    def test_stream_detections_json(self) -> None:
        server_mod = self._import_server()

        frames = [
            FrameResult(frame=i, poses=[], shuttle=[ShuttleCandidate(0.1, 0.2, 0.3)])
            for i in range(2)
        ]

        class FakeDet:
            def run(self, video_path):
                yield frames

        server_mod._detector = FakeDet()  # type: ignore[assignment]
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "d.json"
            n = server_mod._stream_detections_json(
                dest,
                request_id="job-1",
                video_path=Path(td) / "v.mp4",
                segments=[
                    {
                        "start_frame": 0,
                        "end_frame": 1,
                        "score": {"t1": 5, "t2": 3},
                        "score_conf": 0.9,
                    }
                ],
                fps=30.0,
                width=1920,
                height=1080,
            )
            self.assertEqual(n, 2)
            body = json.loads(dest.read_text())
            self.assertEqual(body["job_id"], "job-1")
            self.assertEqual(body["fps"], 30.0)
            self.assertEqual(body["width"], 1920)
            self.assertEqual(body["height"], 1080)
            self.assertEqual(len(body["frames"]), 2)
            self.assertEqual(len(body["segments"]), 1)
            self.assertEqual(body["segments"][0]["score"], {"t1": 5, "t2": 3})
            self.assertEqual(len(body["rallies"]), 1)
            self.assertEqual(body["rallies"][0]["score"], {"t1": 5, "t2": 3})
        server_mod._detector = None

    def test_uses_lifespan_not_on_event(self) -> None:
        path = Path(__file__).resolve().parent / "server.py"
        src = path.read_text(encoding="utf-8")
        self.assertIn("lifespan", src)
        self.assertNotIn('@app.on_event("startup")', src)
        self.assertNotIn("@app.on_event('startup')", src)

    def test_lifespan_wired_on_app(self) -> None:
        server_mod = self._import_server()
        try:
            from fastapi.testclient import TestClient
        except ImportError as e:
            self.skipTest(f"fastapi missing: {e}")

        prev_allow = os.environ.get("ALLOW_MISSING_MODELS")
        os.environ["ALLOW_MISSING_MODELS"] = "1"
        os.environ.setdefault("POSE_ENGINE", "/nonexistent/pose.engine")
        os.environ.setdefault("SHUTTLE_ENGINE", "/nonexistent/shuttle.engine")
        try:
            self.assertTrue(callable(server_mod.lifespan))
            self.assertIsNotNone(server_mod.app.router.lifespan_context)
            with TestClient(server_mod.app, raise_server_exceptions=False) as client:
                r = client.get("/health")
                self.assertIn(r.status_code, (200, 503))
        finally:
            if prev_allow is None:
                os.environ.pop("ALLOW_MISSING_MODELS", None)
            else:
                os.environ["ALLOW_MISSING_MODELS"] = prev_allow
            server_mod._detector = None


class TestProductImports(unittest.TestCase):
    def test_detect_package_imports_without_cuda(self) -> None:
        import detect
        from detect import DetectConfig, VideoDetector, _chunk_size

        self.assertTrue(callable(VideoDetector))
        self.assertTrue(callable(DetectConfig.from_env))
        self.assertEqual(_chunk_size(16), 48)
        self.assertFalse(hasattr(detect, "run_ffmpeg_pose"))
        self.assertFalse(hasattr(detect, "run_opencv_pose"))
        self.assertIn("VideoDetector", detect.__all__)

    def test_no_reid_module(self) -> None:
        import importlib.util

        root = Path(__file__).resolve().parent
        self.assertIsNone(importlib.util.find_spec("detect.reid"))
        self.assertFalse((root / "detect" / "reid.py").exists())

    def test_no_pose_feed_module(self) -> None:
        import importlib.util

        root = Path(__file__).resolve().parent
        self.assertIsNone(
            importlib.util.find_spec("detect.pose_feed"),
            msg="detect.pose_feed should be removed from product",
        )
        self.assertFalse((root / "detect" / "pose_feed.py").exists())

    def test_product_modules_do_not_import_ffmpeg_bench(self) -> None:
        root = Path(__file__).resolve().parent
        banned = (
            "tools.ffmpeg_pose_bench",
            "ffmpeg_pose_bench",
            "ffmpeg_feed",
            "ring_consumer",
        )
        product_files = [
            root / "server.py",
            root / "worker.py",
            root / "io_util.py",
            root / "trt_io.py",
            *sorted((root / "detect").glob("*.py")),
            root / "pose" / "engine.py",
            root / "pose" / "__init__.py",
        ]
        for path in product_files:
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if not (
                    stripped.startswith("import ") or stripped.startswith("from ")
                ):
                    continue
                for token in banned:
                    if token in stripped:
                        self.fail(f"{path.name} imports research stack: {line}")

    def test_product_trt_runner_is_single_infer(self) -> None:
        """Product path exposes one-shot infer; no multi-K feed/ring API."""
        src = (
            Path(__file__).resolve().parent / "pose" / "trt_runtime.py"
        ).read_text(encoding="utf-8")
        self.assertIn("def infer(", src)
        self.assertNotIn("def feed(", src)
        self.assertNotIn("slot_in", src)
        self.assertNotIn("def stage_host(", src)
        self.assertNotIn("def run_gpu(", src)


class TestImageBootContract(unittest.TestCase):
    """Cold-start: baked venv + slim runtime, no stock start_server.sh."""

    def test_entrypoint_uses_prebuilt_venv_and_health_gate(self) -> None:
        root = Path(__file__).resolve().parent
        entry = (root / "entrypoint.sh").read_text(encoding="utf-8")
        self.assertNotIn("start_server.sh", entry)
        self.assertIn("/opt/worker-env", entry)
        self.assertIn("/health", entry)
        self.assertTrue((root / "entrypoint.sh").exists())
        self.assertFalse((root / "start_server.sh").exists())

    def test_dockerfile_is_runtime_multistage(self) -> None:
        src = (Path(__file__).resolve().parent / "Dockerfile").read_text(
            encoding="utf-8"
        )
        self.assertIn("AS trt", src)
        self.assertIn("nvcr.io/nvidia/tensorrt:25.01-py3", src)
        self.assertIn("nvidia/cuda:12.8.0-runtime-ubuntu24.04", src)
        self.assertIn("ENV_PATH=/opt/worker-env", src)
        self.assertIn("from distutils.util import strtobool", src)
        self.assertIn("libglib2.0-0t64", src)
        self.assertIn("builder_resource", src)
        self.assertNotIn('CMD ["bash", "start_server.sh"]', src)
        manifest = json.loads(
            (Path(__file__).resolve().parent / "models" / "MANIFEST.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertIn(
            f"EXPECTED_TRT_VERSION={manifest['trt_version']}",
            src,
        )

    def test_worker_env_pins_setuptools_for_distutils(self) -> None:
        root = Path(__file__).resolve().parent
        req = (root / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("setuptools", req)
        self.assertIn("<82", req)
        src = (root / "Dockerfile").read_text(encoding="utf-8")
        # Apt setuptools must not be the only distutils story — worker-env pip.
        self.assertIn("from distutils.util import strtobool", src)

    def _check_trt_mod(self):
        import importlib.util

        path = Path(__file__).resolve().parent / "tools" / "check_trt_runtime.py"
        spec = importlib.util.spec_from_file_location("check_trt_runtime", path)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_dockerfile_copies_nvinfer_via_ldd_or_realpath(self) -> None:
        src = (Path(__file__).resolve().parent / "Dockerfile").read_text(
            encoding="utf-8"
        )
        # Copy walk must resolve + ldd + follow real files (not a comment that
        # merely mentions "ldd" while still using symlink-only copy).
        self.assertIn("subprocess.check_output([\"ldd\", str(lib)]", src)
        self.assertIn("follow_symlinks=True", src)
        self.assertNotIn("follow_symlinks=False", src)
        self.assertIn(".resolve()", src)
        self.assertIn("skip_copied_lib", src)
        # Stubs exist for bake/CI import only; never ldconfig them.
        self.assertIn("/opt/cuda-stubs", src)
        ldconfig_lines = [
            ln for ln in src.splitlines() if "ld.so.conf" in ln or "ldconfig" in ln
        ]
        self.assertTrue(ldconfig_lines)
        for ln in ldconfig_lines:
            self.assertNotIn("cuda-stubs", ln)
            self.assertNotIn("libcuda.so", ln)

    def test_copy_denies_system_and_driver_libs(self) -> None:
        mod = self._check_trt_mod()
        for name in (
            "libc.so.6",
            "libm.so.6",
            "libdl.so.2",
            "libpthread.so.0",
            "librt.so.1",
            "libgcc_s.so.1",
            "libstdc++.so.6",
            "ld-linux-x86-64.so.2",
            "libcuda.so.1",
            "libnvidia-ml.so.1",
            "libnvinfer_builder_resource.so.10.8.0",
        ):
            self.assertTrue(mod.skip_copied_lib(name), name)
        for name in (
            "libnvinfer.so.10",
            "libnvinfer_plugin.so.10",
            "libnvonnxparser.so.10",
            "libnvparsers.so.10",
            "libcudnn.so.9",
            "libcublas.so.12",
            "libcublasLt.so.12",
            "libcudart.so.12",
            "libnvrtc.so.12",
            "libnvJitLink.so.12",
        ):
            self.assertFalse(mod.skip_copied_lib(name), name)

    def test_ldd_probe_allows_missing_driver_not_cublas(self) -> None:
        mod = self._check_trt_mod()
        driver_only = (
            "\tlibcuda.so.1 => not found\n"
            "\tlibnvidia-ml.so.1 => not found\n"
        )
        self.assertEqual(mod.unexpected_ldd_missing(driver_only), [])
        mixed = (
            "\tlibcublas.so.12 => not found\n"
            "\tlibcudnn.so.9 => not found\n"
            "\tlibcudart.so.12 => not found\n"
            "\tlibcuda.so.1 => not found\n"
        )
        unexpected = mod.unexpected_ldd_missing(mixed)
        joined = "\n".join(unexpected)
        self.assertIn("cublas", joined)
        self.assertIn("cudnn", joined)
        self.assertIn("cudart", joined)
        self.assertNotIn("libcuda.so", joined)
        self.assertNotIn("libnvidia-", joined)

    def test_assert_trt_loaded_rejects_zero_version(self) -> None:
        import importlib.util
        import sys
        import types

        def _load_server():
            try:
                import server as server_mod

                return server_mod
            except ImportError:
                pass
            fastapi = types.ModuleType("fastapi")

            class FastAPI:
                def __init__(self, *a, **k):
                    self.router = types.SimpleNamespace(lifespan_context=None)

                def get(self, *a, **k):
                    return lambda fn: fn

                def post(self, *a, **k):
                    return lambda fn: fn

            fastapi.FastAPI = FastAPI
            fastapi.Request = object
            conc = types.ModuleType("fastapi.concurrency")
            conc.run_in_threadpool = lambda *a, **k: None
            resp = types.ModuleType("fastapi.responses")

            class JSONResponse:
                def __init__(self, *a, **k):
                    pass

            class StreamingResponse:
                def __init__(self, *a, **k):
                    pass

            class Response:
                def __init__(self, *a, **k):
                    pass

            resp.JSONResponse = JSONResponse
            resp.StreamingResponse = StreamingResponse
            resp.Response = Response
            path = Path(__file__).resolve().parent / "server.py"
            spec = importlib.util.spec_from_file_location(
                "video_det_server_trt_contract", path
            )
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            with patch.dict(
                sys.modules,
                {
                    "fastapi": fastapi,
                    "fastapi.concurrency": conc,
                    "fastapi.responses": resp,
                },
            ):
                spec.loader.exec_module(mod)
            return mod

        server_mod = _load_server()
        fake = MagicMock()
        fake.__version__ = "0.0.0"
        with patch.dict(sys.modules, {"tensorrt": fake}):
            with self.assertRaises(RuntimeError) as ctx:
                server_mod._assert_trt_loaded()
            self.assertIn("native TensorRT not loaded", str(ctx.exception))
        try:
            import tensorrt as trt
        except ImportError:
            return
        ver = getattr(trt, "__version__", "") or ""
        if ver and not str(ver).startswith("0.0"):
            server_mod._assert_trt_loaded()


def _asgi_http_scope(payload: dict) -> tuple[dict, bytes]:
    body = json.dumps(payload).encode("utf-8")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/detect/sync",
        "raw_path": b"/detect/sync",
        "query_string": b"",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "root_path": "",
        "extensions": {},
        "state": {},
    }
    return scope, body


def _asgi_post_detect_sync(app, payload: dict, *, on_start, on_body) -> None:
    """Drive POST /detect/sync at the ASGI layer so 202 can be observed mid-job.

    Starlette TestClient buffers the full response (it waits for the ASGI
    handler to return), so it cannot see headers while the connection is held.
    """
    scope, body = _asgi_http_scope(payload)

    async def _run() -> None:
        sent_request = False

        async def receive():
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": body, "more_body": False}
            # Stay connected: uvicorn ASGI spec 2.3 cancels StreamingResponse
            # when it sees http.disconnect.
            await asyncio.Event().wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                on_start(message)
            elif message["type"] == "http.response.body":
                chunk = message.get("body") or b""
                if chunk:
                    on_body(chunk)

        await app(scope, receive, send)

    asyncio.run(_run())


def _asgi_post_detect_sync_disconnect_after_202(
    app, payload: dict, *, on_start, on_body
) -> None:
    """POST /detect/sync, then inject http.disconnect after the 202 JSON.

    Mirrors Starlette StreamingResponse on ASGI spec < 2.4 (uvicorn 2.3):
    disconnect cancels the in-flight stream task.
    """
    scope, body = _asgi_http_scope(payload)

    async def _run() -> None:
        sent_request = False
        disconnect = asyncio.Event()
        body_sent = asyncio.Event()

        async def receive():
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                on_start(message)
            elif message["type"] == "http.response.body":
                chunk = message.get("body") or b""
                if chunk:
                    on_body(chunk)
                    body_sent.set()

        task = asyncio.create_task(app(scope, receive, send))
        await asyncio.wait_for(body_sent.wait(), 2.0)
        disconnect.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())


class TestDetectSync202(unittest.TestCase):
    """POST /detect/sync returns 202 as soon as the job thread is running."""

    _VALID = {
        "request_id": "job-202",
        "input_url": "https://example/in",
        "output_upload_url": "https://example/out",
    }

    def _import_server(self):
        try:
            import server as server_mod

            return server_mod
        except ImportError as e:
            self.skipTest(f"server deps missing: {e}")

    @contextmanager
    def _client(self, *, detector: bool = True):
        server_mod = self._import_server()
        try:
            from fastapi.testclient import TestClient
        except ImportError as e:
            self.skipTest(f"fastapi missing: {e}")

        prev_allow = os.environ.get("ALLOW_MISSING_MODELS")
        prev_pose = os.environ.get("POSE_ENGINE")
        prev_shuttle = os.environ.get("SHUTTLE_ENGINE")
        prev_unsafe = os.environ.get("ALLOW_UNSAFE_CALLBACK")
        os.environ["ALLOW_MISSING_MODELS"] = "1"
        os.environ.setdefault("POSE_ENGINE", "/nonexistent/pose.engine")
        os.environ.setdefault("SHUTTLE_ENGINE", "/nonexistent/shuttle.engine")

        async def _skip_load() -> None:
            return None

        try:
            with patch.object(server_mod, "_load_models", new=_skip_load):
                with TestClient(
                    server_mod.app, raise_server_exceptions=False
                ) as client:
                    server_mod._detector = MagicMock() if detector else None
                    yield server_mod, client
        finally:
            for key, prev in (
                ("ALLOW_MISSING_MODELS", prev_allow),
                ("POSE_ENGINE", prev_pose),
                ("SHUTTLE_ENGINE", prev_shuttle),
                ("ALLOW_UNSAFE_CALLBACK", prev_unsafe),
            ):
                if prev is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = prev
            server_mod._detector = None

    def test_detect_sync_returns_202_before_job_finishes(self) -> None:
        started = threading.Event()
        finished = threading.Event()

        def slow_job(**kwargs):
            started.set()
            time.sleep(0.4)
            finished.set()
            return {"frame_count": 1, "elapsed_sec": 0.4}

        server_mod = self._import_server()
        prev = server_mod._detector
        server_mod._detector = MagicMock()
        header_seen = threading.Event()
        body_seen = threading.Event()
        status_codes: list[int] = []
        header_elapsed: list[float] = []
        body_chunks: list[bytes] = []
        t0 = time.monotonic()

        def on_start(message) -> None:
            status_codes.append(int(message["status"]))
            header_elapsed.append(time.monotonic() - t0)
            header_seen.set()

        def on_body(chunk: bytes) -> None:
            body_chunks.append(chunk)
            body_seen.set()

        errors: list[BaseException] = []

        def runner() -> None:
            try:
                with patch.object(server_mod, "_run_job", new=slow_job):
                    _asgi_post_detect_sync(
                        server_mod.app,
                        self._VALID,
                        on_start=on_start,
                        on_body=on_body,
                    )
            except BaseException as e:  # noqa: BLE001
                errors.append(e)
            finally:
                # Handler return means the job thread must already have finished.
                handler_finished.set()

        handler_finished = threading.Event()
        try:
            thread = threading.Thread(target=runner, name="asgi-detect-sync")
            thread.start()
            self.assertTrue(header_seen.wait(2.0), "202 headers never sent")
            self.assertEqual(status_codes[0], 202)
            self.assertLess(header_elapsed[0], 0.3)
            self.assertTrue(body_seen.wait(1.0), "202 body never sent")
            self.assertEqual(
                json.loads(b"".join(body_chunks).decode("utf-8")),
                {"request_id": "job-202"},
            )
            self.assertTrue(started.wait(1.0))
            self.assertFalse(finished.is_set())
            self.assertFalse(handler_finished.is_set())
            self.assertTrue(finished.wait(2.0))
            thread.join(timeout=2.0)
            self.assertFalse(thread.is_alive())
            self.assertTrue(handler_finished.is_set())
            self.assertEqual(errors, [])
        finally:
            server_mod._detector = prev

    def test_detect_sync_holds_after_disconnect_until_job_finishes(self) -> None:
        started = threading.Event()
        finished = threading.Event()
        callbacks: list[dict] = []

        def slow_job(**kwargs):
            started.set()
            time.sleep(0.4)
            finished.set()
            return {"frame_count": 1, "elapsed_sec": 0.4}

        def capture_cb(url, token, payload, **kwargs):
            callbacks.append(payload)
            return 200

        server_mod = self._import_server()
        prev = server_mod._detector
        prev_unsafe = os.environ.get("ALLOW_UNSAFE_CALLBACK")
        os.environ["ALLOW_UNSAFE_CALLBACK"] = "1"
        server_mod._detector = MagicMock()
        header_seen = threading.Event()
        body_seen = threading.Event()
        handler_finished = threading.Event()
        errors: list[BaseException] = []
        envelope = {
            **self._VALID,
            "callback_url": "https://example/functions/v1/jobs/callback",
            "callback_token": "tok",
        }

        def on_start(message) -> None:
            self.assertEqual(int(message["status"]), 202)
            header_seen.set()

        def on_body(chunk: bytes) -> None:
            self.assertEqual(
                json.loads(chunk.decode("utf-8")), {"request_id": "job-202"}
            )
            body_seen.set()

        def runner() -> None:
            try:
                _asgi_post_detect_sync_disconnect_after_202(
                    server_mod.app,
                    envelope,
                    on_start=on_start,
                    on_body=on_body,
                )
            except BaseException as e:  # noqa: BLE001
                errors.append(e)
            finally:
                handler_finished.set()

        try:
            with (
                patch.object(server_mod, "_run_job", new=slow_job),
                patch.object(server_mod, "post_callback", new=capture_cb),
            ):
                thread = threading.Thread(
                    target=runner, name="asgi-detect-disconnect"
                )
                thread.start()
                self.assertTrue(header_seen.wait(2.0), "202 headers never sent")
                self.assertTrue(body_seen.wait(1.0), "202 body never sent")
                self.assertTrue(started.wait(1.0))
                self.assertFalse(finished.is_set())
                time.sleep(0.15)
                self.assertFalse(
                    handler_finished.is_set(),
                    "ASGI handler returned on disconnect while the job is still running",
                )
                self.assertEqual(callbacks, [])
                self.assertTrue(finished.wait(2.0))
                thread.join(timeout=2.0)
                self.assertFalse(thread.is_alive())
                self.assertTrue(handler_finished.is_set())
                self.assertEqual(len(callbacks), 1)
                self.assertEqual(callbacks[0]["request_id"], "job-202")
                self.assertEqual(callbacks[0]["status"], "success")
                self.assertEqual(callbacks[0]["frame_count"], 1)
        finally:
            if prev_unsafe is None:
                os.environ.pop("ALLOW_UNSAFE_CALLBACK", None)
            else:
                os.environ["ALLOW_UNSAFE_CALLBACK"] = prev_unsafe
            server_mod._detector = prev

    def test_detect_sync_success_http_body_is_request_id_only(self) -> None:
        def quick_job(**kwargs):
            return {"frame_count": 9, "elapsed_sec": 0.01}

        with self._client() as (server_mod, client):
            with patch.object(server_mod, "_run_job", new=quick_job):
                resp = client.post("/detect/sync", json=self._VALID)
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.json(), {"request_id": "job-202"})

    def test_detect_sync_accepts_wrapped_input_envelope(self) -> None:
        def quick_job(**kwargs):
            return {"frame_count": 1, "elapsed_sec": 0.0}

        with self._client() as (server_mod, client):
            with patch.object(server_mod, "_run_job", new=quick_job):
                resp = client.post(
                    "/detect/sync", json={"input": dict(self._VALID)}
                )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.json(), {"request_id": "job-202"})

    def test_detect_sync_job_failure_stays_202_and_callbacks(self) -> None:
        def boom(**kwargs):
            raise RuntimeError("gpu exploded")

        callbacks: list[dict] = []

        def capture_cb(url, token, payload, **kwargs):
            callbacks.append(payload)
            return 200

        os.environ["ALLOW_UNSAFE_CALLBACK"] = "1"
        envelope = {
            **self._VALID,
            "callback_url": "https://example/functions/v1/jobs/callback",
            "callback_token": "tok",
        }
        with self._client() as (server_mod, client):
            with (
                patch.object(server_mod, "_run_job", new=boom),
                patch.object(server_mod, "post_callback", new=capture_cb),
            ):
                resp = client.post("/detect/sync", json=envelope)
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.json(), {"request_id": "job-202"})
        self.assertEqual(len(callbacks), 1)
        self.assertEqual(callbacks[0]["request_id"], "job-202")
        self.assertEqual(callbacks[0]["status"], "failed")
        self.assertIn("gpu exploded", callbacks[0]["error"])

    def test_detect_sync_422_missing_urls_is_sync_and_skips_job(self) -> None:
        with self._client() as (server_mod, client):
            with patch.object(server_mod, "_run_job") as run_job:
                t0 = time.monotonic()
                resp = client.post(
                    "/detect/sync", json={"request_id": "job-202"}
                )
                elapsed = time.monotonic() - t0
        self.assertEqual(resp.status_code, 422)
        self.assertIn("input_url", resp.json()["error"])
        self.assertEqual(resp.json()["request_id"], "job-202")
        self.assertLess(elapsed, 0.3)
        run_job.assert_not_called()

    def test_detect_sync_422_callback_not_allowed(self) -> None:
        prev_prefix = os.environ.get("CALLBACK_URL_PREFIX")
        prev_supabase = os.environ.get("SUPABASE_URL")
        os.environ.pop("ALLOW_UNSAFE_CALLBACK", None)
        os.environ.pop("CALLBACK_URL_PREFIX", None)
        os.environ.pop("SUPABASE_URL", None)
        envelope = {
            **self._VALID,
            "callback_url": "https://evil.example/functions/v1/jobs/callback",
            "callback_token": "tok",
        }
        try:
            with self._client() as (server_mod, client):
                with patch.object(server_mod, "_run_job") as run_job:
                    resp = client.post("/detect/sync", json=envelope)
        finally:
            for key, prev in (
                ("CALLBACK_URL_PREFIX", prev_prefix),
                ("SUPABASE_URL", prev_supabase),
            ):
                if prev is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = prev
        self.assertEqual(resp.status_code, 422)
        self.assertIn("callback_url not allowed", resp.json()["error"])
        run_job.assert_not_called()

    def test_detect_sync_503_models_missing_skips_job(self) -> None:
        with self._client(detector=False) as (server_mod, client):
            with patch.object(server_mod, "_run_job") as run_job:
                resp = client.post("/detect/sync", json=self._VALID)
        self.assertEqual(resp.status_code, 503)
        self.assertIn("models not loaded", resp.json()["error"])
        run_job.assert_not_called()


if __name__ == "__main__":
    unittest.main()
