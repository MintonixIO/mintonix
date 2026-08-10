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
        os.environ.setdefault("SHUTTLE_CKPT", "/nonexistent/shuttle.pt")
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
            prev_shuttle = os.environ.get("SHUTTLE_CKPT")
            prev_allow = os.environ.get("ALLOW_MISSING_MODELS")
            os.environ["POSE_ENGINE"] = "/nonexistent/pose.engine"
            os.environ["SHUTTLE_CKPT"] = "/nonexistent/shuttle.pt"
            try:
                os.environ["ALLOW_MISSING_MODELS"] = "1"
                server_mod._detector = None
                await server_mod._load_models()
                self.assertIsNone(server_mod._detector)

                os.environ.pop("ALLOW_MISSING_MODELS", None)
                with self.assertRaises(FileNotFoundError):
                    await server_mod._load_models()
            finally:
                for key, prev in (
                    ("POSE_ENGINE", prev_pose),
                    ("SHUTTLE_CKPT", prev_shuttle),
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
                dest, request_id="job-1", video_path=Path(td) / "v.mp4"
            )
            self.assertEqual(n, 2)
            body = json.loads(dest.read_text())
            self.assertEqual(body["job_id"], "job-1")
            self.assertEqual(len(body["frames"]), 2)
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
        os.environ.setdefault("SHUTTLE_CKPT", "/nonexistent/shuttle.pt")
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


if __name__ == "__main__":
    unittest.main()
