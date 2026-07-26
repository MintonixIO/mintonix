"""Tests for URL detection, callbacks, upload retries, and multipart upload."""

import os
import tempfile
import unittest
from unittest import mock

import test_support  # noqa: F401  # sets ALLOW_FILE_URLS

import normalize as h


class TestYoutubeSourceDetection(unittest.TestCase):
    def test_youtube_urls(self):
        for url in ("https://www.youtube.com/watch?v=nUKzwRPI68A",
                    "https://youtube.com/watch?v=abc",
                    "https://m.youtube.com/watch?v=abc",
                    "https://youtu.be/nUKzwRPI68A",
                    "http://www.youtube.com/shorts/abc"):
            self.assertTrue(h.is_youtube_url(url), url)

    def test_non_youtube_urls(self):
        # presigned B2/S3 GETs and lookalike hosts must take the plain
        # download path, never yt-dlp
        for url in ("https://s3.us-west-004.backblazeb2.com/bucket/k?sig=x",
                    "file:///tmp/source.mp4",
                    "https://notyoutube.com/watch?v=abc",
                    "https://evil.com/youtu.be/abc",
                    "https://youtube.com.evil.com/watch?v=abc",
                    ""):
            self.assertFalse(h.is_youtube_url(url), url)


class TestPostCallback(unittest.TestCase):
    """post_callback against a real local HTTP server: the Bearer token and
    JSON payload must arrive intact, and 4xx must not trigger the retry loop
    (a rejected/stale token can't be fixed by retrying)."""

    def _serve(self, status, fail_times=0):
        import http.server
        import json as jsonlib
        import threading

        received = {"count": 0, "bodies": []}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                received["auth"] = self.headers.get("Authorization")
                body = jsonlib.loads(
                    self.rfile.read(int(self.headers["Content-Length"])))
                received["body"] = body
                received["bodies"].append(body)
                received["count"] = received.get("count", 0) + 1
                code = status
                if fail_times and received["count"] <= fail_times:
                    code = 503
                self.send_response(code)
                self.end_headers()

            def do_PUT(self):
                length = int(self.headers.get("Content-Length", 0))
                received["put_body"] = self.rfile.read(length)
                received["count"] = received.get("count", 0) + 1
                code = status
                if fail_times and received["count"] <= fail_times:
                    code = 503
                self.send_response(code)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return f"http://127.0.0.1:{server.server_port}/callback", received

    def test_success_delivers_token_and_payload(self):
        url, received = self._serve(200)
        status = h.post_callback(url, "tok123", {"request_id": "j1", "status": "success"})
        self.assertEqual(status, 200)
        self.assertEqual(received["auth"], "Bearer tok123")
        self.assertEqual(received["body"]["request_id"], "j1")

    def test_4xx_is_terminal_no_retries(self):
        url, received = self._serve(403)
        status = h.post_callback(url, "stale", {"request_id": "j1"}, attempts=3)
        self.assertEqual(status, 403)
        self.assertEqual(received["count"], 1)

    def test_5xx_then_success(self):
        url, received = self._serve(200, fail_times=2)
        with mock.patch("io_util.time.sleep"):
            status = h.post_callback(url, "tok", {"request_id": "j1"}, attempts=5)
        self.assertEqual(status, 200)
        self.assertEqual(received["count"], 3)


