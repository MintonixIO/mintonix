"""HTTP / local file I/O shared by the detect job server.

Mirrors the normalize worker contract: `file://` for local benchmark paths,
HTTP for production presigned URLs. Parallel byte-range GET when the server
supports Range (S3/B2 presigned URLs do).
"""
from __future__ import annotations

import concurrent.futures
import logging
import math
import os
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger("video-det.io")

# Tunable: parallel download connections (same defaults as normalize).
DL_CONNECTIONS = int(os.environ.get("DL_CONNECTIONS", "8"))
# Skip multi-range when the object is smaller than this many bytes.
_MIN_RANGE_BYTES = 8 * 1024 * 1024
_UPLOAD_ATTEMPTS = 5


def _redact(url: str) -> str:
    """Drop query string (presigned secrets) for logs."""
    try:
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}{p.path}"
    except Exception:  # noqa: BLE001
        return "<url>"


def _httpx():
    import httpx

    return httpx


def download(url: str, dest: Path, connections: int | None = None) -> None:
    """Download `url` to `dest`. Supports `file://` and HTTP(S).

    Uses parallel byte-range GETs when Content-Range is available and the
    object is large enough; falls back to a single stream otherwise.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    if url.startswith("file://"):
        src = Path(url[len("file://") :])
        size = src.stat().st_size
        log.info("download(local): %s -> %s (%d bytes)", src, dest, size)
        shutil.copy(src, dest)
        return

    connections = connections or DL_CONNECTIONS
    httpx = _httpx()
    log.info(
        "download(start): %s -> %s (%d conns)",
        _redact(url),
        dest,
        connections,
    )
    t0 = time.monotonic()

    total = 0
    ranges_ok = False
    if connections > 1:
        try:
            with httpx.Client(timeout=60.0) as client:
                probe = client.get(url, headers={"Range": "bytes=0-0"})
                if probe.status_code == 206:
                    cr = probe.headers.get("Content-Range", "")  # bytes 0-0/12345
                    if "/" in cr:
                        total = int(cr.split("/")[-1])
                        ranges_ok = total > 0
        except Exception as e:  # noqa: BLE001
            log.info("download: range probe failed (%s); single stream", e)

    if not ranges_ok or total < _MIN_RANGE_BYTES:
        _download_stream(url, dest)
        return

    log.info(
        "download(content-length): %d bytes (%.1f MB), %d ranges",
        total,
        total / 1024 / 1024,
        connections,
    )
    with dest.open("wb") as f:
        f.truncate(total)

    part = math.ceil(total / connections)
    chunks = [
        (i * part, min((i + 1) * part, total) - 1)
        for i in range(connections)
        if i * part < total
    ]

    def fetch(start: int, end: int) -> None:
        with httpx.Client(timeout=600.0) as client:
            with client.stream(
                "GET", url, headers={"Range": f"bytes={start}-{end}"}
            ) as r:
                r.raise_for_status()
                with dest.open("r+b") as f:
                    f.seek(start)
                    for ch in r.iter_bytes(8 * 1024 * 1024):
                        f.write(ch)

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(chunks)) as ex:
        futs = [ex.submit(fetch, s, e) for s, e in chunks]
        for fu in concurrent.futures.as_completed(futs):
            fu.result()

    elapsed = time.monotonic() - t0
    speed = (total / elapsed / 1024 / 1024) if elapsed else 0
    log.info(
        "download(done): %d bytes in %.1fs (%.1f MB/s, %d conns)",
        total,
        elapsed,
        speed,
        len(chunks),
    )


def _download_stream(url: str, dest: Path) -> None:
    httpx = _httpx()
    t0 = time.monotonic()
    written = 0
    with httpx.Client(timeout=300.0) as client:
        with client.stream("GET", url) as r:
            r.raise_for_status()
            with dest.open("wb") as f:
                for chunk in r.iter_bytes(65536):
                    f.write(chunk)
                    written += len(chunk)
    elapsed = time.monotonic() - t0
    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
    log.info(
        "download(done,single): %d bytes in %.1fs (%.1f MB/s)",
        written,
        elapsed,
        speed,
    )


def upload_file(
    local_path: Path,
    url: str,
    content_type: str = "application/octet-stream",
    attempts: int = _UPLOAD_ATTEMPTS,
) -> None:
    """PUT local file to `url`. Supports `file://` and HTTP(S) with retries."""
    local_path = Path(local_path)
    size = local_path.stat().st_size

    if url.startswith("file://"):
        dst = Path(url[len("file://") :])
        dst.parent.mkdir(parents=True, exist_ok=True)
        log.info("upload(local): %s -> %s (%d bytes)", local_path, dst, size)
        shutil.copy(local_path, dst)
        return

    httpx = _httpx()
    log.info("upload(start): %s (%d bytes) -> %s", local_path, size, _redact(url))
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            data = local_path.read_bytes()
            with httpx.Client(timeout=300.0) as client:
                r = client.put(
                    url,
                    content=data,
                    headers={
                        "Content-Type": content_type,
                        "Content-Length": str(size),
                    },
                )
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"HTTP {r.status_code}",
                        request=r.request,
                        response=r,
                    )
                r.raise_for_status()
            log.info("upload(done): %d bytes", size)
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            log.warning("upload(retry %d/%d): %s", i + 1, attempts, e)
            time.sleep(min(2**i, 30))
    raise RuntimeError(f"upload failed after {attempts} attempts: {last_err}")


def post_callback(
    url: str,
    token: str | None,
    payload: dict,
    attempts: int = 5,
) -> int | None:
    """POST result to jobs/callback with Bearer token. Retries 5xx/network."""
    httpx = _httpx()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    for i in range(attempts):
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, json=payload, headers=headers)
            if resp.status_code < 500:
                level = log.info if resp.status_code < 400 else log.warning
                level("callback: HTTP %d %s", resp.status_code, resp.text[:300])
                return resp.status_code
            log.warning(
                "callback(retry %d/%d): HTTP %d", i + 1, attempts, resp.status_code
            )
        except httpx.HTTPError as e:
            log.warning("callback(retry %d/%d): %s", i + 1, attempts, e)
        time.sleep(min(2**i, 30))
    log.error("callback(failed): gave up after %d attempts", attempts)
    return None
