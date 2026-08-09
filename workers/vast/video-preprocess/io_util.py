"""Download and upload. Presigned URLs only — no storage credentials."""

from __future__ import annotations

import logging
import math
import os
import shutil
import time
from urllib.parse import urlparse

import requests

log = logging.getLogger("video-preprocess.io")
UPLOAD_ATTEMPTS = 5


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


def is_youtube_url(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


def _allow_file(url: str) -> bool:
    if os.environ.get("ALLOW_FILE_URLS", "0").lower() in ("1", "true", "yes"):
        return True
    path = urlparse(url).path or ""
    if path in ("/app/sample.mp4", "/app/sample.mov"):
        return True
    base = os.path.basename(path)
    return path.startswith("/tmp/") and base.startswith("benchmark_") and base.endswith(".mp4")


def download(url: str, dest: str) -> None:
    if url.startswith("file://"):
        if not _allow_file(url):
            raise RuntimeError("file:// disabled (set ALLOW_FILE_URLS=1)")
        src = urlparse(url).path
        log.info("download(file): %s", src)
        shutil.copy(src, dest)
        return
    log.info("download: %s", _redact(url))
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8 * 1024 * 1024):
                if chunk:
                    f.write(chunk)
    log.info("download(done): %d bytes", os.path.getsize(dest))


def download_youtube(url: str, dest_dir: str) -> str:
    import yt_dlp

    log.info("download(youtube): %s", _redact(url))
    # yt-dlp YouTube n-challenge needs a JS runtime (deno preferred) + EJS scripts.
    deno = shutil.which("deno") or (
        os.path.expanduser("~/.deno/bin/deno")
        if os.path.isfile(os.path.expanduser("~/.deno/bin/deno"))
        else None
    )
    opts: dict = {
        # Prefer ≤1080p video+audio (annotation geometry is usually 1080p).
        "format": "bv*[height<=1080]+ba/b",
        "merge_output_format": "mkv",
        "outtmpl": {"default": os.path.join(dest_dir, "source.%(ext)s")},
        "quiet": True,
        "no_warnings": True,
        "retries": 5,
    }
    if deno:
        opts["js_runtimes"] = {"deno": {"path": deno}}
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
    log.info("download(youtube,done): %s", path)
    return path


def upload(local_path: str, url: str) -> None:
    if url.startswith("file://"):
        if not _allow_file(url):
            raise RuntimeError("file:// disabled (set ALLOW_FILE_URLS=1)")
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
            if r.status_code < 500 and r.status_code not in (408, 429):
                raise RuntimeError(f"upload HTTP {r.status_code} {_redact(url)}")
            last_err = RuntimeError(f"upload HTTP {r.status_code}")
        except requests.RequestException as e:
            last_err = e
        time.sleep(min(2 ** i, 30))
    raise RuntimeError(f"upload failed: {sanitize_error(last_err)}")


def upload_multipart(local_path: str, spec: dict) -> None:
    part_size = int(spec.get("part_size") or 64 * 1024 * 1024)
    part_urls = spec["part_urls"]
    complete_url = spec["complete_url"]
    abort_url = spec.get("abort_url")
    size = os.path.getsize(local_path)
    nparts = max(1, math.ceil(size / part_size))
    if nparts > len(part_urls):
        raise RuntimeError(f"multipart needs {nparts} parts, got {len(part_urls)}")
    log.info("upload(multipart): %d parts", nparts)
    etags: list[tuple[int, str]] = []
    try:
        for n in range(1, nparts + 1):
            start = (n - 1) * part_size
            length = min(part_size, size - start)
            with open(local_path, "rb") as f:
                f.seek(start)
                data = f.read(length)
            r = requests.put(part_urls[n - 1], data=data, timeout=600)
            r.raise_for_status()
            etag = r.headers.get("ETag")
            if not etag:
                raise RuntimeError(f"multipart part {n}: no ETag")
            etags.append((n, etag))
        body = "<CompleteMultipartUpload>" + "".join(
            f"<Part><PartNumber>{n}</PartNumber><ETag>{e}</ETag></Part>"
            for n, e in etags
        ) + "</CompleteMultipartUpload>"
        r = requests.post(
            complete_url, data=body,
            headers={"Content-Type": "application/xml"}, timeout=300,
        )
        r.raise_for_status()
        if "<Error>" in (r.text or ""):
            raise RuntimeError(f"multipart complete error: {r.text[:200]}")
        log.info("upload(multipart,done)")
    except Exception:
        if abort_url:
            try:
                requests.delete(abort_url, timeout=60)
            except Exception:
                pass
        raise


def put_object(
    local_path: str, *, url: str | None = None, multipart: dict | None = None,
) -> None:
    if multipart:
        upload_multipart(local_path, multipart)
    elif url:
        upload(local_path, url)
    else:
        raise RuntimeError("no upload destination")
