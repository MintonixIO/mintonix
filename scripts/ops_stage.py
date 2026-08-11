"""Stage control helpers + ops edge HTTP client.

Keep STAGE_OUTPUTS in sync with supabase/functions/ops/stage_outputs.ts and
ARCHITECTURE.md § One job contract / Stage artifacts.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

# macOS python.org CA fix for urllib (no-op when certs already present).
import ssl_certs  # noqa: F401

# Stage ↔ B2 artifact map.
# Regression *to* stage S deletes S outputs and every later stage's outputs.
# original.* and annotation.json are never purged by stage control.
STAGE_ORDER = ("normalize", "detect", "analyze")
STAGE_OUTPUTS: dict[str, tuple[str, ...]] = {
    "normalize": (
        "normalized.mp4",
        "thumbnail.jpg",
        "preprocess-log.json",
    ),
    "detect": ("detections.json",),
    "analyze": ("analysis.json",),
}
# Completeness probes (primary evidence object per stage).
STAGE_PRIMARY: dict[str, str] = {
    "normalize": "normalized.mp4",
    "detect": "detections.json",
    "analyze": "analysis.json",
}
KEEP_ON_REGRESS = frozenset({
    "original.mp4", "original.mov", "original.mkv", "annotation.json",
})

# Edge codes for purge/stage partial failures (return as dict, do not raise).
OPS_PARTIAL_CODES = frozenset({
    "cdn_list_failed",
    "cdn_delete_failed",
    "purge_ok_enqueue_failed",
    "rpc_error",
})


def outputs_to_purge(stage: str) -> list[str]:
    """Basenames deleted when regressing *to* `stage` (stage + all later)."""
    if stage not in STAGE_ORDER:
        raise ValueError(f"unknown stage: {stage}")
    idx = STAGE_ORDER.index(stage)
    names: list[str] = []
    seen: set[str] = set()
    for s in STAGE_ORDER[idx:]:
        for n in STAGE_OUTPUTS[s]:
            if n not in seen:
                seen.add(n)
                names.append(n)
    return names


def stage_completeness(basenames: set[str] | list[str]) -> dict[str, str]:
    """Map stage → '✓' | '✗' | '—' (present / missing / no probe)."""
    bases = set(basenames)
    out: dict[str, str] = {}
    for stage in STAGE_ORDER:
        primary = STAGE_PRIMARY.get(stage)
        if not primary:
            out[stage] = "—"
        elif primary in bases:
            out[stage] = "✓"
        else:
            out[stage] = "✗"
    return out


def basenames_from_keys(keys: list[str], prefix: str) -> set[str]:
    """Basenames strictly under prefix (no last-segment fallback for off-prefix keys)."""
    out: set[str] = set()
    for key in keys:
        if not key.startswith(prefix):
            continue
        rel = key[len(prefix):]
        if rel and "/" not in rel:
            out.add(rel)
    return out


def preview_purge_targets(
    keys: list[str],
    prefix: str,
    stage: str,
) -> list[str]:
    """Prefix-bound keys that would be deleted when regressing to `stage`."""
    want = set(outputs_to_purge(stage))
    targets: list[str] = []
    for key in keys:
        if not key.startswith(prefix):
            continue
        rel = key[len(prefix):]
        if rel and "/" not in rel and rel in want:
            targets.append(key)
    return targets


def format_ops_partial_guidance(result: dict[str, Any]) -> list[str]:
    """Human lines when stage may already be set but purge/enqueue failed."""
    code = result.get("code") or result.get("error") or "unknown"
    lines = [
        f"Partial ops failure  code={code}  http={result.get('http_status', '?')}",
        "",
    ]
    if result.get("stage_set"):
        lines.append(
            f"Stage already set  stage={result.get('stage')}  "
            f"job={result.get('job_id')}  enqueue={result.get('enqueue')}"
        )
        lines.append("Dispatch will not run until the job is enqueued (msg_id set).")
    purged = result.get("purged") or []
    if purged:
        lines.append(f"B2 purged so far: {len(purged)} key(s)")
        for k in purged[:12]:
            lines.append(f"  • {k}")
        if len(purged) > 12:
            lines.append(f"  … and {len(purged) - 12} more")
    if result.get("enqueue_pending"):
        lines.append("Enqueue was requested but not applied yet (purge incomplete).")
    if result.get("purge_ok"):
        lines.append("Purge finished; enqueue RPC failed — re-run Set stage with enqueue=yes.")
    lines += [
        "",
        "Recovery:",
        "  1. Inspect B2 objects for this match",
        "  2. Re-run Set stage… (stage is set; purge is idempotent on missing keys)",
        "  3. Use enqueue=yes only after purge looks clean",
    ]
    if code in ("cdn_list_failed", "cdn_delete_failed"):
        lines.append("  CDN/presign may be down — check PRESIGN_SERVICE_TOKEN + CDN_PRESIGN_URL")
    return lines


def _http_body_is_structured(status: int, body: dict[str, Any]) -> bool:
    """True when edge returned a parseable reject/partial payload (do not raise)."""
    if status == 409:
        return True
    if status not in (500, 502):
        return False
    if body.get("stage_set") is True:
        return True
    if body.get("code") in OPS_PARTIAL_CODES:
        return True
    if body.get("purge_ok") is True:
        return True
    return False


def ops_set_stage(
    *,
    ops_url: str,
    pipeline_token: str,
    user_agent: str,
    match_id: str,
    stage: str,
    enqueue: bool = True,
    cancel_live: bool = True,
    purge: bool = False,
    timeout: float = 120,
) -> dict[str, Any]:
    """Call ops edge /set-stage.

    Returns the JSON body on 2xx. On 409 (live_processing reject) and on
    structured 502/500 partial failures (stage_set / purge codes), returns the
    parsed body with ok=false so the TUI can show recovery without treating it
    as a bare transport failure. Other HTTP errors raise RuntimeError.
    """
    body: dict[str, Any] = {
        "match_id": match_id,
        "stage": stage,
        "enqueue": enqueue,
        "cancel_live": cancel_live,
        "purge": purge,
    }
    data = json.dumps(body).encode()
    hdrs = {
        "User-Agent": user_agent,
        "Content-Type": "application/json",
        "x-pipeline-token": pipeline_token,
    }
    req = urllib.request.Request(ops_url, method="POST", data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        try:
            parsed = json.loads(detail) if detail else {}
        except json.JSONDecodeError:
            parsed = {}
        if isinstance(parsed, dict) and _http_body_is_structured(e.code, parsed):
            parsed.setdefault("ok", False)
            if e.code == 409:
                parsed.setdefault("rejected", True)
            parsed.setdefault("http_status", e.code)
            return parsed
        raise RuntimeError(
            f"HTTP {e.code} on POST {ops_url}: {detail[:400]}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error on POST {ops_url}: {e.reason}") from e
