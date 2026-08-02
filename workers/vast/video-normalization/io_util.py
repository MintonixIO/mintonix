"""I/O: download, upload (with retries), multipart, callback.

Provider-neutral — no platform SDKs. Imported by normalize facade and job.
"""

from __future__ import annotations

import concurrent.futures
import logging
import math
import os
import shutil
import threading
import time
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter

log = logging.getLogger("video-normalization")

DOWNLOAD_PROGRESS_INTERVAL_SEC = 5.0

# Single-stream transfers to/from object storage (B2) top out around ~27 MB/s
# regardless of the host link (measured on a 1.2 Gbps host). Parallelism — many
# byte-ranges on download, many multipart parts on upload — is what reaches line
# rate. Tunable via env.
DL_CONNECTIONS = int(os.environ.get("DL_CONNECTIONS", "8"))
UL_CONNECTIONS = int(os.environ.get("UL_CONNECTIONS", "8"))
# Parallel range download once the object is at least this large (16 MiB default).
DL_MIN_PARALLEL_BYTES = int(
    os.environ.get("DL_MIN_PARALLEL_BYTES", str(16 * 1024 * 1024))
)
# S3/B2 require every multipart part except the last to be >= 5 MiB.
MULTIPART_PART_SIZE = int(os.environ.get("MULTIPART_PART_SIZE", str(64 * 1024 * 1024)))

# Single PUT retries after expensive encode (mirror video-det / post_callback).
UPLOAD_ATTEMPTS = int(os.environ.get("UPLOAD_ATTEMPTS", "5"))


def _session(pool: int) -> requests.Session:
    """A requests.Session whose connection pool is wide enough for `pool`
    concurrent transfers (default pool_maxsize is 10, which would serialize
    extra threads), with a few retries on transient errors."""
    s = requests.Session()
    adapter = HTTPAdapter(pool_connections=pool, pool_maxsize=pool, max_retries=3)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    return s


def _redact(url: str) -> str:
    """Host + path only (no query/signature). Includes scheme for clarity."""
    try:
        parsed = urlparse(url)
    except Exception:
        return "<unparseable-url>"
    scheme = f"{parsed.scheme}://" if parsed.scheme else ""
    return f"{scheme}{parsed.netloc}{parsed.path}"


def sanitize_error(err: object) -> str:
    """Strip presigned query strings / signatures from exception text before
    callback or HTTP response so secrets never land in jobs.error.

    Handles absolute URLs, urllib3-style relative forms (`url: /path?X-Amz-…`),
    and bare `X-Amz-*` / signature query fragments.
    """
    import re
    text = str(err)
    # Absolute http(s) URL with query → path only via _redact.
    text = re.sub(
        r"https?://[^\s\"'<>]+",
        lambda m: _redact(m.group(0).rstrip(".,);]\"'")),
        text,
    )
    # Relative path + query (urllib3: "Max retries exceeded with url: /k?sig=")
    text = re.sub(
        r"(/[^\s\"'<>?]*)\?[^\s\"'<>]*",
        r"\1",
        text,
    )
    # Any remaining signature query fragments.
    text = re.sub(
        r"(?i)([?&](?:X-Amz-[A-Za-z0-9_-]+|Signature|sig|token|Expires)=)[^&\s\"']+",
        r"\1<redacted>",
        text,
    )
    return text[:500]


