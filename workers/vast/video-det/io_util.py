"""HTTP / local file I/O for the detect job server.

Simple contract: stream download, stream upload, callback POST.
`file://` is only for local autoscaler benchmarks (ALLOW_FILE_URLS=1).
Redirects are never followed — 3xx is a hard error (B2/S3 presigns do not redirect).
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger("video-det.io")

_UPLOAD_ATTEMPTS = 5
_CALLBACK_ATTEMPTS = 5

# Default cap: ~2 GiB video (override via env).
MAX_DOWNLOAD_BYTES = int(os.environ.get("MAX_DOWNLOAD_BYTES", str(2 * 1024**3)))

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
    """Roots allowed for file:// reads when ALLOW_FILE_URLS=1."""
    return _dedupe_roots(
        [
            Path("/app").resolve(),
            Path("/tmp").resolve(),
            Path(tempfile.gettempdir()).resolve(),
        ]
    )


def _file_url_write_roots() -> list[Path]:
    """Roots allowed for file:// writes (temp only — never /app)."""
    return _dedupe_roots(
        [
            Path("/tmp").resolve(),
            Path(tempfile.gettempdir()).resolve(),
        ]
    )


def _resolve_file_url(url: str, *, for_write: bool = False) -> Path:
    """Parse file:// URL, require ALLOW_FILE_URLS, enforce root allowlist."""
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
    raise RuntimeError(f"file:// {kind} path outside allowlist {roots}: {path}")


def _httpx():
    import httpx

    return httpx


def _http_client(httpx_mod, timeout: float):
    """Shared client defaults: no redirect follow (SSRF surface)."""
    return httpx_mod.Client(timeout=timeout, follow_redirects=False)


def _reject_redirect(status_code: int, url: str) -> None:
    if 300 <= status_code < 400:
        raise RuntimeError(
            f"HTTP {status_code} redirect not allowed "
            f"(follow_redirects=False) ({_redact(url)})"
        )


def _check_response_status(response, url: str, httpx_mod) -> None:
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
    *,
    max_bytes: int | None = None,
) -> None:
    """Download `url` to `dest` (single HTTP stream or file:// copy)."""
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

    httpx = _httpx()
    log.info("download(start): %s -> %s (max=%d)", _redact(url), dest, limit)
    t0 = time.monotonic()
    written = 0
    try:
        with _http_client(httpx, 300.0) as client:
            with client.stream("GET", url) as r:
                _check_response_status(r, url, httpx)
                cl = r.headers.get("Content-Length")
                if cl is not None and int(cl) > limit:
                    raise RuntimeError(
                        f"download too large: Content-Length={cl} > max_bytes={limit} "
                        f"({_redact(url)})"
                    )
                with dest.open("wb") as f:
                    for chunk in r.iter_bytes(65536):
                        written += len(chunk)
                        if written > limit:
                            raise RuntimeError(
                                f"download exceeded max_bytes={limit} "
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
        "download(done): %d bytes in %.1fs (%.1f MB/s)",
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
    """PUT local file to `url` (streamed from disk)."""
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
    attempts: int = _CALLBACK_ATTEMPTS,
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
