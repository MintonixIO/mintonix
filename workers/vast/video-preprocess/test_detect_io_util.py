"""CPU-safe I/O and error-redaction contract tests."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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
        evil = Path("/etc/hosts")
        if not evil.is_file():
            self.skipTest("/etc/hosts not present")
        with self.assertRaises(RuntimeError) as ctx:
            download(f"file://{evil}", Path(tempfile.gettempdir()) / "hosts.copy")
        self.assertIn("allowlist", str(ctx.exception).lower())

    def test_file_write_rejects_app_root(self) -> None:
        import io_util

        write_roots = {str(p) for p in io_util._file_url_write_roots()}
        self.assertNotIn(str(Path("/app").resolve()), write_roots)
        self.assertIn(str(Path("/out").resolve()), write_roots)
        read_roots = {str(p) for p in io_util._file_url_read_roots()}
        self.assertIn(str(Path("/app").resolve()), read_roots)
        self.assertIn(str(Path("/out").resolve()), read_roots)

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src.bin"
            src.write_bytes(b"x")
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


class _StreamGet:
    def __init__(self, status=200, headers=None, chunks=None):
        self.status_code = status
        self.headers = headers or {}
        self._chunks = chunks or []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def iter_content(self, n):
        yield from self._chunks


class TestHttpIO(unittest.TestCase):
    def test_stream_download_respects_max_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.bin"
            req = MagicMock()
            req.get.return_value = _StreamGet(chunks=[b"x" * 20, b"y" * 20])
            req.RequestException = type("RequestException", (Exception,), {})
            with patch("io_util._requests", return_value=req):
                with self.assertRaises(RuntimeError) as ctx:
                    download(
                        "https://cdn.example/v.mp4?sig=SECRET",
                        dest,
                        max_bytes=25,
                    )
            self.assertIn("max_bytes", str(ctx.exception).lower())
            self.assertNotIn("SECRET", str(ctx.exception))
            self.assertFalse(dest.exists())

    def test_stream_download_content_length_precheck(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out.bin"
            req = MagicMock()
            req.get.return_value = _StreamGet(headers={"Content-Length": "1000"})
            req.RequestException = type("RequestException", (Exception,), {})
            with patch("io_util._requests", return_value=req):
                with self.assertRaises(RuntimeError) as ctx:
                    download("https://cdn.example/v.mp4", dest, max_bytes=100)
            self.assertIn("too large", str(ctx.exception).lower())
            self.assertFalse(dest.exists())

    def test_http_upload_rejects_3xx(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            src.write_bytes(b"{}")
            resp = MagicMock()
            resp.status_code = 302
            req = MagicMock()
            req.put.return_value = resp
            req.RequestException = type("RequestException", (Exception,), {})
            with patch("io_util._requests", return_value=req):
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
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            payload = b'{"frames":[]}'
            src.write_bytes(payload)

            put_calls: list[dict] = []
            statuses = [500, 200]

            def fake_put(url, data=None, headers=None, timeout=None, allow_redirects=None):
                body = data.read() if hasattr(data, "read") else data
                put_calls.append(
                    {"url": url, "headers": dict(headers or {}), "body": body}
                )
                resp = MagicMock()
                resp.status_code = statuses.pop(0)
                return resp

            req = MagicMock()
            req.put.side_effect = fake_put
            req.RequestException = type("RequestException", (Exception,), {})
            with patch("io_util._requests", return_value=req):
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
            self.assertEqual(put_calls[1]["body"], payload)

    def test_http_upload_no_retry_on_4xx(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            src.write_bytes(b"{}")
            n = {"k": 0}

            def fake_put(*a, **k):
                n["k"] += 1
                resp = MagicMock()
                resp.status_code = 403
                return resp

            req = MagicMock()
            req.put.side_effect = fake_put
            req.RequestException = type("RequestException", (Exception,), {})
            with patch("io_util._requests", return_value=req):
                with self.assertRaises(RuntimeError) as ctx:
                    upload_file(src, "https://cdn.example/o?sig=SECRET", attempts=5)
            self.assertEqual(n["k"], 1)
            self.assertNotIn("SECRET", str(ctx.exception))

    def test_http_upload_exhausted_retries(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "out.json"
            src.write_bytes(b"{}")
            resp = MagicMock()
            resp.status_code = 503
            req = MagicMock()
            req.put.return_value = resp
            req.RequestException = type("RequestException", (Exception,), {})
            with patch("io_util._requests", return_value=req):
                with patch("io_util.time.sleep", return_value=None):
                    with self.assertRaises(RuntimeError) as ctx:
                        upload_file(
                            src, "https://cdn.example/o?sig=SECRET", attempts=2
                        )
            self.assertIn("after 2 attempts", str(ctx.exception))
            self.assertNotIn("SECRET", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