def _env_truthy(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


# Stock PyWorker BenchmarkConfig uses local file:// without ALLOW_FILE_URLS:
#   input  file:///app/sample.mov  (or BENCHMARK_INPUT_URL)
#   output file:///tmp/benchmark_<hex>.mp4
# Path-scoped allowlist covers those only; arbitrary file:// still needs
# ALLOW_FILE_URLS=1 (tests / local CLI).
_DEFAULT_BENCHMARK_INPUT = "file:///app/sample.mov"
_BENCHMARK_OUTPUT_SUFFIX = ".mp4"


def _file_url_path(url: str) -> str:
    """Absolute path from a file:// URL (normalized; no host/netloc)."""
    try:
        path = urlparse(url).path or ""
    except Exception:
        path = url[len("file://"):] if url.startswith("file://") else ""
    return os.path.normpath(path) if path else ""


def _is_benchmark_file_path(path: str) -> bool:
    """True for the stock benchmark input and /tmp/benchmark_*.mp4 outputs."""
    if not path:
        return False
    allowed_inputs = {"/app/sample.mov"}
    bench_in = os.environ.get("BENCHMARK_INPUT_URL", _DEFAULT_BENCHMARK_INPUT)
    if bench_in.startswith("file://"):
        p = _file_url_path(bench_in)
        if p:
            allowed_inputs.add(p)
    if path in allowed_inputs:
        return True
    # Output: /tmp/benchmark_<uuid>.mp4 (basename only; reject traversal)
    if not path.startswith("/tmp/"):
        return False
    base = os.path.basename(path)
    return (
        base.startswith("benchmark_")
        and base.endswith(_BENCHMARK_OUTPUT_SUFFIX)
        and path == f"/tmp/{base}"
    )


def _check_url_policy(url: str, *, kind: str = "io") -> None:
    """Enforce file:// / host allowlists for production-hardened envelopes.

    file://: ALLOW_FILE_URLS=1 allows any path (tests/local CLI). Otherwise
    only path-scoped benchmark paths are allowed (/app/sample.mov or
    BENCHMARK_INPUT_URL, and /tmp/benchmark_*.mp4) so stock deploy capacity
    benchmarks work without opening arbitrary local RW.
    ALLOWED_HTTP_HOSTS=host1,host2 optionally pins http(s) destinations.
    Env is read per call so tests can toggle without reimport.
    """
    if url.startswith("file://"):
        if _env_truthy("ALLOW_FILE_URLS", "0"):
            return
        if _is_benchmark_file_path(_file_url_path(url)):
            return
        raise RuntimeError(
            f"{kind}: file:// URLs disabled (set ALLOW_FILE_URLS=1 for "
            "local tests, or use benchmark paths "
            f"{_DEFAULT_BENCHMARK_INPUT} / file:///tmp/benchmark_*.mp4)"
        )
    allowed = {
        h.strip().lower()
        for h in os.environ.get("ALLOWED_HTTP_HOSTS", "").split(",")
        if h.strip()
    }
    if not allowed:
        return
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        host = ""
    if host not in allowed:
        raise RuntimeError(
            f"{kind}: host '{host or '?'}' not in ALLOWED_HTTP_HOSTS"
        )


def _retriable_http(status: int) -> bool:
    """Retry 5xx, 408 Request Timeout, 429 Too Many Requests — not other 4xx."""
    return status >= 500 or status in (408, 429)


def _http_status_error(status: int, url: str, kind: str = "upload") -> RuntimeError:
    """Safe error without embedding the full presigned URL."""
    return RuntimeError(f"{kind} HTTP {status} for {_redact(url)}")


def _download_stream(url: str, dest: str, sess: requests.Session) -> None:
    """Single-connection streaming download (fallback when the server doesn't
    support Range requests)."""
    t0 = time.time()
    written = 0
    last_emit = 0.0
    try:
        with sess.get(url, stream=True, timeout=300) as r:
            if not (200 <= r.status_code < 300):
                raise _http_status_error(r.status_code, url, kind="download")
            total = int(r.headers.get("Content-Length", 0))
            log.info("download(content-length): %d bytes (%.1f MB)", total, total / 1024 / 1024)
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                    f.write(chunk)
                    written += len(chunk)
                    now = time.time()
                    if now - last_emit >= DOWNLOAD_PROGRESS_INTERVAL_SEC:
                        last_emit = now
                        elapsed = now - t0
                        pct = (written / total * 100) if total else None
                        speed = (written / elapsed / 1024 / 1024) if elapsed else 0
                        msg = f"download: {written / 1024 / 1024:.1f} MB"
                        if pct is not None:
                            msg += f" ({pct:.1f}%)"
                        log.info(msg + f" @ {speed:.1f} MB/s")
    except requests.RequestException as e:
        raise RuntimeError(
            f"download failed: {type(e).__name__}: {sanitize_error(e)}"
        ) from None
    elapsed = time.time() - t0
    speed = (written / elapsed / 1024 / 1024) if elapsed else 0
    log.info("download(done,single): %d bytes in %.1fs (%.1f MB/s)", written, elapsed, speed)


_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


def is_youtube_url(url: str) -> bool:
    """True for YouTube URLs — sources the worker acquires itself with yt-dlp.
    The scraper only discovers URLs and enqueues jobs; nothing upstream of the
    worker (a GitHub runner) ever moves video bytes."""
    try:
        p = urlparse(url)
    except ValueError:
        return False
    return p.scheme in ("http", "https") and (p.hostname or "").lower() in _YOUTUBE_HOSTS


def download_youtube(url: str, dest_dir: str) -> str:
    """Fetch a YouTube source with yt-dlp (best video+audio, merged to MKV)
    into `dest_dir` and return the downloaded file's path."""
    import yt_dlp  # deferred: only youtube-sourced jobs need it

    t0 = time.time()
    last_emit = [0.0]

    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        now = time.time()
        if now - last_emit[0] < DOWNLOAD_PROGRESS_INTERVAL_SEC:
            return
        last_emit[0] = now
        got = d.get("downloaded_bytes") or 0
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        pct = f" ({got / total * 100:.1f}%)" if total else ""
        speed = (d.get("speed") or 0) / 1024 / 1024
        log.info("download(youtube): %.1f MB%s @ %.1f MB/s", got / 1024 / 1024, pct, speed)

    opts = {
        "format": "bv*+ba/b",
        "merge_output_format": "mkv",
        "outtmpl": {"default": os.path.join(dest_dir, "source.%(ext)s")},
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "retries": 5,
    }
    log.info("download(youtube,start): %s", _redact(url))
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    candidates = [os.path.join(dest_dir, f) for f in os.listdir(dest_dir)
                  if f.startswith("source.") and not f.endswith(".part")]
    if not candidates:
        raise RuntimeError("yt-dlp reported success but produced no source file")
    path = max(candidates, key=os.path.getsize)
    log.info("download(youtube,done): %s (%.1f MB) in %.1fs", os.path.basename(path),
             os.path.getsize(path) / 1024 / 1024, time.time() - t0)
    return path


def download(url: str, dest: str, connections: int | None = None) -> None:
    """Download `url` to `dest`, in parallel byte-ranges when the server
    supports them (S3/B2 presigned GETs do), else a single stream."""
    _check_url_policy(url, kind="download")
    if url.startswith("file://"):
        src = url[len("file://"):]
        size = os.path.getsize(src)
        log.info("download(local): %s -> %s (%d bytes)", src, dest, size)
        shutil.copy(src, dest)
        return

    connections = connections or DL_CONNECTIONS
    log.info("download(start): %s -> %s (%d conns)", _redact(url), dest, connections)
    sess = _session(connections)

    # Probe size + Range support with a tiny range request.
    total = 0
    ranges_ok = False
    if connections > 1:
        try:
            probe = sess.get(url, headers={"Range": "bytes=0-0"}, stream=True, timeout=60)
            if probe.status_code == 206:
                cr = probe.headers.get("Content-Range", "")  # "bytes 0-0/12345"
                total = int(cr.split("/")[-1]) if "/" in cr else 0
                ranges_ok = total > 0
            probe.close()
        except Exception as e:  # noqa: BLE001
            log.info("download: range probe failed (%s), falling back to single stream",
                     sanitize_error(e))

    # Too small to bother splitting, or no Range support -> single stream.
    if not ranges_ok or total < DL_MIN_PARALLEL_BYTES:
        _download_stream(url, dest, sess)
        return

    log.info("download(content-length): %d bytes (%.1f MB), %d ranges",
             total, total / 1024 / 1024, connections)
    with open(dest, "wb") as f:
        f.truncate(total)

    part = math.ceil(total / connections)
    chunks = [(i * part, min((i + 1) * part, total) - 1)
              for i in range(connections) if i * part < total]

    t0 = time.time()
    done = [0]
    last_emit = [0.0]
    lock = threading.Lock()

    def fetch(start: int, end: int) -> None:
        expected = end - start + 1
        got = 0
        try:
            r = sess.get(url, headers={"Range": f"bytes={start}-{end}"},
                         stream=True, timeout=600)
            # Parallel parts must be true Range responses. A 200 full body
            # written at an offset would corrupt the sparse pre-truncated file.
            if r.status_code != 206:
                raise _http_status_error(r.status_code, url, kind="download")
            with open(dest, "r+b") as f:
                f.seek(start)
                for ch in r.iter_content(chunk_size=8 * 1024 * 1024):
                    n = len(ch)
                    got += n
                    if got > expected:
                        raise RuntimeError(
                            f"range fetch overshot expected={expected} got>={got} "
                            f"({sanitize_error(url)})"
                        )
                    f.write(ch)
                    with lock:
                        done[0] += n
                        now = time.time()
                        if now - last_emit[0] >= DOWNLOAD_PROGRESS_INTERVAL_SEC:
                            last_emit[0] = now
                            el = now - t0
                            sp = (done[0] / el / 1024 / 1024) if el else 0
                            log.info("download: %.1f MB (%.1f%%) @ %.1f MB/s",
                                     done[0] / 1024 / 1024, done[0] / total * 100, sp)
            if got != expected:
                raise RuntimeError(
                    f"range fetch undershot expected={expected} got={got} "
                    f"({sanitize_error(url)})"
                )
        except requests.RequestException as e:
            raise RuntimeError(
                f"download range failed: {type(e).__name__}: {sanitize_error(e)}"
            ) from None

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=connections) as ex:
            futs = [ex.submit(fetch, s, e) for s, e in chunks]
            for fu in concurrent.futures.as_completed(futs):
                fu.result()  # re-raise the first failure
    except Exception:
        try:
            os.unlink(dest)
        except OSError:
            pass
        raise

    final_size = os.path.getsize(dest)
    if final_size != total:
        try:
            os.unlink(dest)
        except OSError:
            pass
        raise RuntimeError(
            f"download size mismatch: expected={total} got={final_size} "
            f"({sanitize_error(url)})"
        )

    elapsed = time.time() - t0
    speed = (total / elapsed / 1024 / 1024) if elapsed else 0
    log.info("download(done): %d bytes in %.1fs (%.1f MB/s, %d conns)",
             total, elapsed, speed, connections)


