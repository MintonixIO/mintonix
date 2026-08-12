"""HTTP / local file I/O shared by the detect job server.

Mirrors the video-preprocess worker contract: `file://` for local benchmark paths
(when ALLOW_FILE_URLS=1, allowlisted roots only), HTTP for production
presigned URLs. Parallel byte-range GET when the server supports Range
(S3/B2 presigned URLs do). Redirects are never followed — 3xx is a hard error
(B2/S3 presigns are direct object URLs and do not redirect).
"""
from __future__ import annotations

import concurrent.futures
import logging
import math
import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger("video-det.io")

# Tunable: parallel download connections (same defaults as normalize).
DL_CONNECTIONS = int(os.environ.get("DL_CONNECTIONS", "8"))
# Skip multi-range when the object is smaller than this many bytes.
_MIN_RANGE_BYTES = 8 * 1024 * 1024
_UPLOAD_ATTEMPTS = 5

# Default caps: ~2 GiB video, ~50 MiB mask PNG (override via env).
MAX_DOWNLOAD_BYTES = int(os.environ.get("MAX_DOWNLOAD_BYTES", str(2 * 1024**3)))
MAX_MASK_BYTES = int(os.environ.get("MAX_MASK_BYTES", str(50 * 1024**2)))

# Presigned URLs often appear in httpx exception text — strip query strings.
_URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)


def _redact(url: str) -> str:
    """Drop query string (presigned secrets) for logs."""
    try:
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}{p.path}"
    except Exception:  # noqa: BLE001
        return "<url>"


def safe_error_message(exc: BaseException | str) -> str:
    """Exception text safe for logs, callbacks, and API bodies (no presigned QS)."""
    text = str(exc)

    def _sub(m: re.Match[str]) -> str:
        return _redact(m.group(0))

    return _URL_RE.sub(_sub, text)


