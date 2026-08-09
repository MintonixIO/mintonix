"""Job result callback: allowlist + POST with short retries."""

from __future__ import annotations

import logging
import os
import time

import requests

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
    """POST success/failed payload. Call from the job thread, not the request task."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    for i in range(3):
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=30)
            if r.status_code < 500:
                log.info("callback: HTTP %d", r.status_code)
                return
            log.warning("callback retry %d: HTTP %d", i + 1, r.status_code)
        except requests.RequestException as e:
            log.warning("callback retry %d: %s", i + 1, e)
        time.sleep(2 ** i)
    log.error("callback: gave up")