def upload(local_path: str, url: str, attempts: int | None = None) -> None:
    """PUT local file to `url`. Retries 5xx/network/408/429 with exponential
    backoff so a B2 blip after a long NVENC encode does not force a full re-run.
    Other 4xx (expired presign, 403) are terminal — retrying cannot fix them."""
    _check_url_policy(url, kind="upload")
    if url.startswith("file://"):
        dst = url[len("file://"):]
        size = os.path.getsize(local_path)
        log.info("upload(local): %s -> %s (%d bytes)", local_path, dst, size)
        parent = os.path.dirname(dst)
        if parent:
            os.makedirs(parent, exist_ok=True)
        shutil.copy(local_path, dst)
        return

    size = os.path.getsize(local_path)
    attempts = attempts if attempts is not None else UPLOAD_ATTEMPTS
    log.info("upload(start): %s (%d bytes, %.1f MB) -> %s (attempts=%d)",
             local_path, size, size / 1024 / 1024, _redact(url), attempts)

    last_err: Exception | None = None
    t0 = time.time()
    for i in range(attempts):
        try:
            with open(local_path, "rb") as f:
                resp = requests.put(url, data=f, timeout=1200)
            code = resp.status_code
            if 200 <= code < 300:
                elapsed = time.time() - t0
                speed = (size / elapsed / 1024 / 1024) if elapsed else 0
                log.info("upload(done,single): %d bytes in %.1fs (%.1f MB/s)",
                         size, elapsed, speed)
                return
            err = _http_status_error(code, url)
            if not _retriable_http(code):
                log.warning("upload(terminal): %s", err)
                raise err
            last_err = err
            log.warning("upload(retry %d/%d): %s", i + 1, attempts, err)
        except requests.RequestException as e:
            # Connection errors / timeouts — retriable; never log raw URL.
            last_err = RuntimeError(f"upload network error: {type(e).__name__}")
            log.warning("upload(retry %d/%d): %s", i + 1, attempts,
                        sanitize_error(last_err))
        except OSError as e:
            last_err = RuntimeError(f"upload I/O error: {type(e).__name__}")
            log.warning("upload(retry %d/%d): %s", i + 1, attempts,
                        sanitize_error(last_err))
        if i + 1 < attempts:
            time.sleep(min(2 ** i, 30))
    raise RuntimeError(
        f"upload failed after {attempts} attempts: {sanitize_error(last_err)}"
    )


