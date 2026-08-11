"""Download and upload. Presigned URLs only — no storage credentials."""

from __future__ import annotations

import concurrent.futures
import logging
import math
import os
import shutil
import time
from urllib.parse import urlparse

import requests

log = logging.getLogger("video-preprocess.io")

UPLOAD_ATTEMPTS = int(os.environ.get("UPLOAD_ATTEMPTS", "5"))
UL_CONNECTIONS = int(os.environ.get("UL_CONNECTIONS", "4"))
MULTIPART_PART_SIZE = int(os.environ.get("MULTIPART_PART_SIZE", str(64 * 1024 * 1024)))


def _redact(url: str) -> str:
    try:
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}{p.path}"
    except Exception:
        return "<url>"


def sanitize_error(err: object) -> str:
    import re
    text = re.sub(
        r"https?://[^\s\"'<>]+",
        lambda m: _redact(m.group(0).rstrip(".,);]\"'")),
        str(err),
    )
    return text[:500]


def _retriable_http(code: int) -> bool:
    return code >= 500 or code in (408, 429)


def is_youtube_url(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


def is_file_url(url: str) -> bool:
    return isinstance(url, str) and url.startswith("file://")


def is_local_input(url: str) -> bool:
    """True for file:// inputs (local debug / sample paths)."""
    return is_file_url(url)


def resolve_path_mode(input_url: str) -> str:
    """BWF vs user from input URL.

    - YouTube → bwf (catalog court-cut path)
    - B2 / other remote / local file → user (full-timeline encode)
    """
    if is_youtube_url(input_url):
        return "bwf"
    return "user"


def download(url: str, dest: str) -> None:
    if url.startswith("file://"):
        src = urlparse(url).path
        log.info("download(file): %s", src)
        shutil.copy(src, dest)
        return
    log.info("download: %s", _redact(url))
    last_err: Exception | None = None
    for i in range(UPLOAD_ATTEMPTS):
        try:
            with requests.get(url, stream=True, timeout=600) as r:
                if not (200 <= r.status_code < 300):
                    if not _retriable_http(r.status_code):
                        raise RuntimeError(f"download HTTP {r.status_code} {_redact(url)}")
                    last_err = RuntimeError(f"download HTTP {r.status_code}")
                else:
                    with open(dest, "wb") as f:
                        for chunk in r.iter_content(8 * 1024 * 1024):
                            if chunk:
                                f.write(chunk)
                    log.info("download(done): %d bytes", os.path.getsize(dest))
                    return
        except requests.RequestException as e:
            last_err = e
        log.warning(
            "download(retry %d/%d): %s", i + 1, UPLOAD_ATTEMPTS, sanitize_error(last_err),
        )
        if i + 1 < UPLOAD_ATTEMPTS:
            time.sleep(min(2 ** i, 30))
    raise RuntimeError(f"download failed: {sanitize_error(last_err)}")


def download_youtube(url: str, dest_dir: str) -> str:
    """Fetch YouTube with yt-dlp (≤1080p preferred). Requires deno for n-challenge."""
    import yt_dlp

    log.info("download(youtube): %s", _redact(url))
    deno = shutil.which("deno") or (
        os.path.expanduser("~/.deno/bin/deno")
        if os.path.isfile(os.path.expanduser("~/.deno/bin/deno"))
        else None
    )
    opts: dict = {
        "format": "bv*[height<=1080]+ba/b",
        "merge_output_format": "mkv",
        "outtmpl": {"default": os.path.join(dest_dir, "source.%(ext)s")},
        "quiet": True,
        "no_warnings": True,
        "retries": 5,
    }
    if deno:
        opts["js_runtimes"] = {"deno": {"path": deno}}
    else:
        log.warning("download(youtube): deno not found — YouTube n-challenge may fail")
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    files = [
        os.path.join(dest_dir, f)
        for f in os.listdir(dest_dir)
        if f.startswith("source.") and not f.endswith(".part")
    ]
    if not files:
        raise RuntimeError("yt-dlp produced no file")
    path = max(files, key=os.path.getsize)
    log.info("download(youtube,done): %s (%d bytes)", path, os.path.getsize(path))
    return path


def upload(local_path: str, url: str) -> None:
    """PUT with retries on 5xx/408/429/network. Other 4xx are terminal.

    ``file://`` is always allowed (local debug / sample paths).
    """
    if url.startswith("file://"):
        dst = urlparse(url).path
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        shutil.copy(local_path, dst)
        log.info("upload(file): %s", dst)
        return
    size = os.path.getsize(local_path)
    log.info("upload: %s (%d bytes) -> %s", local_path, size, _redact(url))
    last_err: Exception | None = None
    for i in range(UPLOAD_ATTEMPTS):
        try:
            with open(local_path, "rb") as f:
                r = requests.put(url, data=f, timeout=1200)
            if 200 <= r.status_code < 300:
                log.info("upload(done)")
                return
            if not _retriable_http(r.status_code):
                raise RuntimeError(f"upload HTTP {r.status_code} {_redact(url)}")
            last_err = RuntimeError(f"upload HTTP {r.status_code}")
        except requests.RequestException as e:
            last_err = e
        log.warning(
            "upload(retry %d/%d): %s", i + 1, UPLOAD_ATTEMPTS, sanitize_error(last_err),
        )
        if i + 1 < UPLOAD_ATTEMPTS:
            time.sleep(min(2 ** i, 30))
    raise RuntimeError(f"upload failed: {sanitize_error(last_err)}")


def upload_multipart(local_path: str, spec: dict) -> None:
    """Parallel multipart upload with per-part and complete retries."""
    part_size = int(spec.get("part_size") or MULTIPART_PART_SIZE)
    part_urls = spec["part_urls"]
    complete_url = spec["complete_url"]
    abort_url = spec.get("abort_url")
    size = os.path.getsize(local_path)
    nparts = max(1, math.ceil(size / part_size))
    if nparts > len(part_urls):
        raise RuntimeError(f"multipart needs {nparts} parts, got {len(part_urls)}")
    log.info("upload(multipart): %d parts x %d MB", nparts, part_size // 1024 // 1024)

    def put_part(n: int) -> tuple[int, str]:
        start = (n - 1) * part_size
        length = min(part_size, size - start)
        last_err: Exception | None = None
        for attempt in range(UPLOAD_ATTEMPTS):
            try:
                with open(local_path, "rb") as f:
                    f.seek(start)
                    data = f.read(length)
                r = requests.put(part_urls[n - 1], data=data, timeout=600)
                if 200 <= r.status_code < 300:
                    etag = r.headers.get("ETag")
                    if not etag:
                        raise RuntimeError(f"multipart part {n}: no ETag")
                    return n, etag
                if not _retriable_http(r.status_code):
                    raise RuntimeError(f"multipart part {n}: HTTP {r.status_code}")
                last_err = RuntimeError(f"HTTP {r.status_code}")
            except requests.RequestException as e:
                last_err = e
            log.warning(
                "upload(multipart part %d retry %d/%d): %s",
                n, attempt + 1, UPLOAD_ATTEMPTS, sanitize_error(last_err),
            )
            if attempt + 1 < UPLOAD_ATTEMPTS:
                time.sleep(min(2 ** attempt, 30))
        raise RuntimeError(
            f"multipart part {n} failed: {sanitize_error(last_err)}"
        )

    try:
        workers = max(1, min(UL_CONNECTIONS, nparts))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            etags = list(ex.map(put_part, range(1, nparts + 1)))
        etags.sort()
        body = "<CompleteMultipartUpload>" + "".join(
            f"<Part><PartNumber>{n}</PartNumber><ETag>{e}</ETag></Part>"
            for n, e in etags
        ) + "</CompleteMultipartUpload>"
        last_err = None
        for attempt in range(UPLOAD_ATTEMPTS):
            try:
                r = requests.post(
                    complete_url, data=body,
                    headers={"Content-Type": "application/xml"}, timeout=300,
                )
                if 200 <= r.status_code < 300:
                    if "<Error>" in (r.text or ""):
                        raise RuntimeError(f"multipart complete error: {r.text[:200]}")
                    log.info("upload(multipart,done)")
                    return
                if not _retriable_http(r.status_code):
                    raise RuntimeError(f"multipart complete HTTP {r.status_code}")
                last_err = RuntimeError(f"HTTP {r.status_code}")
            except requests.RequestException as e:
                last_err = e
            log.warning(
                "upload(multipart complete retry %d/%d): %s",
                attempt + 1, UPLOAD_ATTEMPTS, sanitize_error(last_err),
            )
            if attempt + 1 < UPLOAD_ATTEMPTS:
                time.sleep(min(2 ** attempt, 30))
        raise RuntimeError(f"multipart complete failed: {sanitize_error(last_err)}")
    except Exception:
        if abort_url:
            try:
                requests.delete(abort_url, timeout=60)
            except Exception:
                pass
        raise


def put_object(local_path: str, dest: dict | str) -> None:
    """Upload normalized delivery video.

    Production: multipart dict ``{part_urls, complete_url, abort_url, part_size}``.
    Local debug: ``file://…`` string (copy). Single-PUT HTTPS is not supported.
    """
    if isinstance(dest, dict):
        upload_multipart(local_path, dest)
        return
    if isinstance(dest, str) and dest.startswith("file://"):
        upload(local_path, dest)
        return
    raise RuntimeError(
        "output_upload must be a multipart spec "
        "({part_urls, complete_url, abort_url, part_size}) or a file:// path"
    )
