"""CPU-safe server / worker / product-import contract tests."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
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
        self.assertIn("python3-setuptools", src)
        self.assertIn("builder_resource", src)
        self.assertNotIn('CMD ["bash", "start_server.sh"]', src)

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

            resp.JSONResponse = JSONResponse
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


if __name__ == "__main__":
    unittest.main()