def upload_multipart(local_path: str, spec: dict) -> None:
    """Parallel S3/B2 multipart upload using orchestrator-presigned URLs.

    `spec` carries only presigned URLs — the worker holds no storage
    credentials. Shape:
        { "part_urls": [<presigned UploadPart>, ...],   # 1-based: part_urls[0] is part 1
          "complete_url": <presigned CompleteMultipartUpload>,
          "abort_url":    <presigned AbortMultipartUpload>,   # optional but recommended
          "part_size":    <bytes> }                            # optional; defaults to env
    Uploads parts concurrently, then POSTs the completion XML. On any failure it
    POSTs the abort URL so the incomplete upload doesn't linger (and bill) on B2.
    Part PUTs inherit session retries; completion is retried like single PUT.
    """
    part_size = int(spec.get("part_size") or MULTIPART_PART_SIZE)
    part_urls = spec["part_urls"]
    complete_url = spec["complete_url"]
    abort_url = spec.get("abort_url")

    # Same host / file:// policy as single-stream upload (ALLOWED_HTTP_HOSTS).
    for i, part_url in enumerate(part_urls):
        _check_url_policy(part_url, kind=f"multipart part {i + 1}")
    _check_url_policy(complete_url, kind="multipart complete")
    if abort_url:
        _check_url_policy(abort_url, kind="multipart abort")

    size = os.path.getsize(local_path)
    nparts = max(1, math.ceil(size / part_size))
    if nparts > len(part_urls):
        raise RuntimeError(
            f"multipart: output needs {nparts} parts ({size} B / {part_size} B) "
            f"but only {len(part_urls)} presigned part URLs were provided"
        )

    log.info("upload(start,multipart): %d bytes (%.1f MB) -> %s (%d parts x %d MB, %d conns)",
             size, size / 1024 / 1024, _redact(complete_url),
             nparts, part_size // 1024 // 1024, UL_CONNECTIONS)

    sess = _session(UL_CONNECTIONS)
    t0 = time.time()

    def put_part(n: int) -> tuple[int, str]:
        start = (n - 1) * part_size
        length = min(part_size, size - start)
        part_url = part_urls[n - 1]
        last_err: Exception | None = None
        for attempt in range(UPLOAD_ATTEMPTS):
            try:
                with open(local_path, "rb") as f:
                    f.seek(start)
                    data = f.read(length)
                r = sess.put(part_url, data=data, timeout=600)
                code = r.status_code
                if 200 <= code < 300:
                    etag = r.headers.get("ETag")
                    if not etag:
                        raise RuntimeError(f"multipart: part {n} returned no ETag")
                    return n, etag
                err = _http_status_error(code, part_url, kind=f"multipart part {n}")
                if not _retriable_http(code):
                    raise err
                last_err = err
            except requests.RequestException as e:
                last_err = RuntimeError(
                    f"multipart part {n} network error: {type(e).__name__}"
                )
            log.warning("upload(multipart part %d retry %d/%d): %s",
                        n, attempt + 1, UPLOAD_ATTEMPTS, sanitize_error(last_err))
            if attempt + 1 < UPLOAD_ATTEMPTS:
                time.sleep(min(2 ** attempt, 30))
        raise RuntimeError(
            f"multipart: part {n} failed after retries: {sanitize_error(last_err)}"
        )

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=UL_CONNECTIONS) as ex:
            results = list(ex.map(put_part, range(1, nparts + 1)))
        results.sort()
        parts_xml = "".join(
            f"<Part><PartNumber>{n}</PartNumber><ETag>{etag}</ETag></Part>"
            for n, etag in results
        )
        body = f"<CompleteMultipartUpload>{parts_xml}</CompleteMultipartUpload>"
        last_err = None
        for attempt in range(UPLOAD_ATTEMPTS):
            try:
                r = sess.post(complete_url, data=body,
                              headers={"Content-Type": "application/xml"}, timeout=300)
                code = r.status_code
                if 200 <= code < 300:
                    if "<Error>" in r.text:
                        raise RuntimeError(
                            f"multipart complete failed: {r.text[:200]}"
                        )
                    break
                err = _http_status_error(code, complete_url, kind="multipart complete")
                if not _retriable_http(code):
                    raise err
                last_err = err
            except requests.RequestException as e:
                last_err = RuntimeError(
                    f"multipart complete network error: {type(e).__name__}"
                )
            log.warning("upload(multipart complete retry %d/%d): %s",
                        attempt + 1, UPLOAD_ATTEMPTS, sanitize_error(last_err))
            if attempt + 1 >= UPLOAD_ATTEMPTS:
                raise RuntimeError(
                    f"multipart complete failed after retries: "
                    f"{sanitize_error(last_err)}"
                )
            time.sleep(min(2 ** attempt, 30))
    except Exception:
        if abort_url:
            try:
                sess.delete(abort_url, timeout=60)
                log.info("upload(multipart): aborted incomplete upload after failure")
            except Exception as ae:  # noqa: BLE001
                log.warning("upload(multipart): abort failed: %s",
                            sanitize_error(ae))
        raise

    elapsed = time.time() - t0
    speed = (size / elapsed / 1024 / 1024) if elapsed else 0
    log.info("upload(done,multipart): %d bytes in %.1fs (%.1f MB/s, %d parts, %d conns)",
             size, elapsed, speed, nparts, UL_CONNECTIONS)


