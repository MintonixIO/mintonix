"""CPU-safe I/O and error-redaction contract tests."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from detect.types import FrameResult, ShuttleCandidate
from io_util import (
    download,
    safe_error_message,
    upload_file,
)


def _allow_file_urls() -> None:
    os.environ["ALLOW_FILE_URLS"] = "1"


class TestSafeErrorRedaction(unittest.TestCase):
    def test_strips_presigned_query(self) -> None:
        msg = (
            "Client error '403 Forbidden' for url "
            "'https://b2.example/bucket/key?X-Amz-Signature=SECRET&X-Amz-Date=1'"
        )
        safe = safe_error_message(msg)
        self.assertNotIn("SECRET", safe)
        self.assertNotIn("X-Amz-Signature", safe)
        self.assertIn("https://b2.example/bucket/key", safe)

class TestFileIO(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_allow = os.environ.get("ALLOW_FILE_URLS")
        _allow_file_urls()

    def tearDown(self) -> None:
        if self._prev_allow is None:
            os.environ.pop("ALLOW_FILE_URLS", None)
        else:
            os.environ["ALLOW_FILE_URLS"] = self._prev_allow

    def test_file_scheme_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "in.bin"
            src.write_bytes(b"hello-detect")
            dest = td_path / "out.bin"
            download(f"file://{src}", dest)
            self.assertEqual(dest.read_bytes(), b"hello-detect")

            uploaded = td_path / "uploaded.bin"
            upload_file(dest, f"file://{uploaded}")
            self.assertEqual(uploaded.read_bytes(), b"hello-detect")

    def test_file_upload_creates_parent_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "src.json"
            src.write_text('{"ok":true}')
            nested = td_path / "a" / "b" / "out.json"
            upload_file(src, f"file://{nested}", content_type="application/json")
            self.assertEqual(nested.read_text(), '{"ok":true}')

    def test_file_urls_gated(self) -> None:
        os.environ.pop("ALLOW_FILE_URLS", None)
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "x.bin"
            src.write_bytes(b"x")
            with self.assertRaises(RuntimeError) as ctx:
                download(f"file://{src}", Path(td) / "y.bin")
            self.assertIn("ALLOW_FILE_URLS", str(ctx.exception))

    def test_file_url_outside_allowlist(self) -> None:
        # Path under a non-allowlisted root must fail even when ALLOW_FILE_URLS=1.
        evil = Path("/etc/hosts")
        if not evil.is_file():
            self.skipTest("/etc/hosts not present")
        with self.assertRaises(RuntimeError) as ctx:
            download(f"file://{evil}", Path(tempfile.gettempdir()) / "hosts.copy")
        self.assertIn("allowlist", str(ctx.exception).lower())

    def test_file_write_rejects_app_root(self) -> None:
        """Writes must not land under /app even when ALLOW_FILE_URLS=1."""
        import io_util

        # Only meaningful when /app is a real root on the system; still validate
        # the write allowlist helper excludes /app.
        write_roots = {str(p) for p in io_util._file_url_write_roots()}
        self.assertNotIn(str(Path("/app").resolve()), write_roots)
        read_roots = {str(p) for p in io_util._file_url_read_roots()}
        self.assertIn(str(Path("/app").resolve()), read_roots)

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src.bin"
            src.write_bytes(b"x")
            # Simulate a write path under /app via resolve allowlist check.
            with self.assertRaises(RuntimeError) as ctx:
                upload_file(src, "file:///app/models/evil.json")
            self.assertIn("write", str(ctx.exception).lower())
            self.assertIn("allowlist", str(ctx.exception).lower())

    def test_download_max_bytes_local(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "big.bin"
            src.write_bytes(b"0123456789")
            dest = Path(td) / "out.bin"
            with self.assertRaises(RuntimeError) as ctx:
                download(f"file://{src}", dest, max_bytes=5)
            self.assertIn("max_bytes", str(ctx.exception))

    def test_multi_range_download_total_over_limit(self) -> None:
        """Range probe Content-Range total > max_bytes fails before writing."""
        import io_util

        class FakeProbe:
            status_code = 206
            headers = {"Content-Range": "bytes 0-0/99999"}

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers=None):
                return FakeProbe()

        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.bin"
            with patch.object(io_util, "_httpx", return_value=MagicMock()):
                with patch.object(io_util, "_http_client", return_value=FakeClient()):
                    with patch.object(io_util, "_MIN_RANGE_BYTES", 1):
                        with self.assertRaises(RuntimeError) as ctx:
                            download(
                                "https://cdn.example/v.mp4?sig=SECRET",
                                dest,
                                connections=2,
                                max_bytes=100,
                            )
            self.assertIn("too large", str(ctx.exception).lower())
            self.assertNotIn("SECRET", str(ctx.exception))
            self.assertFalse(dest.exists())

    def test_multi_range_download_overshoot_unlinks_partial(self) -> None:
        """Range body larger than expected span aborts and deletes dest."""
        import io_util

        total = 200  # under max_bytes but multi-range eligible with patched min

        class FakeProbe:
            status_code = 206
            headers = {"Content-Range": f"bytes 0-0/{total}"}

        class StreamResp:
            status_code = 206
            request = MagicMock()
            headers: dict = {}

            def __init__(self, payload: bytes) -> None:
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def iter_bytes(self, n):
                # One oversized chunk for the first range (expected 100 when 2 conns).
                yield self._payload

        class FakeClient:
            def __init__(self, *a, **k) -> None:
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers=None):
                return FakeProbe()

            def stream(self, method, url, headers=None):
                # Overshoot: 150 bytes for a 100-byte range (total/2).
                return StreamResp(b"x" * 150)

        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "partial.bin"
            with patch.object(io_util, "_httpx", return_value=MagicMock()):
                with patch.object(
                    io_util, "_http_client", side_effect=lambda mod, t: FakeClient()
                ):
                    with patch.object(io_util, "_MIN_RANGE_BYTES", 1):
                        with self.assertRaises(RuntimeError) as ctx:
                            download(
                                "https://cdn.example/v.mp4?sig=SECRET",
                                dest,
                                connections=2,
                                max_bytes=10_000,
                            )
            msg = str(ctx.exception).lower()
            self.assertTrue(
                "overshot" in msg or "download failed" in msg,
                msg=str(ctx.exception),
            )
            self.assertNotIn("SECRET", str(ctx.exception))
            self.assertFalse(
                dest.exists(),
                msg="partial multi-range dest must be unlinked on failure",
            )

    def test_http_upload_rejects_3xx(self) -> None:
        try:
            import httpx
        except ImportError:
            self.skipTest("httpx not installed")

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            src.write_bytes(b"{}")

            class FakeResp:
                status_code = 302
                request = httpx.Request("PUT", "https://cdn.example/o?sig=SECRET")

            class FakeClient:
                def __init__(self, *a, **k) -> None:
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def put(self, url, content=None, headers=None):
                    return FakeResp()

            with patch("io_util._http_client", return_value=FakeClient()):
                with self.assertRaises(RuntimeError) as ctx:
                    upload_file(src, "https://cdn.example/o?sig=SECRET", attempts=3)
            self.assertIn("redirect", str(ctx.exception).lower())
            self.assertNotIn("SECRET", str(ctx.exception))

    def test_stream_json_shape(self) -> None:
        frames = [
            FrameResult(frame=i, poses=[], shuttle=[ShuttleCandidate(0.1, 0.2, 0.3)])
            for i in range(3)
        ]
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "det.json"
            with path.open("w") as f:
                f.write('{"job_id":"j1","frames":[')
                for i, fr in enumerate(frames):
                    if i:
                        f.write(",")
                    f.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                f.write("]}")
            body = json.loads(path.read_text())
            self.assertEqual(body["job_id"], "j1")
            self.assertEqual(len(body["frames"]), 3)
            self.assertEqual(body["frames"][2]["frame"], 2)

    def test_http_upload_streams_and_retries(self) -> None:
        try:
            import httpx
        except ImportError:
            self.skipTest("httpx not installed")

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            payload = b'{"frames":[]}'
            src.write_bytes(payload)

            put_calls: list[dict] = []
            statuses = [500, 200]

            class FakeResp:
                def __init__(self, code: int) -> None:
                    self.status_code = code
                    self.request = httpx.Request("PUT", "https://cdn.example/o?sig=SECRET")

            class FakeClient:
                def __init__(self, *a, **k) -> None:
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def put(self, url, content=None, headers=None):
                    data = content.read() if hasattr(content, "read") else content
                    put_calls.append(
                        {
                            "url": url,
                            "headers": dict(headers or {}),
                            "body": data,
                            "is_file": hasattr(content, "read"),
                        }
                    )
                    return FakeResp(statuses.pop(0))

            with patch("io_util._http_client", side_effect=lambda mod, t: FakeClient()):
                with patch("io_util.time.sleep", return_value=None):
                    upload_file(
                        src,
                        "https://cdn.example/o?sig=SECRET",
                        content_type="application/json",
                        attempts=3,
                    )

            self.assertEqual(len(put_calls), 2)
            self.assertEqual(put_calls[0]["headers"]["Content-Length"], str(len(payload)))
            self.assertEqual(put_calls[0]["headers"]["Content-Type"], "application/json")
            self.assertEqual(put_calls[0]["body"], payload)
            self.assertEqual(put_calls[1]["body"], payload)  # re-open on retry

    def test_http_upload_no_retry_on_4xx(self) -> None:
        try:
            import httpx
        except ImportError:
            self.skipTest("httpx not installed")

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            src.write_bytes(b"{}")

            class FakeResp:
                def __init__(self) -> None:
                    self.status_code = 403
                    self.request = httpx.Request(
                        "PUT", "https://cdn.example/o?sig=SECRET"
                    )

            class FakeClient:
                def __init__(self, *a, **k) -> None:
                    self.n = 0

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def put(self, url, content=None, headers=None):
                    self.n += 1
                    return FakeResp()

            client = FakeClient()
            with patch("io_util._http_client", return_value=client):
                with self.assertRaises(RuntimeError) as ctx:
                    upload_file(src, "https://cdn.example/o?sig=SECRET", attempts=5)
            self.assertEqual(client.n, 1)
            self.assertNotIn("SECRET", str(ctx.exception))

    def test_http_upload_exhausted_retries(self) -> None:
        try:
            import httpx
        except ImportError:
            self.skipTest("httpx not installed")

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            src.write_bytes(b"{}")

            class FakeResp:
                status_code = 503
                request = httpx.Request("PUT", "https://cdn.example/o?sig=SECRET")

            class FakeClient:
                def __init__(self, *a, **k) -> None:
                    pass

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def put(self, url, content=None, headers=None):
                    return FakeResp()

            with patch("io_util._http_client", side_effect=lambda mod, t: FakeClient()):
                with patch("io_util.time.sleep", return_value=None):
                    with self.assertRaises(RuntimeError) as ctx:
                        upload_file(
                            src, "https://cdn.example/o?sig=SECRET", attempts=2
                        )
            self.assertIn("after 2 attempts", str(ctx.exception))
            self.assertNotIn("SECRET", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