def _allow_file_urls() -> bool:
    return os.environ.get("ALLOW_FILE_URLS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _dedupe_roots(roots: list[Path]) -> list[Path]:
    out: list[Path] = []
    seen: set[Path] = set()
    for r in roots:
        if r not in seen:
            out.append(r)
            seen.add(r)
    return out


def _file_url_read_roots() -> list[Path]:
    """Roots allowed for file:// *reads* when ALLOW_FILE_URLS=1.

    Includes ``/app`` so the Docker benchmark can load ``file:///app/sample.mp4``.
    """
    return _dedupe_roots(
        [
            Path("/app").resolve(),
            Path("/tmp").resolve(),
            Path(tempfile.gettempdir()).resolve(),
        ]
    )


def _file_url_write_roots() -> list[Path]:
    """Roots allowed for file:// *writes* when ALLOW_FILE_URLS=1.

    Deliberately excludes ``/app`` so a hostile job cannot overwrite app/models
    even when file URLs are enabled for local benchmarks. Writes stay under
    temp dirs only (``/tmp`` / ``tempfile.gettempdir()``).
    """
    return _dedupe_roots(
        [
            Path("/tmp").resolve(),
            Path(tempfile.gettempdir()).resolve(),
        ]
    )


# Back-compat alias (read roots).
def _file_url_roots() -> list[Path]:
    return _file_url_read_roots()


def _resolve_file_url(url: str, *, for_write: bool = False) -> Path:
    """Parse file:// URL, require ALLOW_FILE_URLS, enforce root allowlist.

    ``for_write=True`` uses the tighter write allowlist (no ``/app``).
    """
    if not _allow_file_urls():
        raise RuntimeError(
            "file:// URLs are disabled (set ALLOW_FILE_URLS=1 for local/benchmark)"
        )
    raw = url[len("file://") :]
    path = Path(raw).expanduser().resolve()
    roots = _file_url_write_roots() if for_write else _file_url_read_roots()
    for root in roots:
        try:
            path.relative_to(root)
            return path
        except ValueError:
            continue
    kind = "write" if for_write else "read"
    raise RuntimeError(
        f"file:// {kind} path outside allowlist {roots}: {path}"
    )


def _httpx():
    import httpx

    return httpx


def _http_client(httpx_mod, timeout: float):
    """Shared client defaults: no redirect follow (SSRF surface)."""
    return httpx_mod.Client(timeout=timeout, follow_redirects=False)


def _reject_redirect(status_code: int, url: str) -> None:
    """3xx is a hard failure when follow_redirects=False (presigns do not redirect)."""
    if 300 <= status_code < 400:
        raise RuntimeError(
            f"HTTP {status_code} redirect not allowed "
            f"(follow_redirects=False) ({_redact(url)})"
        )


def _check_response_status(response, url: str, httpx_mod) -> None:
    """Fail on 3xx (redirect) or 4xx/5xx without embedding request URL secrets."""
    code = response.status_code
    _reject_redirect(code, url)
    if code >= 400:
        raise httpx_mod.HTTPStatusError(
            f"HTTP {code}",
            request=response.request,
            response=response,
        )


def _upload_retryable(exc: BaseException, httpx_mod) -> bool:
    """Retry 5xx, 408/429, and transport/timeouts — not permanent 4xx or 3xx."""
    if isinstance(exc, httpx_mod.HTTPStatusError):
        code = exc.response.status_code if exc.response is not None else 0
        return code >= 500 or code in (408, 429)
    transport_types: tuple[type, ...] = (httpx_mod.TimeoutException,)
    if hasattr(httpx_mod, "TransportError"):
        transport_types = (*transport_types, httpx_mod.TransportError)
    if hasattr(httpx_mod, "NetworkError"):
        transport_types = (*transport_types, httpx_mod.NetworkError)
    if isinstance(exc, transport_types):
        return True
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return True
    return False


def download(
    url: str,
    dest: Path,
    connections: int | None = None,
    *,
    max_bytes: int | None = None,
) -> None:
    """Download `url` to `dest`. Supports `file://` (gated + allowlisted) and HTTP(S).

    Uses parallel byte-range GETs when Content-Range is available and the
    object is large enough; falls back to a single stream otherwise.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    limit = MAX_DOWNLOAD_BYTES if max_bytes is None else max_bytes

    if url.startswith("file://"):
        src = _resolve_file_url(url)
        size = src.stat().st_size
        if size > limit:
            raise RuntimeError(
                f"local file exceeds max_bytes ({size} > {limit}): {src}"
            )
        log.info("download(local): %s -> %s (%d bytes)", src, dest, size)
        shutil.copy(src, dest)
        return

    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError(f"unsupported URL scheme: {_redact(url)}")

    connections = connections or DL_CONNECTIONS
    httpx = _httpx()
    log.info(
        "download(start): %s -> %s (%d conns, max=%d)",
        _redact(url),
        dest,
        connections,
        limit,
    )
    t0 = time.monotonic()

    total = 0
    ranges_ok = False
    if connections > 1:
        try:
            with _http_client(httpx, 60.0) as client:
                probe = client.get(url, headers={"Range": "bytes=0-0"})
                _reject_redirect(probe.status_code, url)
                if probe.status_code == 206:
                    cr = probe.headers.get("Content-Range", "")  # bytes 0-0/12345
                    if "/" in cr:
                        total = int(cr.split("/")[-1])
                        ranges_ok = total > 0
        except RuntimeError:
            raise
        except Exception as e:  # noqa: BLE001
            log.info(
                "download: range probe failed (%s); single stream",
                safe_error_message(e),
            )

    if ranges_ok and total > limit:
        raise RuntimeError(
            f"download too large: {total} bytes > max_bytes={limit} "
            f"({_redact(url)})"
        )

    if not ranges_ok or total < _MIN_RANGE_BYTES:
        _download_stream(url, dest, max_bytes=limit)
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

    written_lock = threading.Lock()
    written_total = 0

    def fetch(start: int, end: int) -> None:
        nonlocal written_total
        expected = end - start + 1
        got = 0
        with _http_client(httpx, 600.0) as client:
            with client.stream(
                "GET", url, headers={"Range": f"bytes={start}-{end}"}
            ) as r:
                # Parallel parts must be true Range (206) responses.
                if r.status_code != 206:
                    _check_response_status(r, url, httpx)
                    raise RuntimeError(
                        f"range fetch expected 206 got {r.status_code} "
                        f"({_redact(url)})"
                    )
                with dest.open("r+b") as f:
                    f.seek(start)
                    for ch in r.iter_bytes(8 * 1024 * 1024):
                        n = len(ch)
                        got += n
                        if got > expected:
                            raise RuntimeError(
                                f"range fetch overshot expected={expected} "
                                f"got>={got} ({_redact(url)})"
                            )
                        with written_lock:
                            written_total += n
                            if written_total > limit:
                                raise RuntimeError(
                                    f"download exceeded max_bytes={limit} "
                                    f"({_redact(url)})"
                                )
                        f.write(ch)
        if got != expected:
            raise RuntimeError(
                f"range fetch undershot expected={expected} got={got} "
                f"({_redact(url)})"
            )

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(chunks)) as ex:
            futs = [ex.submit(fetch, s, e) for s, e in chunks]
            for fu in concurrent.futures.as_completed(futs):
                fu.result()
        if dest.stat().st_size != total:
            raise RuntimeError(
                f"download size mismatch: expected={total} "
                f"got={dest.stat().st_size} ({_redact(url)})"
            )
    except Exception as e:  # noqa: BLE001
        dest.unlink(missing_ok=True)
        raise RuntimeError(
            f"download failed ({_redact(url)}): {safe_error_message(e)}"
        ) from None

    elapsed = time.monotonic() - t0
    speed = (total / elapsed / 1024 / 1024) if elapsed else 0
    log.info(
        "download(done): %d bytes in %.1fs (%.1f MB/s, %d conns)",
        total,
        elapsed,
        speed,
        len(chunks),
    )


def _download_stream(url: str, dest: Path, *, max_bytes: int) -> None:
    httpx = _httpx()
    t0 = time.monotonic()
    written = 0
    try:
        with _http_client(httpx, 300.0) as client:
            with client.stream("GET", url) as r:
                _check_response_status(r, url, httpx)
                cl = r.headers.get("Content-Length")
                if cl is not None and int(cl) > max_bytes:
                    raise RuntimeError(
                        f"download too large: Content-Length={cl} > max_bytes={max_bytes} "
                        f"({_redact(url)})"
                    )
                with dest.open("wb") as f:
                    for chunk in r.iter_bytes(65536):
                        written += len(chunk)
                        if written > max_bytes:
                            raise RuntimeError(
                                f"download exceeded max_bytes={max_bytes} "
                                f"({_redact(url)})"
                            )
                        f.write(chunk)
    except RuntimeError:
        dest.unlink(missing_ok=True)
        raise
    except Exception as e:  # noqa: BLE001
        dest.unlink(missing_ok=True)
        raise RuntimeError(
            f"download failed ({_redact(url)}): {safe_error_message(e)}"
        ) from None
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
    """PUT local file to `url`. Supports `file://` (gated + allowlisted) and HTTP(S)."""
    local_path = Path(local_path)
    size = local_path.stat().st_size

    if url.startswith("file://"):
        dst = _resolve_file_url(url, for_write=True)
        dst.parent.mkdir(parents=True, exist_ok=True)
        log.info("upload(local): %s -> %s (%d bytes)", local_path, dst, size)
        shutil.copy(local_path, dst)
        return

    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError(f"unsupported URL scheme: {_redact(url)}")

    httpx = _httpx()
    log.info("upload(start): %s (%d bytes) -> %s", local_path, size, _redact(url))
    last_safe: str | None = None
    for i in range(attempts):
        try:
            # Stream from disk — detections.json can be 100–200 MiB for long matches.
            with local_path.open("rb") as body:
                with _http_client(httpx, 300.0) as client:
                    r = client.put(
                        url,
                        content=body,
                        headers={
                            "Content-Type": content_type,
                            "Content-Length": str(size),
                        },
                    )
                    # 3xx is not success when redirects are disabled.
                    _reject_redirect(r.status_code, url)
                    if r.status_code >= 400:
                        raise httpx.HTTPStatusError(
                            f"HTTP {r.status_code}",
                            request=r.request,
                            response=r,
                        )
            log.info("upload(done): %d bytes", size)
            return
        except Exception as e:  # noqa: BLE001
            last_safe = safe_error_message(e)
            if not _upload_retryable(e, httpx):
                log.error("upload(permanent): %s", last_safe)
                raise RuntimeError(
                    f"upload failed ({_redact(url)}): {last_safe}"
                ) from None
            log.warning("upload(retry %d/%d): %s", i + 1, attempts, last_safe)
            time.sleep(min(2**i, 30))
    raise RuntimeError(
        f"upload failed after {attempts} attempts ({_redact(url)}): {last_safe}"
    )


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
            with _http_client(httpx, 30.0) as client:
                resp = client.post(url, json=payload, headers=headers)
            _reject_redirect(resp.status_code, url)
            if resp.status_code < 500:
                level = log.info if resp.status_code < 400 else log.warning
                level("callback: HTTP %d %s", resp.status_code, resp.text[:300])
                return resp.status_code
            log.warning(
                "callback(retry %d/%d): HTTP %d", i + 1, attempts, resp.status_code
            )
        except RuntimeError as e:
            # Redirect policy — do not retry 3xx.
            log.error("callback(permanent): %s", safe_error_message(e))
            return None
        except httpx.HTTPError as e:
            log.warning(
                "callback(retry %d/%d): %s", i + 1, attempts, safe_error_message(e)
            )
        time.sleep(min(2**i, 30))
    log.error(
        "callback(failed): gave up after %d attempts (%s)",
        attempts,
        _redact(url),
    )
    return None