def post_callback(url: str, token: str | None, payload: dict,
                  attempts: int = 5) -> int | None:
    """POST a job result to the dispatcher's callback endpoint.

    The token is the single-use HMAC capability the dispatcher put in the job
    envelope — echoed back as a Bearer header, same capability-passing pattern
    as the presigned URLs (the worker holds no long-lived credential). Must be
    called from the job's own thread: the dispatching client disconnects long
    before the job ends, and this is the only report that reaches the pipeline.

    Retries 5xx/network errors with backoff — an unreported *successful* job
    would otherwise be re-run wholesale when the queue's visibility timeout
    expires. A 4xx is terminal (stale/rejected token; retrying can't fix it).
    Returns the final HTTP status, or None if every attempt failed.
    """
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    for i in range(attempts):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=30)
            if resp.status_code < 500:
                level = log.info if resp.status_code < 400 else log.warning
                level("callback(%s): HTTP %d %s", _redact(url),
                      resp.status_code, resp.text[:300])
                return resp.status_code
            log.warning("callback(retry %d/%d): HTTP %d", i + 1, attempts,
                        resp.status_code)
        except requests.RequestException as e:
            log.warning("callback(retry %d/%d): %s", i + 1, attempts,
                        f"{type(e).__name__}: {sanitize_error(e)}")
        time.sleep(min(2 ** i, 30))
    log.error("callback(failed): gave up after %d attempts", attempts)
    return None
