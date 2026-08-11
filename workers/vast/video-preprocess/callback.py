"""Job result callback: allowlist + POST with short retries."""

from __future__ import annotations

import logging
import os
import time

import requests

from io_util import retriable_http, sanitize_error

log = logging.getLogger("video-preprocess.callback")


def callback_allowed(url: str | None) -> bool:
    """Fail-closed: callback_url must start with CALLBACK_URL_PREFIX."""
    if not url:
        return True
    prefix = (os.environ.get("CALLBACK_URL_PREFIX") or "").rstrip("/")
    if not prefix:
        return False
    return url.startswith(prefix + "/") or url == prefix


def post_callback(url: str, token: str | None, payload: dict) -> None:
    """POST success/failed payload. Raises if all retries fail.

    Call from the job thread, not the request task. A failed callback must
    fail the job so the pipeline does not sit stuck in ``processing``.

    Retry policy matches uploads: network / 5xx / 408 / 429. Other 4xx
    (auth, stale token, conflict) are terminal.
    """
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    last_err: Exception | None = None
    for i in range(3):
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=30)
            if 200 <= r.status_code < 300:
                log.info("callback: HTTP %d", r.status_code)
                return
            if not retriable_http(r.status_code):
                raise RuntimeError(
                    f"callback HTTP {r.status_code}: {(r.text or '')[:200]}"
                )
            last_err = RuntimeError(f"callback HTTP {r.status_code}")
            log.warning("callback retry %d: HTTP %d", i + 1, r.status_code)
        except requests.RequestException as e:
            last_err = e
            log.warning("callback retry %d: %s", i + 1, sanitize_error(e))
        time.sleep(2 ** i)
    raise RuntimeError(f"callback failed after retries: {sanitize_error(last_err)}")
