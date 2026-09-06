"""CPU-safe CUDA-context contract tests (no GPU required).

Attempt 1 on VIDEO-DETECTION-DEV failed at pose mem_alloc with
``no currently active context`` after TRT deserialize succeeded.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent


class _LogicError(Exception):
    pass


class TestAcquireDeviceContext(unittest.TestCase):
    def _fake_driver(self, *, current=None, raise_current: bool = False):
        fake = MagicMock()
        fake.LogicError = _LogicError
        fake.Device.count.return_value = 1
        device = MagicMock()
        ctx = MagicMock(name="primary_ctx")
        device.retain_primary_context.return_value = ctx
        fake.Device.return_value = device
        if raise_current:
            fake.Context.get_current.side_effect = _LogicError("no ctx")
        else:
            fake.Context.get_current.return_value = current
        return fake, device, ctx

    def _patch_pycuda(self, fake):
        pycuda_mod = MagicMock()
        pycuda_mod.driver = fake
        return patch.dict(sys.modules, {"pycuda": pycuda_mod, "pycuda.driver": fake})

    def test_retains_primary_and_pushes_when_none_current(self) -> None:
        import trt_io

        fake, device, ctx = self._fake_driver(raise_current=True)
        with self._patch_pycuda(fake):
            got = trt_io.acquire_device_context()
        self.assertIs(got, ctx)
        ctx.push.assert_called()
        device.make_context.assert_not_called()

    def test_retains_primary_without_make_context_when_already_current(self) -> None:
        import trt_io

        existing = MagicMock(name="already_current")
        fake, device, ctx = self._fake_driver(current=existing)
        with self._patch_pycuda(fake):
            got = trt_io.acquire_device_context()
        self.assertIs(got, ctx)
        ctx.push.assert_not_called()
        device.make_context.assert_not_called()

    def test_fails_without_cuda_device(self) -> None:
        import trt_io

        fake = MagicMock()
        fake.LogicError = _LogicError
        fake.Device.count.return_value = 0
        with self._patch_pycuda(fake):
            with self.assertRaises(RuntimeError) as cm:
                trt_io.acquire_device_context()
        self.assertIn("CUDA device", str(cm.exception))


class TestRunnerInitAllocatesUnderGpuExecute(unittest.TestCase):
    def test_acquire_fallback_is_primary_not_make_context(self) -> None:
        src = (ROOT / "trt_io.py").read_text(encoding="utf-8")
        self.assertIn("retain_primary_context", src)
        # Fallback after get_current fails must not create a second context.
        fn = src.split("def acquire_device_context", 1)[1].split("\ndef ", 1)[0]
        self.assertNotIn(".make_context(", fn)

    def test_pose_runner_mem_alloc_is_inside_gpu_execute(self) -> None:
        self._assert_alloc_under_gpu_execute(ROOT / "pose" / "trt_runtime.py")

    def test_shuttle_runner_mem_alloc_is_inside_gpu_execute(self) -> None:
        self._assert_alloc_under_gpu_execute(ROOT / "detect" / "shuttle_trt.py")

    def _assert_alloc_under_gpu_execute(self, path: Path) -> None:
        src = path.read_text(encoding="utf-8")
        self.assertIn("with gpu_execute(self.cuda_ctx):", src)
        init = src.split("def __init__", 1)[1]
        before, after = init.split("with gpu_execute(self.cuda_ctx):", 1)
        self.assertNotIn(
            "mem_alloc",
            before,
            f"{path.name} mem_alloc before gpu_execute (pycuda needs a pushed ctx)",
        )
        self.assertIn("mem_alloc", after)
        self.assertIn("pagelocked_empty", after)


if __name__ == "__main__":
    unittest.main()
