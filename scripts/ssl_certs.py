"""Ensure stdlib HTTPS has a usable CA bundle.

macOS python.org installs leave
``/Library/Frameworks/Python.framework/Versions/.../etc/openssl/cert.pem``
empty until ``Install Certificates.command`` is run, which makes
``urllib`` fail with ``CERTIFICATE_VERIFY_FAILED: unable to get local
issuer certificate``.

Call :func:`ensure_ssl_certs` (or import this module) before HTTPS.
"""

from __future__ import annotations

import os
import ssl
from functools import lru_cache


def _file_nonempty(path: str | None) -> bool:
    return bool(path) and os.path.isfile(path) and os.path.getsize(path) > 0


def _candidate_ca_files() -> list[str]:
    out: list[str] = []
    env = os.environ.get("SSL_CERT_FILE")
    if env:
        out.append(env)
    try:
        import certifi

        out.append(certifi.where())
    except ImportError:
        pass
    out.extend(
        [
            "/opt/homebrew/etc/openssl@3/cert.pem",
            "/opt/homebrew/etc/ca-certificates/cert.pem",
            "/usr/local/etc/openssl@3/cert.pem",
            "/etc/ssl/certs/ca-certificates.crt",
            "/etc/pki/tls/certs/ca-bundle.crt",
        ]
    )
    # de-dupe, preserve order
    seen: set[str] = set()
    uniq: list[str] = []
    for p in out:
        if p and p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


@lru_cache(maxsize=1)
def ensure_ssl_certs() -> str | None:
    """Point the default HTTPS context at a real CA bundle if needed.

    Returns the CA file path used, or None if the runtime already had one
    (or no candidate was found).
    """
    paths = ssl.get_default_verify_paths()
    if _file_nonempty(paths.cafile) or _file_nonempty(paths.openssl_cafile):
        return None

    for ca in _candidate_ca_files():
        if not _file_nonempty(ca):
            continue
        os.environ.setdefault("SSL_CERT_FILE", ca)
        # Capture ca in default-arg so the lambda does not close over the loop var.
        ssl._create_default_https_context = (  # type: ignore[assignment]
            lambda cafile=ca: ssl.create_default_context(cafile=cafile)
        )
        return ca
    return None


# Auto-run on import so any script that imports this (or ops_stage) is fixed.
ensure_ssl_certs()