class TestUploadRetries(unittest.TestCase):
    def _put_server(self, handler_cls):
        import http.server
        import threading
        server = http.server.HTTPServer(("127.0.0.1", 0), handler_cls)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return f"http://127.0.0.1:{server.server_port}/obj"

    def test_upload_retries_on_5xx_then_succeeds(self):
        import http.server

        state = {"count": 0}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                state["count"] += 1
                if state["count"] < 3:
                    self.send_response(503)
                else:
                    self.send_response(200)
                self.end_headers()

            def log_message(self, *args):
                pass

        url = self._put_server(Handler)

        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"hello-upload-retry")
            path = f.name
        self.addCleanup(lambda: os.unlink(path))

        with mock.patch("io_util.time.sleep"):
            h.upload(path, url, attempts=5)
        self.assertEqual(state["count"], 3)

    def test_upload_gives_up_after_attempts(self):
        import http.server

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                self.send_response(503)
                self.end_headers()

            def log_message(self, *args):
                pass

        url = self._put_server(Handler)

        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"x")
            path = f.name
        self.addCleanup(lambda: os.unlink(path))

        with mock.patch("io_util.time.sleep"):
            with self.assertRaises(RuntimeError):
                h.upload(path, url, attempts=2)

    def test_upload_4xx_is_terminal_single_attempt(self):
        import http.server
        state = {"count": 0}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                state["count"] += 1
                self.send_response(403)
                self.end_headers()

            def log_message(self, *args):
                pass

        url = self._put_server(Handler)
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"x")
            path = f.name
        self.addCleanup(lambda: os.unlink(path))

        with mock.patch("io_util.time.sleep") as sleep:
            with self.assertRaises(RuntimeError) as ctx:
                h.upload(path, url, attempts=5)
        self.assertEqual(state["count"], 1)
        sleep.assert_not_called()
        # No raw query signature in error
        self.assertNotIn("?", str(ctx.exception))
        self.assertIn("403", str(ctx.exception))

    def test_sanitize_error_strips_presign_query(self):
        raw = 'HTTPError for url: https://s3.example.com/k?X-Amz-Signature=SECRET&x=1'
        clean = h.sanitize_error(raw)
        self.assertNotIn("SECRET", clean)
        self.assertNotIn("X-Amz-Signature", clean)
        self.assertIn("s3.example.com", clean)

    def test_sanitize_error_relative_url_and_amz(self):
        raw = (
            "Max retries exceeded with url: "
            "/bucket/key?X-Amz-Algorithm=AWS4&X-Amz-Signature=SECRET123"
        )
        clean = h.sanitize_error(raw)
        self.assertNotIn("SECRET123", clean)
        self.assertIn("/bucket/key", clean)

    def test_redact_includes_scheme(self):
        r = h._redact("https://host.example/path?sig=abc")
        self.assertTrue(r.startswith("https://"))
        self.assertNotIn("sig=", r)

    def test_upload_retries_408_and_429(self):
        import http.server
        state = {"count": 0, "codes": [408, 429, 200]}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                code = state["codes"][min(state["count"], len(state["codes"]) - 1)]
                state["count"] += 1
                self.send_response(code)
                self.end_headers()

            def log_message(self, *args):
                pass

        url = self._put_server(Handler)
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"x")
            path = f.name
        self.addCleanup(lambda: os.unlink(path))
        with mock.patch("io_util.time.sleep"):
            h.upload(path, url, attempts=5)
        self.assertEqual(state["count"], 3)

    def test_file_url_denied_without_allow(self):
        import io_util
        with mock.patch.dict(os.environ, {"ALLOW_FILE_URLS": "0"}, clear=False):
            with self.assertRaises(RuntimeError) as ctx:
                io_util._check_url_policy("file:///tmp/x", kind="download")
            self.assertIn("file://", str(ctx.exception))

    def test_benchmark_file_urls_allowed_without_allow_file_urls(self):
        """Stock PyWorker benchmark paths work with ALLOW_FILE_URLS=0."""
        import io_util
        env = {
            "ALLOW_FILE_URLS": "0",
            # Ensure default sample path (not a custom BENCHMARK_INPUT_URL).
            "BENCHMARK_INPUT_URL": "file:///app/sample.mov",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            # Must not raise.
            io_util._check_url_policy("file:///app/sample.mov", kind="download")
            io_util._check_url_policy(
                "file:///tmp/benchmark_abc123deadbeef.mp4", kind="upload"
            )

    def test_custom_benchmark_input_url_file_allowed(self):
        import io_util
        env = {
            "ALLOW_FILE_URLS": "0",
            "BENCHMARK_INPUT_URL": "file:///data/bench_in.mov",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            io_util._check_url_policy("file:///data/bench_in.mov", kind="download")
            # Default sample still allowed as hard-coded stock path.
            io_util._check_url_policy("file:///app/sample.mov", kind="download")
            # Unrelated paths still denied.
            with self.assertRaises(RuntimeError):
                io_util._check_url_policy("file:///etc/passwd", kind="download")

    def test_benchmark_output_path_traversal_denied(self):
        import io_util
        with mock.patch.dict(os.environ, {"ALLOW_FILE_URLS": "0"}, clear=False):
            with self.assertRaises(RuntimeError):
                io_util._check_url_policy(
                    "file:///tmp/benchmark_../../etc/passwd", kind="upload"
                )
            with self.assertRaises(RuntimeError):
                io_util._check_url_policy(
                    "file:///tmp/benchmark_x.mp4/../secret", kind="upload"
                )

    def test_multipart_respects_allowed_http_hosts(self):
        import io_util
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"x" * 20)
            path = f.name
        self.addCleanup(lambda: os.unlink(path))
        with mock.patch.dict(
            os.environ, {"ALLOWED_HTTP_HOSTS": "storage.example.com"}, clear=False
        ):
            with self.assertRaises(RuntimeError) as ctx:
                io_util.upload_multipart(path, {
                    "part_urls": ["http://evil.example/p1", "http://evil.example/p2"],
                    "complete_url": "http://evil.example/complete",
                    "part_size": 10,
                })
            self.assertIn("ALLOWED_HTTP_HOSTS", str(ctx.exception))


class TestMultipartUpload(unittest.TestCase):
    def test_nparts_overflow_raises(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"x" * 100)
            path = f.name
        self.addCleanup(lambda: os.unlink(path))
        with self.assertRaises(RuntimeError) as ctx:
            h.upload_multipart(path, {
                "part_urls": ["http://127.0.0.1/p1"],  # only 1
                "complete_url": "http://127.0.0.1/complete",
                "part_size": 10,  # needs 10 parts for 100 bytes
            })
        self.assertIn("parts", str(ctx.exception).lower())

    def test_part_retry_then_complete(self):
        import http.server
        import threading
        from urllib.parse import urlparse, parse_qs

        state = {"parts": {}, "complete": 0, "abort": 0, "part_hits": {}}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                qs = parse_qs(urlparse(self.path).query)
                pn = int(qs.get("partNumber", ["0"])[0])
                state["part_hits"][pn] = state["part_hits"].get(pn, 0) + 1
                if state["part_hits"][pn] < 2:
                    self.send_response(503)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("ETag", f'"etag-{pn}"')
                self.end_headers()

            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                state["complete"] += 1
                if state["complete"] < 2:
                    self.send_response(503)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"<CompleteMultipartUploadResult/>")

            def do_DELETE(self):
                state["abort"] += 1
                self.send_response(204)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        base = f"http://127.0.0.1:{server.server_port}"

        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"abcdefghij" * 2)  # 20 bytes
            path = f.name
        self.addCleanup(lambda: os.unlink(path))

        with mock.patch("io_util.time.sleep"):
            h.upload_multipart(path, {
                "part_urls": [
                    f"{base}/p?partNumber=1",
                    f"{base}/p?partNumber=2",
                ],
                "complete_url": f"{base}/complete",
                "abort_url": f"{base}/abort",
                "part_size": 10,
            })
        self.assertEqual(state["part_hits"][1], 2)
        self.assertEqual(state["part_hits"][2], 2)
        self.assertEqual(state["complete"], 2)
        self.assertEqual(state["abort"], 0)

    def test_abort_on_terminal_part_failure(self):
        import http.server
        import threading

        state = {"abort": 0}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_PUT(self):
                n = int(self.headers.get("Content-Length", 0))
                self.rfile.read(n)
                self.send_response(403)
                self.end_headers()

            def do_DELETE(self):
                state["abort"] += 1
                self.send_response(204)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        base = f"http://127.0.0.1:{server.server_port}"

        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"x" * 20)
            path = f.name
        self.addCleanup(lambda: os.unlink(path))

        with mock.patch("io_util.time.sleep"):
            with self.assertRaises(RuntimeError):
                h.upload_multipart(path, {
                    "part_urls": [f"{base}/p1", f"{base}/p2"],
                    "complete_url": f"{base}/c",
                    "abort_url": f"{base}/abort",
                    "part_size": 10,
                })
        self.assertEqual(state["abort"], 1)


if __name__ == "__main__":
    unittest.main()
