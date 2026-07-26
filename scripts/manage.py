#!/usr/bin/env python3
"""Mintonix backend — terminal ops app.

Full-screen TUI for the match pipeline. Switch freely between DEV and PROD.
Edit all secrets & variables from the Settings page.

    python3 scripts/manage.py
    python3 scripts/manage.py --prod

Keys
  ↑↓ / j k     move
  Enter        select / confirm
  Esc / q      back (quit from home)
  e            switch environment (from home)
  ,            open Settings
  o s u r      browse: origin / status / source / refresh

Match detail (stage control)
  Inspect B2, Set stage… (pick stage; optional purge; optional enqueue)
  via ops edge. Dual truth: jobs.stage vs B2 objects.

Queue / ingest only enqueue (pgmq). Dispatch is automatic (pg_cron every
minute → /jobs/dispatch). Home still has an emergency “Force dispatch”.

Reconcile
  Diffs B2 ↔ Supabase (orphans either side + asset/status drift)
  and offers fix actions (delete, re-queue, set status).

Secrets (per environment):
  ~/.mintonix/dev-secrets.env
  ~/.mintonix/prod-secrets.env
"""

from __future__ import annotations

import curses
import json
import os
import stat
import subprocess
import sys
import textwrap
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

import ops_stage as _ops_stage
from ops_stage import (
    KEEP_ON_REGRESS,
    STAGE_ORDER,
    STAGE_PRIMARY,
    basenames_from_keys,
    format_ops_partial_guidance,
    outputs_to_purge,
    preview_purge_targets,
    stage_completeness,
)

# ─── environments ─────────────────────────────────────────────────────────────

SECRETS_DIR = os.path.expanduser("~/.mintonix")


@dataclass(frozen=True)
class EnvProfile:
    name: str  # "dev" | "prod"
    label: str  # "DEV" | "PROD"
    project_ref: str
    default_supabase_url: str
    default_cdn_presign: str
    is_prod: bool = False

    @property
    def secrets_path(self) -> str:
        return os.path.join(SECRETS_DIR, f"{self.name}-secrets.env")

    @property
    def short_host(self) -> str:
        return self.project_ref[:12]


# CDN custom domains (cdn-dev.mintonix.com / cdn.mintonix.com) are optional and
# may not have DNS yet. Defaults use the always-on workers.dev hostnames from
# wrangler [env.*.name] + account workers subdomain. Override via CDN_PRESIGN_URL
# once custom domains are live.
PROFILES: dict[str, EnvProfile] = {
    "dev": EnvProfile(
        name="dev",
        label="DEV",
        project_ref="xaxyuytvgcdbdnndhgwj",
        default_supabase_url="https://xaxyuytvgcdbdnndhgwj.supabase.co",
        default_cdn_presign="https://mintonix-cdn-dev.peterouyang14.workers.dev/presign",
        is_prod=False,
    ),
    "prod": EnvProfile(
        name="prod",
        label="PROD",
        project_ref="grkaepnplgotsxdudlfn",
        default_supabase_url="https://grkaepnplgotsxdudlfn.supabase.co",
        default_cdn_presign="https://mintonix-cdn.peterouyang14.workers.dev/presign",
        is_prod=True,
    ),
}

# Cloudflare blocks bare Python-urllib User-Agents (error 1010) on workers.dev.
HTTP_USER_AGENT = "Mintonix-manager/1.0 (+scripts/manage.py)"

KNOWN_BASENAMES = (
    "original.mp4", "original.mov", "original.mkv", "annotation.json",
    "normalized.mp4", "thumbnail.jpg", "valid.mp4", "frame_manifest.csv",
    "scores.csv", "detections.json", "analysis.json",
)

MATCH_SELECT = (
    "id,owner_id,source_url,tournament,match_date,status,created_at,"
    "team1_player1,team1_player2,team2_player1,team2_player2,"
    "g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2"
)
METADATA_COLS = (
    "source_url", "tournament", "match_date",
    "team1_player1", "team1_player2", "team2_player1", "team2_player2",
    "g1_t1", "g1_t2", "g2_t1", "g2_t2", "g3_t1", "g3_t2",
)


# ─── secret field schema (Settings page) ──────────────────────────────────────


@dataclass(frozen=True)
class SecretField:
    key: str
    label: str
    category: str
    required: bool = False
    secret: bool = True
    help: str = ""
    aliases: tuple[str, ...] = ()


SECRET_FIELDS: list[SecretField] = [
    # ── required pipeline ──
    SecretField(
        "PIPELINE_SERVICE_TOKEN", "Pipeline service token", "Required · Pipeline",
        required=True, secret=True,
        help="x-pipeline-token for matches-ingest, /ops/set-stage, and emergency dispatch.",
    ),
    SecretField(
        "SUPABASE_SERVICE_ROLE_KEY", "Supabase service role key", "Required · Pipeline",
        required=True, secret=True,
        help="Service-role JWT for REST (bypasses RLS). Prefer this over anon.",
        aliases=("SUPABASE_SERVICE_KEY",),
    ),
    SecretField(
        "PRESIGN_SERVICE_TOKEN", "CDN presign service token", "Required · Pipeline",
        required=True, secret=True,
        help="Bearer token for CDN Worker /presign (LIST / DELETE / PUT).",
    ),
    # ── endpoints ──
    SecretField(
        "SUPABASE_URL", "Supabase URL", "Endpoints · Overrides",
        required=False, secret=False,
        help="Leave blank to use the built-in project URL for this env.",
    ),
    SecretField(
        "CDN_PRESIGN_URL", "CDN presign URL", "Endpoints · Overrides",
        required=False, secret=False,
        help="Leave blank for workers.dev defaults. Use https://cdn-dev.mintonix.com/presign once DNS is live.",
    ),
    # ── ingest ──
    SecretField(
        "SUPABASE_ANON_KEY", "Supabase anon key", "Ingest · User upload",
        required=False, secret=True,
        help="Public anon key. Needed for user-upload (test user) ingest.",
    ),
    SecretField(
        "SUPABASE_TEST_EMAIL", "Test user email", "Ingest · User upload",
        required=False, secret=False,
        help="Email for the test account used by local-file ingest.",
    ),
    SecretField(
        "SUPABASE_TEST_PASSWORD", "Test user password", "Ingest · User upload",
        required=False, secret=True,
        help="Password for the test account.",
    ),
    # ── infrastructure ──
    SecretField(
        "VAST_API_KEY", "Vast API key", "Infrastructure · Optional",
        required=False, secret=True,
        help="Vast.ai key (workers; not required for enqueue-only ops).",
    ),
    SecretField(
        "CLOUDFLARE_API_TOKEN", "Cloudflare API token", "Infrastructure · Optional",
        required=False, secret=True,
        help="CF API token for Worker deploys / CDN ops.",
    ),
    SecretField(
        "CLOUDFLARE_ACCOUNT_ID", "Cloudflare account id", "Infrastructure · Optional",
        required=False, secret=False,
        help="Cloudflare account identifier.",
    ),
    SecretField(
        "SUPABASE_DB_PASSWORD", "Database password", "Infrastructure · Optional",
        required=False, secret=True,
        help="Postgres password (optional; not used by this TUI).",
        aliases=("SUPABASE_DB_PASSWORD_DEV", "SUPABASE_DB_PASSWORD_PROD"),
    ),
]

SECRET_FIELD_BY_KEY = {f.key: f for f in SECRET_FIELDS}
MANAGED_KEYS = {f.key for f in SECRET_FIELDS} | {
    a for f in SECRET_FIELDS for a in f.aliases
}


# Color pairs
C_HEADER = 1
C_FOOTER = 2
C_SEL = 3
C_DIM = 4
C_OK = 5
C_ERR = 6
C_WARN = 7
C_TITLE = 8
C_ACCENT = 9
C_ENV_DEV = 10
C_ENV_PROD = 11
C_PANEL = 12
C_MUTED = 13
C_BORDER = 14
C_NUM = 15
C_HEADER_PROD = 16
C_CHIP = 17
C_CHIP_ON = 18
C_INPUT = 19
C_SECTION = 20


# ─── secrets / HTTP ───────────────────────────────────────────────────────────


def load_secrets_file(path: str) -> dict[str, str]:
    secrets: dict[str, str] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    secrets[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return secrets


def load_secrets(env: EnvProfile) -> dict[str, str]:
    """Load secrets for one environment.

    Priority (highest last):
      1. ~/.mintonix/{dev|prod}-secrets.env
      2. Unprefixed process env (fills gaps only — won't override the file)
      3. Prefixed process env, e.g. PROD_PIPELINE_SERVICE_TOKEN (always wins)
    """
    secrets = load_secrets_file(env.secrets_path)
    prefix = env.name.upper() + "_"
    for k, v in os.environ.items():
        if not v:
            continue
        if k.startswith(prefix):
            secrets[k[len(prefix):]] = v
        elif k.startswith("DEV_") or k.startswith("PROD_"):
            continue  # belongs to the other environment
        elif k not in secrets:
            secrets[k] = v
    return secrets


def field_value(secrets: dict[str, str], field: SecretField) -> str:
    if secrets.get(field.key):
        return secrets[field.key]
    for a in field.aliases:
        if secrets.get(a):
            return secrets[a]
    return ""


def set_field_value(secrets: dict[str, str], field: SecretField, value: str) -> None:
    """Write value under the canonical key; drop aliases so we don't double-store."""
    value = value.strip()
    for a in field.aliases:
        secrets.pop(a, None)
    if value:
        secrets[field.key] = value
    else:
        secrets.pop(field.key, None)


def save_secrets_file(env: EnvProfile, secrets: dict[str, str]) -> str:
    """Write a tidy secrets file for this environment. Returns path."""
    os.makedirs(SECRETS_DIR, mode=0o700, exist_ok=True)
    path = env.secrets_path
    lines: list[str] = [
        f"# Mintonix {env.label} secrets",
        f"# Project  {env.project_ref}",
        f"# Edited by scripts/manage.py Settings",
        f"# Defaults: {env.default_supabase_url}",
        f"#           {env.default_cdn_presign}",
        "",
    ]
    last_cat = None
    written: set[str] = set()
    for f in SECRET_FIELDS:
        if f.category != last_cat:
            if last_cat is not None:
                lines.append("")
            lines.append(f"# ── {f.category} ──")
            last_cat = f.category
        val = field_value(secrets, f)
        # Always emit known keys so the form stays stable
        if f.help:
            lines.append(f"# {f.help}")
        lines.append(f"{f.key}={val}")
        written.add(f.key)
        written.update(f.aliases)

    # Preserve any extra keys the user had (unmanaged)
    extras = {k: v for k, v in secrets.items() if k not in written and v}
    if extras:
        lines.append("")
        lines.append("# ── Other (preserved) ──")
        for k in sorted(extras):
            lines.append(f"{k}={extras[k]}")

    lines.append("")
    content = "\n".join(lines)
    # atomic-ish write
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(content)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)  # 0o600
    os.replace(tmp, path)
    return path


def mask_value(value: str, *, reveal: bool = False, keep: int = 4) -> str:
    if not value:
        return "— not set —"
    if reveal:
        return value
    if len(value) <= keep + 2:
        return "•" * len(value)
    return "•" * max(6, len(value) - keep) + value[-keep:]


def supabase_url(env: EnvProfile, secrets: dict[str, str]) -> str:
    return (secrets.get("SUPABASE_URL") or env.default_supabase_url).rstrip("/")


def functions_base(env: EnvProfile, secrets: dict[str, str]) -> str:
    return f"{supabase_url(env, secrets)}/functions/v1"


def cdn_presign_url(env: EnvProfile, secrets: dict[str, str]) -> str:
    return (secrets.get("CDN_PRESIGN_URL") or env.default_cdn_presign).rstrip("/")


def service_key(secrets: dict[str, str]) -> str:
    return (
        secrets.get("SUPABASE_SERVICE_ROLE_KEY")
        or secrets.get("SUPABASE_SERVICE_KEY")
        or ""
    )


def require(secrets: dict[str, str], *keys: str) -> None:
    miss = [k for k in keys if not secrets.get(k)]
    if miss:
        raise RuntimeError(f"Missing secret(s): {', '.join(miss)}")


def rest_headers(secrets: dict[str, str]) -> dict[str, str]:
    key = service_key(secrets)
    if not key:
        raise RuntimeError(
            "Need SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY in secrets file"
        )
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict | None = None,
    timeout: float = 60,
) -> Any:
    data = None if body is None else json.dumps(body).encode()
    hdrs = {"User-Agent": HTTP_USER_AGENT, **headers}
    req = urllib.request.Request(url, method=method, data=data, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        raise RuntimeError(f"HTTP {e.code} on {method} {url}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error on {method} {url}: {e.reason}") from e


def post_fn(
    env: EnvProfile, secrets: dict[str, str], path: str, headers: dict[str, str], body: dict,
) -> Any:
    return http_json(
        "POST",
        f"{functions_base(env, secrets)}{path}",
        {"Content-Type": "application/json", **headers},
        body,
    )


def fetch_matches(
    env: EnvProfile,
    secrets: dict[str, str],
    *,
    match_id: str | None = None,
    bwf_only: bool = False,
    user_only: bool = False,
    with_source: bool = False,
    status: str | None = None,
    limit: int | None = 100,
    offset: int = 0,
) -> list[dict]:
    params = [f"select={MATCH_SELECT}", "order=created_at.desc"]
    if match_id:
        params.append(f"id=eq.{urllib.parse.quote(match_id, safe='')}")
    if bwf_only:
        params.append("owner_id=is.null")
    if user_only:
        params.append("owner_id=not.is.null")
    if with_source:
        params.append("source_url=not.is.null")
    if status:
        params.append(f"status=eq.{urllib.parse.quote(status, safe='')}")
    if limit:
        params.append(f"limit={int(limit)}")
    if offset:
        params.append(f"offset={int(offset)}")
    url = f"{supabase_url(env, secrets)}/rest/v1/matches?{'&'.join(params)}"
    return http_json("GET", url, rest_headers(secrets)) or []


def fetch_all_matches(
    env: EnvProfile,
    secrets: dict[str, str],
    *,
    bwf_only: bool = False,
    user_only: bool = False,
    page_size: int = 1000,
    on_progress: Any = None,
) -> list[dict]:
    """Paginate through every matches row (service-role)."""
    out: list[dict] = []
    offset = 0
    while True:
        batch = fetch_matches(
            env, secrets,
            bwf_only=bwf_only,
            user_only=user_only,
            limit=page_size,
            offset=offset,
        )
        out.extend(batch)
        if on_progress:
            on_progress(len(out))
        if len(batch) < page_size:
            break
        offset += page_size
    return out


def patch_match(
    env: EnvProfile,
    secrets: dict[str, str],
    match_id: str,
    patch: dict[str, Any],
) -> list[dict]:
    url = (
        f"{supabase_url(env, secrets)}/rest/v1/matches"
        f"?id=eq.{urllib.parse.quote(match_id, safe='')}"
    )
    return http_json("PATCH", url, rest_headers(secrets), patch) or []


def delete_match_row(env: EnvProfile, secrets: dict[str, str], match_id: str) -> None:
    url = (
        f"{supabase_url(env, secrets)}/rest/v1/matches"
        f"?id=eq.{urllib.parse.quote(match_id, safe='')}"
    )
    http_json("DELETE", url, rest_headers(secrets))


def live_job_match_ids(env: EnvProfile, secrets: dict[str, str], match_ids: list[str]) -> set[str]:
    if not match_ids:
        return set()
    live: set[str] = set()
    for i in range(0, len(match_ids), 50):
        part = match_ids[i : i + 50]
        url = (
            f"{supabase_url(env, secrets)}/rest/v1/jobs"
            f"?select=match_id&status=in.(queued,processing)"
            f"&match_id=in.({','.join(part)})"
        )
        rows = http_json("GET", url, rest_headers(secrets)) or []
        live.update(r["match_id"] for r in rows)
    return live


def fetch_live_jobs(env: EnvProfile, secrets: dict[str, str], limit: int = 30) -> list[dict]:
    url = (
        f"{supabase_url(env, secrets)}/rest/v1/jobs"
        f"?select=id,match_id,status,stage,queue,attempt,error"
        f"&status=in.(queued,processing)&order=created_at.desc&limit={limit}"
    )
    return http_json("GET", url, rest_headers(secrets)) or []


def fetch_live_job_for_match(
    env: EnvProfile, secrets: dict[str, str], match_id: str,
) -> dict | None:
    url = (
        f"{supabase_url(env, secrets)}/rest/v1/jobs"
        f"?select=id,match_id,status,stage,queue,attempt,error,msg_id"
        f"&match_id=eq.{urllib.parse.quote(match_id, safe='')}"
        f"&status=in.(queued,processing)&order=created_at.desc&limit=1"
    )
    rows = http_json("GET", url, rest_headers(secrets)) or []
    return rows[0] if rows else None


def fetch_latest_job_for_match(
    env: EnvProfile, secrets: dict[str, str], match_id: str,
) -> dict | None:
    url = (
        f"{supabase_url(env, secrets)}/rest/v1/jobs"
        f"?select=id,match_id,status,stage,queue,attempt,error,created_at"
        f"&match_id=eq.{urllib.parse.quote(match_id, safe='')}"
        f"&order=created_at.desc&limit=1"
    )
    rows = http_json("GET", url, rest_headers(secrets)) or []
    return rows[0] if rows else None


def ops_set_stage(
    env: EnvProfile,
    secrets: dict[str, str],
    *,
    match_id: str,
    stage: str,
    enqueue: bool = True,
    cancel_live: bool = True,
    purge: bool = False,
) -> dict:
    """Call ops edge /set-stage (pipeline token). Thin wrapper around ops_stage."""
    require(secrets, "PIPELINE_SERVICE_TOKEN")
    return _ops_stage.ops_set_stage(
        ops_url=f"{functions_base(env, secrets)}/ops/set-stage",
        pipeline_token=secrets["PIPELINE_SERVICE_TOKEN"],
        user_agent=HTTP_USER_AGENT,
        match_id=match_id,
        stage=stage,
        enqueue=enqueue,
        cancel_live=cancel_live,
        purge=purge,
    )


def match_b2_prefix(owner_id: str | None, match_id: str) -> str:
    if owner_id:
        return f"users/{owner_id}/{match_id}/"
    return f"bwf/{match_id}/"


def cdn_control(env: EnvProfile, secrets: dict[str, str], body: dict) -> dict:
    require(secrets, "PRESIGN_SERVICE_TOKEN")
    return http_json(
        "POST",
        cdn_presign_url(env, secrets),
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secrets['PRESIGN_SERVICE_TOKEN']}",
        },
        body,
    )


def list_prefix_keys(
    env: EnvProfile,
    secrets: dict[str, str],
    prefix: str,
    *,
    on_page: Any = None,
) -> list[str]:
    keys: list[str] = []
    token: str | None = None
    page = 0
    while True:
        body: dict[str, Any] = {"op": "LIST", "prefix": prefix, "maxKeys": 1000}
        if token:
            body["continuationToken"] = token
        result = cdn_control(env, secrets, body)
        batch = result.get("keys") or []
        keys.extend(batch)
        page += 1
        if on_page:
            on_page(prefix, page, len(keys))
        if not result.get("isTruncated"):
            break
        token = result.get("nextContinuationToken")
        if not token:
            break
    return keys


def delete_b2_key(env: EnvProfile, secrets: dict[str, str], key: str, dry_run: bool) -> str:
    if dry_run:
        return "would-delete"
    signed = cdn_control(env, secrets, {"op": "DELETE", "key": key})
    req = urllib.request.Request(
        signed["url"],
        method="DELETE",
        headers={"User-Agent": HTTP_USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
            return f"ok ({resp.status})"
    except urllib.error.HTTPError as e:
        if e.code in (404, 204):
            return f"gone ({e.code})"
        raise RuntimeError(f"DELETE failed HTTP {e.code}") from e


def delete_b2_prefix(
    env: EnvProfile,
    secrets: dict[str, str],
    prefix: str,
    *,
    dry_run: bool,
    known_keys: list[str] | None = None,
) -> list[str]:
    """Delete all objects under prefix. Returns log lines."""
    log: list[str] = []
    try:
        keys = known_keys if known_keys is not None else list_prefix_keys(env, secrets, prefix)
    except Exception as e:
        log.append(f"LIST failed ({e}); using known basenames")
        keys = [prefix + n for n in KNOWN_BASENAMES]
    log.append(f"{len(keys)} object(s) under {prefix}")
    for key in keys:
        try:
            st = delete_b2_key(env, secrets, key, dry_run)
            log.append(f"  {st:12} {key}")
        except Exception as e:
            log.append(f"  FAILED       {key}  {e}")
    return log


# ─── B2 ↔ Supabase reconcile ──────────────────────────────────────────────────


@dataclass
class B2Entry:
    match_id: str
    owner_id: str | None
    prefix: str
    basenames: set[str] = field(default_factory=set)
    keys: list[str] = field(default_factory=list)

    @property
    def origin(self) -> str:
        return "user" if self.owner_id else "bwf"

    @property
    def object_count(self) -> int:
        return len(self.keys)


@dataclass
class DriftItem:
    match: dict
    b2: B2Entry | None
    expected_prefix: str
    issues: list[str]

    @property
    def match_id(self) -> str:
        return self.match["id"]


@dataclass
class ReconcileReport:
    b2_only: list[B2Entry] = field(default_factory=list)
    db_only: list[dict] = field(default_factory=list)
    drift: list[DriftItem] = field(default_factory=list)
    synced: int = 0
    db_total: int = 0
    b2_total: int = 0
    loose_keys: list[str] = field(default_factory=list)
    path_conflicts: list[str] = field(default_factory=list)

    @property
    def db_only_suspicious(self) -> list[dict]:
        """Rows where empty B2 is unexpected (ready/processing/failed, or no source)."""
        out = []
        for m in self.db_only:
            st = (m.get("status") or "").lower()
            if st in ("ready", "processing", "failed"):
                out.append(m)
            elif st == "pending" and not m.get("source_url") and not m.get("owner_id"):
                out.append(m)
        return out

    @property
    def db_only_expected(self) -> list[dict]:
        """Pending rows that may simply not have been processed yet."""
        sus = {id(m) for m in self.db_only_suspicious}
        return [m for m in self.db_only if id(m) not in sus]

    @property
    def problem_count(self) -> int:
        return len(self.b2_only) + len(self.db_only_suspicious) + len(self.drift)


def parse_b2_object_key(key: str) -> tuple[str | None, str | None, str | None]:
    """
    Parse a B2 object key into (match_id, owner_id, basename).
    owner_id is None for the BWF lane. Returns (None, None, None) if unrecognised.
    """
    parts = [p for p in key.split("/") if p != ""]
    if len(parts) >= 3 and parts[0] == "bwf":
        return parts[1], None, "/".join(parts[2:])
    if len(parts) >= 4 and parts[0] == "users":
        return parts[2], parts[1], "/".join(parts[3:])
    return None, None, None


def index_b2_matches(
    env: EnvProfile,
    secrets: dict[str, str],
    *,
    scopes: tuple[str, ...] = ("bwf", "users"),
    on_progress: Any = None,
) -> tuple[dict[str, B2Entry], list[str], list[str]]:
    """
    LIST bwf/ and/or users/ and group objects by match id.
    Returns (index_by_match_id, loose_keys, path_conflict_notes).
    """
    index: dict[str, B2Entry] = {}
    loose: list[str] = []
    conflicts: list[str] = []

    for scope in scopes:
        prefix = f"{scope}/"

        def _page(p: str, page: int, n: int, _scope: str = scope) -> None:
            if on_progress:
                on_progress(f"listing {_scope}/  page {page}  ·  {n} key(s)")

        keys = list_prefix_keys(env, secrets, prefix, on_page=_page)
        for key in keys:
            mid, oid, base = parse_b2_object_key(key)
            if not mid or not base:
                loose.append(key)
                continue
            expected = f"users/{oid}/{mid}/" if oid else f"bwf/{mid}/"
            if mid in index:
                existing = index[mid]
                if existing.prefix != expected:
                    conflicts.append(
                        f"{mid}: objects under both {existing.prefix} and {expected}"
                    )
                existing.keys.append(key)
                existing.basenames.add(base.split("/")[0] if base else base)
            else:
                entry = B2Entry(match_id=mid, owner_id=oid, prefix=expected)
                entry.keys.append(key)
                entry.basenames.add(base.split("/")[0] if base else base)
                index[mid] = entry
    return index, loose, conflicts


def diagnose_assets(
    match: dict,
    b2: B2Entry | None,
    expected_prefix: str,
) -> list[str]:
    """Return human-readable issues for a match present in Supabase."""
    issues: list[str] = []
    status = (match.get("status") or "?").lower()
    source = match.get("source_url")
    owner_id = match.get("owner_id")
    basenames = b2.basenames if b2 else set()
    has_norm = "normalized.mp4" in basenames
    has_thumb = "thumbnail.jpg" in basenames
    has_original = any(b.startswith("original.") for b in basenames)
    has_ann = "annotation.json" in basenames
    empty = not basenames

    if b2 and b2.prefix != expected_prefix:
        issues.append(f"path mismatch: B2={b2.prefix}  expected={expected_prefix}")

    if empty:
        if status == "ready":
            issues.append("status=ready but B2 empty")
        elif status == "processing":
            issues.append("status=processing but B2 empty")
        elif status == "failed":
            issues.append("status=failed and B2 empty (orphan DB row?)")
        elif status == "pending":
            if not source and not owner_id:
                issues.append("pending with no source_url and empty B2")
            # pending + source_url + empty is normal (not yet processed)
        else:
            issues.append(f"status={status} and B2 empty")
        return issues

    # Has objects
    if status == "ready":
        if not has_norm:
            issues.append("ready but missing normalized.mp4")
        if not has_thumb:
            issues.append("ready but missing thumbnail.jpg")
    elif status == "pending":
        if has_norm:
            issues.append("pending but normalized.mp4 present (consider set ready)")
        elif has_original or has_ann:
            issues.append("pending with partial assets (original/annotation) — re-queue?")
    elif status == "failed":
        if has_norm and has_thumb:
            issues.append("failed but looks complete (normalized+thumbnail) — set ready?")
    elif status == "processing":
        if has_norm and has_thumb:
            issues.append("processing but looks complete — may be stuck; set ready or re-queue")

    return issues


def build_reconcile_report(
    env: EnvProfile,
    secrets: dict[str, str],
    *,
    scope: str = "all",  # all | bwf | user
    on_progress: Any = None,
) -> ReconcileReport:
    if scope == "bwf":
        scopes: tuple[str, ...] = ("bwf",)
        bwf_only, user_only = True, False
    elif scope == "user":
        scopes = ("users",)
        bwf_only, user_only = False, True
    else:
        scopes = ("bwf", "users")
        bwf_only, user_only = False, False

    if on_progress:
        on_progress("loading Supabase matches…")
    db_rows = fetch_all_matches(
        env, secrets,
        bwf_only=bwf_only,
        user_only=user_only,
        on_progress=(lambda n: on_progress(f"loaded {n} DB match(es)…") if on_progress else None),
    )
    db_by_id = {r["id"]: r for r in db_rows}

    if on_progress:
        on_progress("listing B2 objects…")
    b2_index, loose, conflicts = index_b2_matches(
        env, secrets, scopes=scopes, on_progress=on_progress,
    )

    report = ReconcileReport(
        db_total=len(db_by_id),
        b2_total=len(b2_index),
        loose_keys=loose,
        path_conflicts=conflicts,
    )

    for mid, entry in sorted(b2_index.items()):
        if mid not in db_by_id:
            report.b2_only.append(entry)

    for mid, m in sorted(db_by_id.items(), key=lambda kv: kv[0]):
        expected = match_b2_prefix(m.get("owner_id"), mid)
        b2 = b2_index.get(mid)
        if b2 is None:
            report.db_only.append(m)
            continue
        issues = diagnose_assets(m, b2, expected)
        if issues:
            report.drift.append(DriftItem(
                match=m, b2=b2, expected_prefix=expected, issues=issues,
            ))
        else:
            report.synced += 1

    return report


def run_dispatch(
    env: EnvProfile,
    secrets: dict[str, str],
    *,
    max_jobs: int = 1,
    vt: int | None = None,
    max_running: int | None = None,
) -> dict:
    """Emergency manual drain. Steady-state is pg_cron → /jobs/dispatch."""
    require(secrets, "PIPELINE_SERVICE_TOKEN")
    body: dict[str, Any] = {"max": max_jobs}
    if vt is not None:
        body["vt"] = vt
    if max_running is not None:
        body["max_running"] = max_running
    return post_fn(
        env, secrets, "/jobs/dispatch",
        {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]},
        body,
    )


def queue_match(
    env: EnvProfile,
    secrets: dict[str, str],
    m: dict,
    *,
    queue: str = "jobs_bulk",
    priority: int = 100,
) -> dict:
    require(secrets, "PIPELINE_SERVICE_TOKEN")
    body: dict[str, Any] = {
        "id": m["id"], "upsert": True, "queue": queue, "priority": priority,
    }
    for col in METADATA_COLS:
        if m.get(col) is not None:
            body[col] = m[col]
    return post_fn(
        env, secrets, "/matches-ingest",
        {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]},
        body,
    )


def probe_connections(env: EnvProfile, secrets: dict[str, str]) -> list[tuple[str, bool, str]]:
    """Return list of (name, ok, detail) connection checks."""
    results: list[tuple[str, bool, str]] = []
    # REST
    try:
        if not service_key(secrets):
            results.append(("Supabase REST", False, "missing service role key"))
        else:
            url = f"{supabase_url(env, secrets)}/rest/v1/matches?select=id&limit=1"
            http_json("GET", url, rest_headers(secrets), timeout=12)
            results.append(("Supabase REST", True, supabase_url(env, secrets).replace("https://", "")))
    except Exception as e:
        results.append(("Supabase REST", False, str(e)[:80]))

    # CDN LIST (needs PRESIGN token)
    try:
        if not secrets.get("PRESIGN_SERVICE_TOKEN"):
            results.append(("CDN /presign", False, "missing PRESIGN_SERVICE_TOKEN"))
        else:
            cdn_control(env, secrets, {"op": "LIST", "prefix": "bwf/", "maxKeys": 1})
            results.append(("CDN /presign", True, cdn_presign_url(env, secrets).replace("https://", "")))
    except Exception as e:
        results.append(("CDN /presign", False, str(e)[:80]))

    # Pipeline token presence (can't fully verify without a side-effect call)
    if secrets.get("PIPELINE_SERVICE_TOKEN"):
        results.append(("Pipeline token", True, "present"))
    else:
        results.append(("Pipeline token", False, "missing PIPELINE_SERVICE_TOKEN"))

    return results


# ─── TUI core ─────────────────────────────────────────────────────────────────


class Cancel(Exception):
    pass


@dataclass
class App:
    stdscr: Any
    env: EnvProfile
    secrets: dict[str, str] = field(default_factory=dict)
    status: str = ""
    status_kind: str = "dim"
    colors: bool = False
    # draft secrets used while editing Settings (before Save)
    draft: dict[str, str] | None = None
    draft_dirty: bool = False

    def __post_init__(self) -> None:
        if not self.secrets:
            self.secrets = load_secrets(self.env)

    def reload_secrets(self) -> None:
        self.secrets = load_secrets(self.env)
        self.draft = None
        self.draft_dirty = False

    def switch_env(self, name: str) -> None:
        self.env = PROFILES[name]
        self.reload_secrets()

    def init_colors(self) -> None:
        if not curses.has_colors():
            return
        self.colors = True
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(C_HEADER, curses.COLOR_WHITE, curses.COLOR_BLUE)
        curses.init_pair(C_FOOTER, curses.COLOR_BLACK, curses.COLOR_WHITE)
        curses.init_pair(C_SEL, curses.COLOR_BLACK, curses.COLOR_CYAN)
        curses.init_pair(C_DIM, curses.COLOR_WHITE, -1)
        curses.init_pair(C_OK, curses.COLOR_GREEN, -1)
        curses.init_pair(C_ERR, curses.COLOR_RED, -1)
        curses.init_pair(C_WARN, curses.COLOR_YELLOW, -1)
        curses.init_pair(C_TITLE, curses.COLOR_CYAN, -1)
        curses.init_pair(C_ACCENT, curses.COLOR_MAGENTA, -1)
        curses.init_pair(C_ENV_DEV, curses.COLOR_BLACK, curses.COLOR_GREEN)
        curses.init_pair(C_ENV_PROD, curses.COLOR_WHITE, curses.COLOR_RED)
        curses.init_pair(C_PANEL, curses.COLOR_WHITE, curses.COLOR_BLACK)
        curses.init_pair(C_MUTED, curses.COLOR_WHITE, -1)
        curses.init_pair(C_BORDER, curses.COLOR_BLUE, -1)
        curses.init_pair(C_NUM, curses.COLOR_YELLOW, -1)
        curses.init_pair(C_HEADER_PROD, curses.COLOR_WHITE, curses.COLOR_RED)
        curses.init_pair(C_CHIP, curses.COLOR_BLACK, curses.COLOR_WHITE)
        curses.init_pair(C_CHIP_ON, curses.COLOR_BLACK, curses.COLOR_GREEN)
        curses.init_pair(C_INPUT, curses.COLOR_WHITE, curses.COLOR_BLACK)
        curses.init_pair(C_SECTION, curses.COLOR_MAGENTA, -1)
        try:
            curses.init_pair(C_MUTED, 8, -1)
        except curses.error:
            pass
        try:
            curses.init_pair(C_BORDER, 12, -1)
        except curses.error:
            pass
        try:
            curses.init_pair(C_SECTION, 13, -1)
        except curses.error:
            pass

    def attr(self, pair: int, bold: bool = False) -> int:
        if not self.colors:
            return curses.A_BOLD if bold else curses.A_NORMAL
        a = curses.color_pair(pair)
        if bold:
            a |= curses.A_BOLD
        return a

    def env_attr(self) -> int:
        return self.attr(C_ENV_PROD if self.env.is_prod else C_ENV_DEV, bold=True)

    def header_attr(self) -> int:
        if self.env.is_prod:
            return self.attr(C_HEADER_PROD, bold=True)
        return self.attr(C_HEADER, bold=True)

    def size(self) -> tuple[int, int]:
        return self.stdscr.getmaxyx()

    def set_status(self, msg: str, kind: str = "dim") -> None:
        self.status = msg
        self.status_kind = kind

    def flash_error(self, msg: str) -> None:
        self.set_status(f"  ✗  {msg}", "err")

    def flash_ok(self, msg: str) -> None:
        self.set_status(f"  ✓  {msg}", "ok")

    def flash_warn(self, msg: str) -> None:
        self.set_status(f"  !  {msg}", "warn")

    def add(self, y: int, x: int, text: str, attr: int = 0) -> None:
        h, w = self.size()
        if y < 0 or y >= h or x >= w:
            return
        text = text[: max(0, w - x - 1)]
        try:
            self.stdscr.addstr(y, x, text, attr)
        except curses.error:
            pass

    def fill_row(self, y: int, attr: int) -> None:
        h, w = self.size()
        if y < 0 or y >= h:
            return
        try:
            self.stdscr.addstr(y, 0, " " * (w - 1), attr)
        except curses.error:
            pass

    def hline(self, y: int, x: int, width: int, attr: int = 0) -> None:
        h, w = self.size()
        if y < 0 or y >= h:
            return
        width = min(width, w - x - 1)
        if width <= 0:
            return
        try:
            self.stdscr.hline(y, x, curses.ACS_HLINE, width, attr or self.attr(C_BORDER))
        except curses.error:
            self.add(y, x, "─" * width, attr or self.attr(C_BORDER))

    def box(
        self,
        y: int,
        x: int,
        height: int,
        width: int,
        *,
        title: str = "",
        attr: int = 0,
    ) -> None:
        """Draw a rounded box. height includes borders."""
        a = attr or self.attr(C_BORDER)
        if height < 2 or width < 4:
            return
        self.add(y, x, "╭" + "─" * (width - 2) + "╮", a)
        for i in range(1, height - 1):
            self.add(y + i, x, "│", a)
            self.add(y + i, x + width - 1, "│", a)
        self.add(y + height - 1, x, "╰" + "─" * (width - 2) + "╯", a)
        if title:
            t = f" {title} "
            self.add(y, x + 2, clip(t, width - 4), self.attr(C_TITLE, bold=True))

    def paint_chrome(self, title: str, footer: str) -> tuple[int, int, int]:
        """
        Draw polished header / status / footer.
        Returns (body_top, body_bottom_exclusive, width).
        """
        h, w = self.size()
        self.stdscr.erase()
        hattr = self.header_attr()

        # ── row 0: brand + env badge + title ──
        env_badge = f" {self.env.label} "
        brand = " ◆ Mintonix "
        self.fill_row(0, hattr)
        self.add(0, 0, brand, hattr)
        bx = len(brand)
        self.add(0, bx, env_badge, self.env_attr())
        right = f" {self.env.project_ref[:8]}… "
        mid_start = bx + len(env_badge)
        mid_end = w - len(right) - 1
        mid_w = max(0, mid_end - mid_start)
        mid = clip(title, mid_w).center(mid_w) if mid_w else ""
        self.add(0, mid_start, mid, hattr)
        self.add(0, max(0, w - len(right) - 1), right, hattr)

        # ── row 1: connection strip ──
        sb = supabase_url(self.env, self.secrets).replace("https://", "")
        cdn = cdn_presign_url(self.env, self.secrets).replace("https://", "")
        conn = f"  ⬡  {clip(sb, 34)}    ☁  {clip(cdn, 28)}"
        warn = "    ⚠  LIVE PRODUCTION" if self.env.is_prod else ""
        self.add(
            1, 0,
            clip(conn + warn, w - 1),
            self.attr(C_ERR if self.env.is_prod else C_MUTED),
        )

        # ── row 2: separator ──
        self.hline(2, 0, w - 1)

        # ── row 3: status ──
        sk = {"ok": C_OK, "err": C_ERR, "warn": C_WARN, "dim": C_MUTED}.get(
            self.status_kind, C_MUTED
        )
        status = self.status or "  ready"
        self.add(3, 0, clip(status, w - 1), self.attr(sk))

        # ── footer ──
        foot = clip(" " + footer.strip() + " ", w - 1)
        try:
            self.stdscr.addstr(h - 1, 0, foot.ljust(w - 1), self.attr(C_FOOTER))
        except curses.error:
            pass
        self.hline(h - 2, 0, w - 1)

        return 4, h - 2, w

    def getch(self) -> int:
        self.stdscr.timeout(-1)
        return self.stdscr.getch()

    def missing_secrets(self, secrets: dict[str, str] | None = None) -> list[str]:
        s = secrets if secrets is not None else self.secrets
        out = []
        for f in SECRET_FIELDS:
            if f.required and not field_value(s, f):
                out.append(f.key)
        return out

    def config_score(self, secrets: dict[str, str] | None = None) -> tuple[int, int]:
        s = secrets if secrets is not None else self.secrets
        total = len(SECRET_FIELDS)
        set_n = sum(1 for f in SECRET_FIELDS if field_value(s, f))
        return set_n, total


def clip(s: str | None, n: int) -> str:
    s = s or ""
    if n <= 0:
        return ""
    return s if len(s) <= n else s[: max(0, n - 1)] + "…"


def progress_bar(filled: int, total: int, width: int = 16) -> str:
    if total <= 0:
        return "░" * width
    n = int(round(width * filled / total))
    n = max(0, min(width, n))
    return "█" * n + "░" * (width - n)


# ─── UI primitives ────────────────────────────────────────────────────────────


def menu_select(
    app: App,
    title: str,
    items: list[tuple[str, str]],
    *,
    subtitle: str = "",
    initial: int = 0,
) -> int:
    idx = max(0, min(initial, len(items) - 1))
    while True:
        top, bottom, w = app.paint_chrome(
            title,
            "↑↓ move   Enter select   1-9 jump   Esc back",
        )
        y = top
        if subtitle:
            app.add(y, 2, clip(subtitle, w - 4), app.attr(C_MUTED))
            y += 1
            app.hline(y, 2, min(w - 4, 48), app.attr(C_BORDER))
            y += 2

        left_w = min(42, max(26, w // 2 - 4))
        panel_x = left_w + 5

        for i, (label, desc) in enumerate(items):
            if y >= bottom - 1:
                break
            selected = i == idx
            num = f"{i + 1}"
            if selected:
                bar = f"  {num}  {label}"
                app.add(y, 1, clip(bar.ljust(left_w + 1), left_w + 2), app.attr(C_SEL, bold=True))
            else:
                app.add(y, 3, num, app.attr(C_NUM))
                app.add(y, 6, clip(label, left_w - 6), curses.A_NORMAL)
            y += 1

        if items:
            _label, desc = items[idx]
            py = top + (2 if subtitle else 0)
            if panel_x + 12 < w:
                width = min(38, w - panel_x - 3)
                app.box(py, panel_x, min(12, bottom - py - 1), width + 2, title="details")
                app.add(py + 2, panel_x + 2, clip(_label, width - 2), app.attr(C_TITLE, bold=True))
                for j, line in enumerate(textwrap.wrap(desc, max(12, width - 2))[:7]):
                    row = py + 4 + j
                    if row >= bottom - 2:
                        break
                    app.add(row, panel_x + 2, line, app.attr(C_MUTED))

        app.stdscr.refresh()
        ch = app.getch()
        if ch in (curses.KEY_UP, ord("k"), ord("K")):
            idx = (idx - 1) % len(items)
        elif ch in (curses.KEY_DOWN, ord("j"), ord("J")):
            idx = (idx + 1) % len(items)
        elif ch in (10, 13, curses.KEY_ENTER):
            return idx
        elif ch in (27, ord("q"), ord("Q")):
            raise Cancel
        elif ord("1") <= ch <= ord("9"):
            n = ch - ord("1")
            if n < len(items):
                return n


def confirm(
    app: App,
    title: str,
    lines: list[str],
    *,
    danger: bool = False,
    default_no: bool = True,
) -> bool:
    choice = 1 if default_no else 0
    while True:
        top, bottom, w = app.paint_chrome(
            title,
            "←→ toggle   Enter confirm   y/n   Esc cancel",
        )
        y = top + 1
        box_w = min(w - 6, max(40, max((len(l) for l in lines), default=20) + 4))
        border = app.attr(C_ERR if danger else C_BORDER)
        app.add(y, 2, "╭" + "─" * box_w + "╮", border)
        y += 1
        for line in lines:
            for wrapped in textwrap.wrap(line, box_w - 2) or [""]:
                if y >= bottom - 5:
                    break
                app.add(y, 2, "│ ", border)
                app.add(
                    y, 4, clip(wrapped, box_w - 2),
                    app.attr(C_WARN if danger else C_DIM),
                )
                y += 1
        app.add(y, 2, "╰" + "─" * box_w + "╯", border)
        y += 2

        for i, opt in enumerate(("Yes", "No")):
            selected = i == choice
            pill = f"  {opt}  "
            if selected and danger and i == 0:
                attr = self_rev_err(app)
            elif selected:
                attr = app.attr(C_SEL, bold=True)
            else:
                attr = app.attr(C_MUTED)
            app.add(y, 4 + i * 12, pill, attr)

        app.stdscr.refresh()
        ch = app.getch()
        if ch in (curses.KEY_LEFT, curses.KEY_RIGHT, ord("h"), ord("l"),
                  ord("j"), ord("k"), 9):
            choice = 1 - choice
        elif ch in (10, 13, curses.KEY_ENTER):
            return choice == 0
        elif ch in (27, ord("q"), ord("Q"), ord("n"), ord("N")):
            return False
        elif ch in (ord("y"), ord("Y")):
            return True


def self_rev_err(app: App) -> int:
    if app.colors:
        return curses.color_pair(C_ERR) | curses.A_REVERSE | curses.A_BOLD
    return curses.A_REVERSE | curses.A_BOLD


def text_input(
    app: App,
    title: str,
    prompt: str,
    *,
    default: str = "",
    secret: bool = False,
    help_text: str = "",
    placeholder: str = "",
) -> str:
    buf = list(default)
    cursor = len(buf)
    reveal = not secret
    while True:
        top, bottom, w = app.paint_chrome(
            title,
            "type   Enter submit   Esc cancel   Ctrl-U clear"
            + ("   Tab show/hide" if secret else ""),
        )
        app.add(top + 1, 3, prompt, app.attr(C_TITLE, bold=True))
        if help_text:
            for j, line in enumerate(textwrap.wrap(help_text, max(20, w - 10))[:3]):
                app.add(top + 2 + j, 3, line, app.attr(C_MUTED))
            field_y = top + 2 + min(3, len(textwrap.wrap(help_text, max(20, w - 10)) or [""])) + 1
        else:
            field_y = top + 3

        field_w = min(w - 8, max(48, min(72, max(len(default), 20) + 12)))
        raw = "".join(buf)
        if secret and not reveal:
            display = "•" * len(buf)
        else:
            display = raw
        if not display and placeholder:
            # show placeholder dimmed, but don't put it in the buffer
            app.add(field_y, 3, "╭" + "─" * field_w + "╮", app.attr(C_BORDER))
            app.add(field_y + 1, 3, "│", app.attr(C_BORDER))
            app.add(field_y + 1, 4, clip(placeholder, field_w).ljust(field_w), app.attr(C_MUTED))
            app.add(field_y + 1, 4 + field_w, "│", app.attr(C_BORDER))
            app.add(field_y + 2, 3, "╰" + "─" * field_w + "╯", app.attr(C_BORDER))
        else:
            app.add(field_y, 3, "╭" + "─" * field_w + "╮", app.attr(C_BORDER))
            # scroll window so cursor is visible
            view_start = 0
            if cursor >= field_w:
                view_start = cursor - field_w + 1
            view = display[view_start: view_start + field_w].ljust(field_w)
            cur_in_view = cursor - view_start
            left = view[:cur_in_view]
            cur = view[cur_in_view: cur_in_view + 1] or " "
            right = view[cur_in_view + 1:]
            app.add(field_y + 1, 3, "│", app.attr(C_BORDER))
            app.add(field_y + 1, 4, left, app.attr(C_SEL))
            app.add(
                field_y + 1, 4 + len(left), cur,
                app.attr(C_SEL, bold=True) | curses.A_REVERSE,
            )
            app.add(
                field_y + 1, 4 + len(left) + 1,
                right[: max(0, field_w - cur_in_view - 1)],
                app.attr(C_SEL),
            )
            app.add(field_y + 1, 4 + field_w, "│", app.attr(C_BORDER))
            app.add(field_y + 2, 3, "╰" + "─" * field_w + "╯", app.attr(C_BORDER))

        meta_y = field_y + 4
        bits = []
        if secret:
            bits.append("shown" if reveal else "hidden")
        bits.append(f"{len(buf)} chars")
        if default and raw != default:
            bits.append("edited")
        app.add(meta_y, 3, " · ".join(bits), app.attr(C_MUTED))
        if default and not raw:
            app.add(meta_y + 1, 3, f"Enter keeps current ({mask_value(default, reveal=False)})",
                    app.attr(C_MUTED))

        app.stdscr.refresh()
        ch = app.getch()
        if ch == 27:
            raise Cancel
        if ch in (10, 13, curses.KEY_ENTER):
            return "".join(buf) if buf else default
        if ch == 9 and secret:  # Tab reveal
            reveal = not reveal
        if ch in (curses.KEY_BACKSPACE, 127, 8):
            if cursor > 0:
                del buf[cursor - 1]
                cursor -= 1
        elif ch == curses.KEY_LEFT:
            cursor = max(0, cursor - 1)
        elif ch == curses.KEY_RIGHT:
            cursor = min(len(buf), cursor + 1)
        elif ch == curses.KEY_DC:
            if cursor < len(buf):
                del buf[cursor]
        elif ch == 21:  # Ctrl-U
            buf.clear()
            cursor = 0
        elif ch == curses.KEY_HOME:
            cursor = 0
        elif ch == curses.KEY_END:
            cursor = len(buf)
        elif 32 <= ch <= 126:
            buf.insert(cursor, chr(ch))
            cursor += 1


def show_text(
    app: App,
    title: str,
    lines: list[str],
    *,
    footer: str = "↑↓ scroll   Esc/Enter back",
) -> None:
    scroll = 0
    while True:
        top, bottom, w = app.paint_chrome(title, footer)
        height = max(1, bottom - top - 1)
        box_w = min(w - 6, 78)
        app.add(top, 2, "╭" + "─" * box_w + "╮", app.attr(C_BORDER))
        view = lines[scroll: scroll + height - 2]
        for i, line in enumerate(view):
            app.add(top + 1 + i, 2, "│ ", app.attr(C_BORDER))
            app.add(top + 1 + i, 4, clip(line, box_w - 2), curses.A_NORMAL)
            app.add(top + 1 + i, 2 + box_w, "│", app.attr(C_BORDER))
        end_y = top + min(height - 1, 1 + len(view))
        app.add(end_y, 2, "╰" + "─" * box_w + "╯", app.attr(C_BORDER))
        if len(lines) > height - 2:
            app.add(
                bottom - 1, w - 16,
                f"{scroll + 1}–{min(scroll + height - 2, len(lines))}/{len(lines)}",
                app.attr(C_MUTED),
            )
        app.stdscr.refresh()
        ch = app.getch()
        if ch in (27, ord("q"), ord("Q"), 10, 13):
            return
        if ch in (curses.KEY_UP, ord("k")):
            scroll = max(0, scroll - 1)
        elif ch in (curses.KEY_DOWN, ord("j")):
            scroll = min(max(0, len(lines) - (height - 2)), scroll + 1)
        elif ch == curses.KEY_PPAGE:
            scroll = max(0, scroll - height)
        elif ch == curses.KEY_NPAGE:
            scroll = min(max(0, len(lines) - (height - 2)), scroll + height)
        elif ch == curses.KEY_HOME:
            scroll = 0
        elif ch == curses.KEY_END:
            scroll = max(0, len(lines) - (height - 2))


def pick_from_list(
    app: App,
    title: str,
    rows: list[str],
    *,
    subtitle: str = "",
    multi: bool = False,
) -> int | list[int]:
    if not rows:
        app.flash_warn("Nothing to show")
        show_text(app, title, ["(empty)"])
        raise Cancel

    idx = 0
    scroll = 0
    selected: set[int] = set()
    while True:
        top, bottom, w = app.paint_chrome(
            title,
            "↑↓ move   Space toggle   Enter done   Esc cancel"
            if multi else
            "↑↓ move   Enter select   Esc cancel",
        )
        y = top
        if subtitle:
            app.add(y, 2, clip(subtitle, w - 4), app.attr(C_MUTED))
            y += 1
        height = max(1, bottom - y)
        if idx < scroll:
            scroll = idx
        if idx >= scroll + height:
            scroll = idx - height + 1

        for i in range(scroll, min(len(rows), scroll + height)):
            row_y = y + (i - scroll)
            is_cur = i == idx
            if multi:
                box = "✓" if i in selected else " "
                prefix = f"{'▸' if is_cur else ' '} [{box}] "
            else:
                prefix = f"{'▸' if is_cur else ' '} "
            attr = app.attr(C_SEL, bold=True) if is_cur else curses.A_NORMAL
            app.add(row_y, 1, clip(prefix + rows[i], w - 2), attr)

        app.stdscr.refresh()
        ch = app.getch()
        if ch in (curses.KEY_UP, ord("k")):
            idx = (idx - 1) % len(rows)
        elif ch in (curses.KEY_DOWN, ord("j")):
            idx = (idx + 1) % len(rows)
        elif ch == curses.KEY_PPAGE:
            idx = max(0, idx - height)
        elif ch == curses.KEY_NPAGE:
            idx = min(len(rows) - 1, idx + height)
        elif ch == curses.KEY_HOME:
            idx = 0
        elif ch == curses.KEY_END:
            idx = len(rows) - 1
        elif multi and ch == ord(" "):
            selected.symmetric_difference_update({idx})
        elif multi and ch in (10, 13, curses.KEY_ENTER):
            if not selected:
                selected.add(idx)
            return sorted(selected)
        elif not multi and ch in (10, 13, curses.KEY_ENTER):
            return idx
        elif ch in (27, ord("q"), ord("Q")):
            raise Cancel


def format_match_row(m: dict) -> str:
    origin = "user" if m.get("owner_id") else "bwf "
    status = (m.get("status") or "?")[:10]
    mid = m["id"]
    short = mid if len(mid) <= 14 else mid[:14]
    tourn = clip(m.get("tournament"), 28)
    src = clip(m.get("source_url"), 36)
    return f"{short}  {origin}  {status:<10}  {tourn:<28}  {src}"


# ─── screens ──────────────────────────────────────────────────────────────────


def screen_switch_env(app: App) -> None:
    items = [
        (
            "Development  (DEV)",
            f"Project {PROFILES['dev'].project_ref}  ·  "
            f"cdn-dev.mintonix.com  ·  {PROFILES['dev'].secrets_path}",
        ),
        (
            "Production  (PROD)",
            f"Project {PROFILES['prod'].project_ref}  ·  "
            f"cdn.mintonix.com  ·  {PROFILES['prod'].secrets_path}  ·  ⚠ live data",
        ),
    ]
    current = 0 if app.env.name == "dev" else 1
    choice = menu_select(
        app, "Environment",
        items,
        subtitle=f"Currently on {app.env.label}",
        initial=current,
    )
    target = "dev" if choice == 0 else "prod"
    if target == app.env.name:
        app.flash_ok(f"Already on {app.env.label}")
        return

    if target == "prod":
        if not confirm(
            app,
            "Switch to PRODUCTION?",
            [
                "You are about to operate on the LIVE production database.",
                "",
                f"project  {PROFILES['prod'].project_ref}",
                "cdn      cdn.mintonix.com",
                f"secrets  {PROFILES['prod'].secrets_path}",
                "",
                "Deletes and queue enqueues will affect real users.",
            ],
            danger=True,
            default_no=True,
        ):
            app.set_status("  stayed on " + app.env.label, "dim")
            return

    app.switch_env(target)
    miss = app.missing_secrets()
    path = app.env.secrets_path
    if not os.path.isfile(path):
        app.flash_warn(f"Switched to {app.env.label} — open Settings to add secrets")
    elif miss:
        app.flash_warn(f"Switched to {app.env.label} — missing {', '.join(miss)}")
    else:
        app.flash_ok(f"Switched to {app.env.label}  ·  {app.env.project_ref[:12]}…")


def screen_settings(app: App) -> None:
    """Full settings editor for the active environment's secrets file."""
    draft = dict(app.secrets)
    dirty = False
    reveal_all = False
    # flat list of navigable rows: either ("section", cat) or ("field", SecretField)
    rows: list[tuple[str, Any]] = []
    last_cat = None
    for f in SECRET_FIELDS:
        if f.category != last_cat:
            rows.append(("section", f.category))
            last_cat = f.category
        rows.append(("field", f))
    # actions at end
    rows.append(("section", "Actions"))
    rows.append(("action", "save"))
    rows.append(("action", "reload"))
    rows.append(("action", "test"))
    rows.append(("action", "open_file"))
    rows.append(("action", "clear_optional"))

    # land on first field
    idx = next(i for i, (k, _) in enumerate(rows) if k == "field")
    scroll = 0

    def ensure_visible(top: int, bottom: int) -> None:
        nonlocal scroll
        height = max(1, bottom - top)
        if idx < scroll:
            scroll = idx
        if idx >= scroll + height:
            scroll = idx - height + 1

    def current_help() -> str:
        kind, payload = rows[idx]
        if kind == "field":
            f: SecretField = payload
            req = "required" if f.required else "optional"
            return f"{f.key}  ·  {req}  ·  {f.help}"
        if kind == "action":
            return {
                "save": "Write draft to secrets file (chmod 600).",
                "reload": "Discard draft and re-read the file + env.",
                "test": "Probe Supabase REST + CDN presign with current draft.",
                "open_file": "Show the absolute path and contents summary.",
                "clear_optional": "Clear all non-required fields in the draft.",
            }.get(payload, "")
        return ""

    while True:
        set_n, total = app.config_score(draft)
        miss = app.missing_secrets(draft)
        if dirty:
            app.set_status(
                f"  ● unsaved  ·  {set_n}/{total} filled"
                + (f"  ·  missing required: {', '.join(miss)}" if miss else ""),
                "warn" if miss else "ok",
            )
        else:
            app.set_status(
                f"  {set_n}/{total} filled  ·  {app.env.secrets_path}"
                + (f"  ·  missing: {', '.join(miss)}" if miss else ""),
                "warn" if miss else "dim",
            )

        top, bottom, w = app.paint_chrome(
            f"Settings · {app.env.label}",
            "↑↓ move  Enter edit  s save  t reveal  r reload  c test  Esc back",
        )

        # progress header
        bar = progress_bar(set_n, total, 18)
        app.add(top, 2, f"Config  [{bar}]  {set_n}/{total}", app.attr(C_TITLE, bold=True))
        req_ok = not miss
        app.add(
            top, 40,
            "● required ok" if req_ok else "○ required incomplete",
            app.attr(C_OK if req_ok else C_WARN, bold=True),
        )
        app.add(
            top + 1, 2,
            clip(
                f"{'shown' if reveal_all else 'hidden'} secrets  ·  "
                f"defaults  db={clip(app.env.default_supabase_url.replace('https://', ''), 28)}  "
                f"cdn={clip(app.env.default_cdn_presign.replace('https://', ''), 24)}",
                w - 4,
            ),
            app.attr(C_MUTED),
        )
        list_top = top + 3
        ensure_visible(list_top, bottom - 3)
        height = max(1, (bottom - 3) - list_top)

        # two-column-ish field list
        for row_i in range(scroll, min(len(rows), scroll + height)):
            y = list_top + (row_i - scroll)
            kind, payload = rows[row_i]
            selected = row_i == idx

            if kind == "section":
                label = f"  ▸ {payload}"
                attr = app.attr(C_SECTION, bold=True)
                if selected:
                    attr = app.attr(C_SEL, bold=True)
                app.add(y, 1, clip(label.ljust(min(w - 3, 70)), w - 2), attr)
                continue

            if kind == "action":
                labels = {
                    "save": "💾  Save to file",
                    "reload": "↺   Reload from disk",
                    "test": "⚡  Test connections",
                    "open_file": "📄  View file summary",
                    "clear_optional": "⌀   Clear optional fields",
                }
                text = f"  {labels.get(payload, payload)}"
                attr = app.attr(C_SEL, bold=True) if selected else app.attr(C_ACCENT)
                app.add(y, 1, clip(text.ljust(min(w - 3, 50)), w - 2), attr)
                continue

            # field row
            f: SecretField = payload
            val = field_value(draft, f)
            is_set = bool(val)
            mark = "●" if is_set else ("○" if f.required else "·")
            mark_attr = (
                app.attr(C_OK) if is_set
                else (app.attr(C_ERR) if f.required else app.attr(C_MUTED))
            )
            if is_set:
                if f.secret:
                    display = mask_value(val, reveal=reveal_all)
                else:
                    display = val
            else:
                display = "— not set —"

            left = f"  {mark}  {f.label}"
            # value aligned to the right side of a fixed column
            col = min(36, max(28, w // 3))
            if selected:
                line = left.ljust(col) + "  " + display
                app.add(y, 1, clip(line.ljust(min(w - 3, 90)), w - 2), app.attr(C_SEL, bold=True))
            else:
                app.add(y, 1, "  ", curses.A_NORMAL)
                app.add(y, 3, mark, mark_attr)
                app.add(y, 6, clip(f.label, col - 6), curses.A_NORMAL)
                app.add(
                    y, col + 1,
                    clip(display, w - col - 4),
                    app.attr(C_MUTED if not is_set else C_DIM),
                )

        # help strip
        help_line = current_help()
        app.add(bottom - 2, 2, clip(help_line, w - 4), app.attr(C_MUTED))
        if dirty:
            app.add(bottom - 1, 2, "unsaved changes — press s to write", app.attr(C_WARN))

        app.stdscr.refresh()
        ch = app.getch()

        def move(delta: int) -> None:
            nonlocal idx
            n = len(rows)
            for _ in range(n):
                idx = (idx + delta) % n
                if rows[idx][0] != "section":
                    return

        if ch in (curses.KEY_UP, ord("k")):
            move(-1)
        elif ch in (curses.KEY_DOWN, ord("j")):
            move(1)
        elif ch == curses.KEY_PPAGE:
            for _ in range(height):
                move(-1)
        elif ch == curses.KEY_NPAGE:
            for _ in range(height):
                move(1)
        elif ch == curses.KEY_HOME:
            idx = next(i for i, (k, _) in enumerate(rows) if k != "section")
        elif ch == curses.KEY_END:
            idx = len(rows) - 1
            if rows[idx][0] == "section":
                move(-1)
        elif ch in (ord("t"), ord("T")):
            reveal_all = not reveal_all
        elif ch in (ord("s"), ord("S")):
            try:
                path = save_secrets_file(app.env, draft)
                app.secrets = load_secrets(app.env)
                draft.clear()
                draft.update(app.secrets)
                dirty = False
                app.flash_ok(f"Saved {path}")
            except Exception as e:
                app.flash_error(f"Save failed: {e}")
        elif ch in (ord("r"), ord("R")):
            if dirty and not confirm(
                app, "Discard changes?",
                ["Reload will throw away unsaved edits."],
                danger=True, default_no=True,
            ):
                continue
            app.reload_secrets()
            draft.clear()
            draft.update(app.secrets)
            dirty = False
            app.flash_ok("Reloaded from disk")
        elif ch in (ord("c"), ord("C")):
            # test with draft (even if unsaved) so user can verify before saving
            app.set_status("  probing…", "dim")
            app.paint_chrome("Settings", "probing…")
            app.stdscr.refresh()
            results = probe_connections(app.env, draft)
            lines = [f"Environment  {app.env.label}", f"Using {'draft' if dirty else 'saved'} values", ""]
            all_ok = True
            for name, ok, detail in results:
                all_ok = all_ok and ok
                lines.append(f"  {'✓' if ok else '✗'}  {name:<18}  {detail}")
            (app.flash_ok if all_ok else app.flash_warn)(
                "All checks passed" if all_ok else "Some checks failed"
            )
            show_text(app, "Connection test", lines)
        elif ch in (27, ord("q"), ord("Q")):
            if dirty:
                if confirm(
                    app, "Leave Settings?",
                    ["You have unsaved changes.", "", "Save before leaving?"],
                    default_no=False,
                ):
                    try:
                        path = save_secrets_file(app.env, draft)
                        app.secrets = load_secrets(app.env)
                        dirty = False
                        app.flash_ok(f"Saved {path}")
                    except Exception as e:
                        app.flash_error(f"Save failed: {e}")
                        continue
                elif not confirm(
                    app, "Discard unsaved?",
                    ["Leave without saving?"],
                    danger=True, default_no=True,
                ):
                    continue
                else:
                    app.set_status("  discarded settings changes", "dim")
            return
        elif ch in (10, 13, curses.KEY_ENTER):
            kind, payload = rows[idx]
            if kind == "field":
                f: SecretField = payload
                current = field_value(draft, f)
                try:
                    # for secrets, start empty so user pastes cleanly; Enter keeps current
                    default_for_input = current if not f.secret else current
                    new_val = text_input(
                        app,
                        f"Edit · {f.label}",
                        f.key,
                        default=default_for_input,
                        secret=f.secret,
                        help_text=f.help + (
                            "  ·  Enter with empty keeps existing value."
                            if f.secret and current else ""
                        ),
                        placeholder=(
                            mask_value(current) if current and f.secret
                            else (app.env.default_supabase_url if f.key == "SUPABASE_URL"
                                  else app.env.default_cdn_presign if f.key == "CDN_PRESIGN_URL"
                                  else "paste value…")
                        ),
                    )
                except Cancel:
                    continue
                # empty + was secret with previous → keep previous (unless user Ctrl-U'd and Enter)
                # text_input returns default when buf empty, so new_val == current in that case
                if new_val != current:
                    set_field_value(draft, f, new_val)
                    dirty = True
                    app.flash_ok(f"Updated {f.key}" if new_val else f"Cleared {f.key}")
            elif kind == "action":
                if payload == "save":
                    try:
                        path = save_secrets_file(app.env, draft)
                        app.secrets = load_secrets(app.env)
                        draft.clear()
                        draft.update(app.secrets)
                        dirty = False
                        app.flash_ok(f"Saved {path}")
                    except Exception as e:
                        app.flash_error(f"Save failed: {e}")
                elif payload == "reload":
                    if dirty and not confirm(
                        app, "Discard changes?",
                        ["Reload will throw away unsaved edits."],
                        danger=True, default_no=True,
                    ):
                        continue
                    app.reload_secrets()
                    draft.clear()
                    draft.update(app.secrets)
                    dirty = False
                    app.flash_ok("Reloaded from disk")
                elif payload == "test":
                    app.set_status("  probing…", "dim")
                    results = probe_connections(app.env, draft)
                    lines = [f"Environment  {app.env.label}", ""]
                    all_ok = True
                    for name, ok, detail in results:
                        all_ok = all_ok and ok
                        lines.append(f"  {'✓' if ok else '✗'}  {name:<18}  {detail}")
                    (app.flash_ok if all_ok else app.flash_warn)(
                        "All checks passed" if all_ok else "Some checks failed"
                    )
                    show_text(app, "Connection test", lines)
                elif payload == "open_file":
                    path = app.env.secrets_path
                    exists = os.path.isfile(path)
                    lines = [
                        f"path     {path}",
                        f"exists   {exists}",
                        f"mode     {oct(os.stat(path).st_mode & 0o777) if exists else '—'}",
                        f"env      {app.env.label}  ({app.env.project_ref})",
                        "",
                        "Managed keys in draft:",
                        "",
                    ]
                    for f in SECRET_FIELDS:
                        v = field_value(draft, f)
                        lines.append(
                            f"  {'●' if v else '○'}  {f.key:<28}  "
                            f"{mask_value(v, reveal=reveal_all)}"
                        )
                    show_text(app, "Secrets file", lines)
                elif payload == "clear_optional":
                    if not confirm(
                        app, "Clear optional fields?",
                        ["Required tokens are kept. Optional keys will be emptied."],
                        danger=True, default_no=True,
                    ):
                        continue
                    for f in SECRET_FIELDS:
                        if not f.required:
                            set_field_value(draft, f, "")
                    dirty = True
                    app.flash_ok("Optional fields cleared (unsaved)")


def screen_browse(app: App) -> None:
    origin_idx = 0
    status_filter: str | None = None
    with_source = False

    while True:
        origins = ["all", "bwf", "user"]
        try:
            app.set_status("  loading matches…", "dim")
            app.paint_chrome("Browse", "loading…")
            app.stdscr.refresh()
            matches = fetch_matches(
                app.env, app.secrets,
                bwf_only=origins[origin_idx] == "bwf",
                user_only=origins[origin_idx] == "user",
                with_source=with_source,
                status=status_filter,
                limit=100,
            )
            app.set_status(
                f"  {len(matches)} match(es)  ·  {origins[origin_idx]}"
                f"  ·  status={status_filter or 'any'}"
                f"  ·  source={'yes' if with_source else 'any'}"
                f"  ·  [{app.env.label}]",
                "ok",
            )
        except Exception as e:
            app.flash_error(str(e))
            show_text(app, "Browse failed", textwrap.wrap(str(e), 70))
            return

        rows = [format_match_row(m) for m in matches] or ["(no matches)"]
        idx = 0
        scroll = 0
        while True:
            top, bottom, w = app.paint_chrome(
                "Browse matches",
                "Enter open   o origin   s status   u source   r refresh   Esc back",
            )
            y = top
            chips = (
                f" origin:{origins[origin_idx]} "
                f" status:{status_filter or 'any'} "
                f" source:{'required' if with_source else 'any'} "
            )
            app.add(y, 2, clip(chips, w - 4), app.attr(C_CHIP_ON if matches else C_CHIP))
            y += 1
            app.hline(y, 2, min(w - 4, 90))
            y += 1
            hdr = f"{'id':<14}  {'src':4}  {'status':<10}  {'tournament':<28}  source_url"
            app.add(y, 3, clip(hdr, w - 4), app.attr(C_TITLE))
            y += 1

            height = max(1, bottom - y)
            if idx < scroll:
                scroll = idx
            if idx >= scroll + height:
                scroll = idx - height + 1

            for i in range(scroll, min(len(rows), scroll + height)):
                is_cur = i == idx
                attr = app.attr(C_SEL, bold=True) if is_cur else curses.A_NORMAL
                mark = "▸ " if is_cur else "  "
                app.add(y + (i - scroll), 1, clip(mark + rows[i], w - 2), attr)

            app.stdscr.refresh()
            ch = app.getch()
            if ch in (27, ord("q")):
                return
            if ch in (curses.KEY_UP, ord("k")):
                idx = (idx - 1) % len(rows)
            elif ch in (curses.KEY_DOWN, ord("j")):
                idx = (idx + 1) % len(rows)
            elif ch == curses.KEY_PPAGE:
                idx = max(0, idx - height)
            elif ch == curses.KEY_NPAGE:
                idx = min(len(rows) - 1, idx + height)
            elif ch == ord("r"):
                break
            elif ch == ord("o"):
                origin_idx = (origin_idx + 1) % 3
                break
            elif ch == ord("u"):
                with_source = not with_source
                break
            elif ch == ord("s"):
                opts = [
                    ("any", "No status filter"),
                    ("pending", "pending"),
                    ("processing", "processing"),
                    ("ready", "ready"),
                    ("failed", "failed"),
                ]
                try:
                    si = menu_select(app, "Status filter", opts)
                    status_filter = None if opts[si][0] == "any" else opts[si][0]
                except Cancel:
                    pass
                break
            elif ch in (10, 13) and matches:
                screen_match_detail(app, matches[idx])
                break


def screen_match_detail(app: App, m: dict) -> None:
    mid = m["id"]
    prefix = match_b2_prefix(m.get("owner_id"), mid)
    live = None
    latest = None
    try:
        live = fetch_live_job_for_match(app.env, app.secrets, mid)
        latest = live or fetch_latest_job_for_match(app.env, app.secrets, mid)
    except Exception:
        pass

    job_line = "—"
    if latest:
        job_line = (
            f"{latest.get('status')}  stage={latest.get('stage')}  "
            f"attempt={latest.get('attempt')}  id={clip(str(latest.get('id')), 8)}"
            + ("  (live)" if live else "")
        )

    lines = [
        f"id          {mid}",
        f"env         {app.env.label}",
        f"origin      {'user' if m.get('owner_id') else 'BWF/system'}",
        f"owner_id    {m.get('owner_id') or '—'}",
        f"status      {m.get('status')}",
        f"job         {job_line}",
        f"tournament  {m.get('tournament') or '—'}",
        f"match_date  {m.get('match_date') or '—'}",
        f"source_url  {m.get('source_url') or '—'}",
        f"players     {m.get('team1_player1') or '—'} / {m.get('team1_player2') or '—'}"
        f"  vs  {m.get('team2_player1') or '—'} / {m.get('team2_player2') or '—'}",
        f"scores      {m.get('g1_t1')}-{m.get('g1_t2')}  "
        f"{m.get('g2_t1')}-{m.get('g2_t2')}  {m.get('g3_t1')}-{m.get('g3_t2')}",
        f"b2_prefix   {prefix}",
        f"created_at  {m.get('created_at')}",
    ]
    show_text(app, "Match", lines, footer="Enter for actions   Esc back")
    try:
        a = menu_select(app, "Match actions", [
            ("Inspect B2 objects", "LIST prefix · stage completeness"),
            ("Set stage…", "Pick stage; optional purge + enqueue"),
            ("Queue this match", "Enqueue only — cron dispatch picks it up"),
            ("Delete this match", "B2 + DB cleanup"),
            ("Back", "Return to list"),
        ])
    except Cancel:
        return
    if a == 0:
        _inspect_b2(app, m)
    elif a == 1:
        _set_stage_flow(app, m)
    elif a == 2:
        _queue_one(app, m)
    elif a == 3:
        _delete_one(app, m)


def _inspect_b2(app: App, m: dict) -> None:
    mid = m["id"]
    prefix = match_b2_prefix(m.get("owner_id"), mid)
    try:
        app.set_status("  listing B2…", "dim")
        keys = list_prefix_keys(app.env, app.secrets, prefix)
    except Exception as e:
        app.flash_error(str(e))
        show_text(app, "LIST failed", textwrap.wrap(str(e), 70))
        return

    bases = basenames_from_keys(keys, prefix)
    comp = stage_completeness(bases)
    live = None
    try:
        live = fetch_live_job_for_match(app.env, app.secrets, mid)
    except Exception:
        pass

    lines = [
        f"prefix   {prefix}",
        f"objects  {len(keys)}",
        f"job      "
        + (
            f"{live.get('status')} stage={live.get('stage')} attempt={live.get('attempt')}"
            if live else "(no live job)"
        ),
        "",
        "Stage completeness (primary artifact)",
        f"  normalize  {comp['normalize']}   ({STAGE_PRIMARY['normalize']})",
        f"  detect     {comp['detect']}   ({STAGE_PRIMARY['detect']})",
        f"  analyze    {comp['analyze']}   ({STAGE_PRIMARY['analyze']})",
        "",
        "Objects",
    ]
    if not keys:
        lines.append("  (none)")
    else:
        for key in sorted(keys):
            base = key[len(prefix):] if key.startswith(prefix) else key
            mark = ""
            for st, primary in STAGE_PRIMARY.items():
                if base == primary:
                    mark = f"  ← {st}"
                    break
            if base in KEEP_ON_REGRESS or base.startswith("original."):
                mark = mark or "  (keep on regress)"
            lines.append(f"  {base}{mark}")
    show_text(app, f"B2 · {clip(mid, 18)}", lines)
    app.flash_ok(f"{len(keys)} object(s)  ·  n={comp['normalize']} d={comp['detect']} a={comp['analyze']}")


def _pick_stage(app: App, title: str) -> str | None:
    try:
        i = menu_select(app, title, [
            ("normalize", "Re-run from source / original → normalized.mp4"),
            ("detect", "Re-run detect on existing normalized.mp4"),
            ("analyze", "Re-run analyze on existing detections.json"),
        ])
    except Cancel:
        return None
    return STAGE_ORDER[i]


def _pick_yes_no(app: App, title: str, yes_help: str, no_help: str, *, default_yes: bool) -> bool | None:
    """Two-option menu. Returns True/False or None on cancel."""
    options = [
        ("Yes", yes_help),
        ("No", no_help),
    ]
    if not default_yes:
        options = list(reversed(options))
    try:
        i = menu_select(app, title, options)
    except Cancel:
        return None
    # Map selection back to yes/no depending on order.
    if default_yes:
        return i == 0
    return i == 1


def _set_stage_flow(app: App, m: dict) -> None:
    """One TUI action: pick stage, optional purge, optional enqueue."""
    mid = m["id"]
    prefix = match_b2_prefix(m.get("owner_id"), mid)
    stage = _pick_stage(app, "Set stage")
    if not stage:
        app.set_status("  cancelled", "dim")
        return

    purge = _pick_yes_no(
        app,
        "Purge stage outputs?",
        "DELETE this stage + later basenames under match prefix",
        "Leave B2 objects alone",
        default_yes=False,
    )
    if purge is None:
        app.set_status("  cancelled", "dim")
        return

    enqueue = _pick_yes_no(
        app,
        "Enqueue on jobs_interactive?",
        "pgmq.send — cron drain will claim it (~1 min)",
        "Job at stage, no pgmq — still holds one-live slot (blocks ingest)",
        default_yes=True,
    )
    if enqueue is None:
        app.set_status("  cancelled", "dim")
        return

    live = None
    live_fetch_failed = False
    try:
        live = fetch_live_job_for_match(app.env, app.secrets, mid)
    except Exception as e:
        live_fetch_failed = True
        app.flash_warn(f"Could not fetch live job: {e}")

    cancel_live = True
    if live_fetch_failed:
        if not confirm(
            app, "Live job unknown",
            [
                f"Match  {mid}",
                "",
                "Could not verify whether a job is processing.",
                "Proceed and allow cancel of any live job?",
                "(RPC may cancel in-flight work and issue a new job_id.)",
            ],
            danger=True,
            default_no=True,
        ):
            app.set_status("  aborted — could not verify live job", "dim")
            return
    elif live and live.get("status") == "processing":
        if not confirm(
            app, "Cancel live processing?",
            [
                f"Match   {mid}",
                f"Job     {live.get('id')}",
                f"Stage   {live.get('stage')}  attempt={live.get('attempt')}",
                "",
                "A worker may still be running. Cancel marks the job canceled",
                "and creates a NEW job_id (stale callback tokens will not settle).",
                "Decline leaves the processing job alone (aborts set-stage).",
            ],
            danger=True,
            default_no=True,
        ):
            app.set_status("  left processing job alone", "dim")
            return

    purge_names = outputs_to_purge(stage) if purge else []
    preview_keys: list[str] = []
    if purge:
        try:
            app.set_status("  previewing B2 purge…", "dim")
            listed = list_prefix_keys(app.env, app.secrets, prefix)
            preview_keys = preview_purge_targets(listed, prefix, stage)
        except Exception as e:
            app.flash_warn(f"Purge preview LIST failed: {e}")

    lines = [
        f"Environment  {app.env.label}",
        f"Match        {mid}",
        f"Stage        {stage}",
        f"Enqueue      {'yes — jobs_interactive (cron drains)' if enqueue else 'no — not dispatchable'}",
        f"Cancel live  {cancel_live}"
        + (
            f"  (live={live.get('status')} stage={live.get('stage')})"
            if live else
            ("  (live job UNKNOWN)" if live_fetch_failed else "  (no live job)")
        ),
        f"Purge B2     {'YES — stage + later outputs' if purge else 'no'}",
    ]
    if purge:
        lines += ["", "Will DELETE basenames:"]
        lines += [f"  • {n}" for n in purge_names]
        if preview_keys:
            lines += ["", f"Preview hits under prefix ({len(preview_keys)}):"]
            lines += [f"  {k}" for k in preview_keys[:20]]
            if len(preview_keys) > 20:
                lines.append(f"  … and {len(preview_keys) - 20} more")
        lines += [
            "",
            "Always kept: original.*  annotation.json",
            "Flow: set stage (no enqueue) → B2 purge → enqueue if requested",
        ]
    lines += [
        "",
        "DB: ops_set_stage → job at stage, matches.status=pending",
    ]
    if not enqueue:
        lines += [
            "",
            "WARNING: enqueue=no leaves a live queued job (null msg_id).",
            "matches-ingest / Queue this match will return already_queued",
            "until you Set stage with enqueue=yes or the job is terminal.",
        ]
    if live and live.get("status") == "processing" and enqueue:
        lines += [
            "",
            "NOTE: canceling processing + enqueue is racy — a dying worker",
            "may still PUT. Consider enqueue=no, wait, inspect B2, re-run.",
        ]
    if not confirm(
        app, "Confirm set stage", lines,
        danger=app.env.is_prod or purge,
        default_no=app.env.is_prod or purge,
    ):
        app.set_status("  cancelled", "dim")
        return

    try:
        app.set_status("  set-stage…", "dim")
        result = ops_set_stage(
            app.env, app.secrets,
            match_id=mid,
            stage=stage,
            enqueue=enqueue,
            cancel_live=cancel_live,
            purge=purge,
        )
        if result.get("rejected"):
            app.flash_warn(
                f"Rejected: {result.get('reason') or result.get('error') or result}"
            )
            show_text(app, "ops_set_stage rejected", json.dumps(result, indent=2).splitlines())
        elif result.get("ok") is False or result.get("stage_set"):
            app.flash_error(
                f"Partial: {result.get('code') or result.get('error') or 'ops'}"
            )
            guide = format_ops_partial_guidance(result)
            body = guide + ["", "── raw ──", *json.dumps(result, indent=2).splitlines()]
            show_text(app, "ops recovery", body)
        else:
            purged = result.get("purged") or []
            app.flash_ok(
                f"stage={result.get('stage')} enqueue={result.get('enqueue')} "
                f"job={clip(str(result.get('job_id')), 8)} "
                f"purged={len(purged)}"
            )
            show_text(app, "ops_set_stage result", json.dumps(result, indent=2).splitlines())
    except Exception as e:
        app.flash_error(str(e))
        show_text(app, "set-stage failed", textwrap.wrap(str(e), 70))



def _queue_one(app: App, m: dict) -> None:
    if not confirm(
        app, "Queue match",
        [
            f"Environment  {app.env.label}",
            f"Match        {m['id']}",
            f"Tournament   {m.get('tournament') or '—'}",
            f"Source       {m.get('source_url') or '(none)'}",
            "",
            "Enqueue jobs_bulk · priority 100",
            "Does not dispatch — pg_cron drains the queue.",
        ],
        danger=app.env.is_prod,
        default_no=app.env.is_prod,
    ):
        app.set_status("  queue cancelled", "dim")
        return
    try:
        app.set_status("  queueing…", "dim")
        result = queue_match(app.env, app.secrets, m)
        if result.get("already_queued"):
            app.flash_warn(f"Already queued  job={result.get('job_id')}")
        else:
            app.flash_ok(
                f"Enqueued  job={result.get('job_id')}  (cron will dispatch)"
            )
        show_text(app, "Queue result", json.dumps(result, indent=2).splitlines())
    except Exception as e:
        app.flash_error(str(e))
        show_text(app, "Queue failed", textwrap.wrap(str(e), 70))


def screen_queue(app: App) -> None:
    mode = menu_select(
        app, "Queue matches",
        [
            ("All BWF with source_url", "Every system match with a YouTube URL (skips live jobs)."),
            ("Pick from list", "Browse BWF matches and multi-select."),
            ("Enter match id", "Type a single id."),
        ],
        subtitle=f"Scraper catalog → pipeline  ·  {app.env.label}",
    )

    if mode == 0:
        app.set_status("  loading BWF matches…", "dim")
        app.paint_chrome("Queue", "loading…")
        app.stdscr.refresh()
        matches = fetch_matches(
            app.env, app.secrets, bwf_only=True, with_source=True, limit=500,
        )
    elif mode == 1:
        pool = fetch_matches(
            app.env, app.secrets, bwf_only=True, with_source=True, limit=100,
        )
        if not pool:
            app.flash_warn("No BWF matches with source_url")
            return
        picks = pick_from_list(
            app, "Select matches to queue",
            [format_match_row(m) for m in pool],
            subtitle="Space = toggle  ·  Enter = confirm",
            multi=True,
        )
        assert isinstance(picks, list)
        matches = [pool[i] for i in picks]
    else:
        mid = text_input(app, "Queue match", "Match id")
        matches = fetch_matches(app.env, app.secrets, match_id=mid)
        if not matches:
            raise RuntimeError(f"No match with id={mid}")

    if not matches:
        app.flash_warn("Nothing to queue")
        return

    try:
        live = live_job_match_ids(app.env, app.secrets, [m["id"] for m in matches])
    except Exception:
        live = set()
    before = len(matches)
    matches = [m for m in matches if m["id"] not in live]
    skipped = before - len(matches)
    if not matches:
        app.flash_warn(f"All {before} already have a live job")
        return

    lines = [
        f"Environment  {app.env.label}",
        f"Will enqueue {len(matches)} match(es) on jobs_bulk.",
        "Enqueue only — pg_cron drains /jobs/dispatch (~1 min).",
    ]
    if skipped:
        lines.append(f"Skipped {skipped} already live.")
    lines.append("")
    lines.extend(
        f"  · {clip(m['id'], 18)}  {clip(m.get('tournament'), 40)}"
        for m in matches[:12]
    )
    if len(matches) > 12:
        lines.append(f"  … and {len(matches) - 12} more")

    if not confirm(
        app, "Confirm queue", lines,
        danger=app.env.is_prod, default_no=app.env.is_prod,
    ):
        app.set_status("  queue cancelled", "dim")
        return

    results: list[str] = []
    ok = already = failed = 0
    for m in matches:
        try:
            r = queue_match(app.env, app.secrets, m)
            if r.get("already_queued"):
                already += 1
                results.append(f"already  {m['id'][:16]}  job={r.get('job_id')}")
            else:
                ok += 1
                results.append(f"enqueued {m['id'][:16]}  job={r.get('job_id')}")
        except Exception as e:
            failed += 1
            results.append(f"FAILED   {m['id'][:16]}  {e}")

    summary = f"enqueued={ok} already={already} failed={failed}"
    if ok and failed == 0:
        summary += "  ·  cron will dispatch"
    (app.flash_ok if failed == 0 else app.flash_warn)(summary)

    show_text(app, "Queue results", results)


def screen_ingest(app: App) -> None:
    lane = menu_select(
        app, "Ingest video",
        [
            ("YouTube / BWF", "System lane — worker downloads from YouTube."),
            ("Local file (user upload)", "Upload lane — test user + cdn-access."),
            ("YouTube + local scrub file", "BWF lane, annotate from a local copy."),
        ],
        subtitle=f"Opens OpenCV annotator  ·  {app.env.label}",
    )

    url = file_path = tournament = None
    if lane in (0, 2):
        url = text_input(app, "YouTube URL", "Paste YouTube URL")
        tournament = text_input(app, "Tournament", "Label (e.g. 2025 Worlds-MS-Final)")
    if lane in (1, 2):
        file_path = text_input(app, "Local file", "Path to video file")
        if not os.path.isfile(file_path):
            raise RuntimeError(f"File not found: {file_path}")

    dry = confirm(
        app, "Dry-run?",
        ["Annotate only — write nothing?"], default_no=True,
    )

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "annotate_and_ingest.py")
    if not os.path.isfile(script):
        raise RuntimeError(f"annotate_and_ingest.py not found at {script}")

    # Enqueue only — never pass --dispatch; pg_cron drains the queue.
    cmd = [sys.executable, script]
    if url:
        cmd += ["--url", url]
    if file_path:
        cmd += ["--file", file_path]
    if tournament:
        cmd += ["--tournament", tournament]
    if lane != 1:
        cmd += ["--queue", "jobs_bulk"]
    if dry:
        cmd.append("--dry-run")

    env_vars = os.environ.copy()
    env_vars["SUPABASE_URL"] = supabase_url(app.env, app.secrets)
    if app.secrets.get("PIPELINE_SERVICE_TOKEN"):
        env_vars["PIPELINE_SERVICE_TOKEN"] = app.secrets["PIPELINE_SERVICE_TOKEN"]
    if app.secrets.get("SUPABASE_ANON_KEY"):
        env_vars["SUPABASE_ANON_KEY"] = app.secrets["SUPABASE_ANON_KEY"]

    if not confirm(
        app, "Launch annotator",
        ["About to run:", "  " + " ".join(cmd), "", f"Target env  {app.env.label}"],
        danger=app.env.is_prod, default_no=app.env.is_prod,
    ):
        return

    curses.def_prog_mode()
    curses.endwin()
    code = 1
    try:
        print(f"\n── annotate_and_ingest  [{app.env.label}] ──\n")
        code = subprocess.call(cmd, env=env_vars)
        print(f"\n[exit {code}]  press Enter to return to Mintonix…")
        try:
            input()
        except EOFError:
            pass
    finally:
        curses.reset_prog_mode()
        app.stdscr.clear()
        app.stdscr.refresh()
        try:
            curses.curs_set(0)
        except curses.error:
            pass

    if code == 0:
        app.flash_ok("Ingest finished")
    else:
        app.flash_error(f"Ingest exited with code {code}")


def _delete_one(app: App, m: dict | None, match_id: str | None = None) -> None:
    if m is None:
        assert match_id
        rows = fetch_matches(app.env, app.secrets, match_id=match_id)
        m = rows[0] if rows else None
        mid = match_id
    else:
        mid = m["id"]

    if m is None:
        prefix = f"bwf/{mid}/"
        do_db, do_storage = False, True
        lines = [
            f"Environment  {app.env.label}",
            f"No DB row for {mid}.",
            f"Storage-only under {prefix}",
        ]
    else:
        prefix = match_b2_prefix(m.get("owner_id"), mid)
        scope_i = menu_select(
            app, "Delete scope",
            [
                ("B2 + database", "Delete objects under prefix, then matches row (jobs cascade)."),
                ("B2 only", "Keep the DB row."),
                ("Database only", "Keep B2 objects."),
            ],
            subtitle=f"[{app.env.label}]  {clip(mid, 24)}",
        )
        do_storage = scope_i in (0, 1)
        do_db = scope_i in (0, 2)
        lines = [
            f"Environment  {app.env.label}",
            f"id           {mid}",
            f"origin       {'user' if m.get('owner_id') else 'BWF'}",
            f"status       {m.get('status')}",
            f"prefix       {prefix}",
            "",
            f"storage      {'yes' if do_storage else 'no'}",
            f"db row       {'yes (jobs cascade)' if do_db else 'no'}",
        ]

    dry = confirm(app, "Dry-run?", ["Only print what would be deleted?"], default_no=True)
    if not confirm(
        app,
        "Confirm delete" if not dry else "Confirm dry-run",
        lines + (["", "DRY-RUN — nothing removed"] if dry else ["", "This cannot be undone."]),
        danger=not dry,
        default_no=True,
    ):
        app.set_status("  delete cancelled", "dim")
        return

    log: list[str] = [f"env  {app.env.label}", ""]
    if do_storage:
        log.extend(delete_b2_prefix(app.env, app.secrets, prefix, dry_run=dry))

    if do_db and m is not None:
        if dry:
            log.append(f"would DELETE matches id={mid}")
        else:
            delete_match_row(app.env, app.secrets, mid)
            log.append(f"deleted DB row {mid}")

    app.flash_ok("Delete complete" if not dry else "Dry-run complete")
    show_text(app, "Delete log", log)


def screen_delete(app: App) -> None:
    mode = menu_select(
        app, "Delete match",
        [
            ("Pick from recent", "Browse latest matches and choose one."),
            ("Enter match id", "Type the id (works even if DB row is gone)."),
        ],
        subtitle=f"⚠  {app.env.label}",
    )
    if mode == 0:
        pool = fetch_matches(app.env, app.secrets, limit=50)
        if not pool:
            app.flash_warn("No matches")
            return
        i = pick_from_list(app, "Pick match to delete", [format_match_row(m) for m in pool])
        assert isinstance(i, int)
        _delete_one(app, pool[i])
    else:
        mid = text_input(app, "Delete match", "Match id")
        _delete_one(app, None, match_id=mid)


def screen_dispatch(app: App) -> None:
    """Emergency manual drain. Prefer the jobs-dispatch cron (every minute)."""
    max_jobs_s = text_input(
        app, "Force dispatch", "Max jobs to claim (emergency)", default="1",
    )
    try:
        max_jobs = max(1, int(max_jobs_s))
    except ValueError:
        max_jobs = 1

    if not confirm(
        app, "Force dispatch",
        [
            f"Environment  {app.env.label}",
            f"Claim up to {max_jobs} job(s) and POST to vast.",
            "",
            "Normally unnecessary: pg_cron drains the queue every minute.",
            "Use only if the cron/Vault path is broken or you need a kick now.",
        ],
        danger=app.env.is_prod,
        default_no=True,
    ):
        return
    try:
        app.set_status("  dispatching…", "dim")
        result = run_dispatch(app.env, app.secrets, max_jobs=max_jobs)
        app.flash_ok("Force dispatch done")
        show_text(app, "Dispatch result", json.dumps(result, indent=2).splitlines())
    except Exception as e:
        app.flash_error(str(e))
        show_text(app, "Dispatch failed", textwrap.wrap(str(e), 70))


def screen_snapshot(app: App) -> None:
    app.set_status("  loading snapshot…", "dim")
    app.paint_chrome("Snapshot", "loading…")
    app.stdscr.refresh()
    lines: list[str] = [
        f"Environment  {app.env.label}  ({app.env.project_ref})",
        f"Database     {supabase_url(app.env, app.secrets)}",
        f"CDN          {cdn_presign_url(app.env, app.secrets)}",
        "",
        "Matches by status",
        "",
    ]
    try:
        for st in ("pending", "processing", "ready", "failed"):
            rows = fetch_matches(app.env, app.secrets, status=st, limit=500)
            n = len(rows)
            bar = "█" * min(40, max(1, n // 2)) if n else "·"
            lines.append(f"  {st:<12} {n:>4}  {bar}")
        lines += ["", "Live jobs (queued / processing)", ""]
        jobs = fetch_live_jobs(app.env, app.secrets)
        if not jobs:
            lines.append("  (none)")
        for j in jobs:
            lines.append(
                f"  {j.get('status'):<10}  stage={j.get('stage'):<10}  "
                f"q={str(j.get('queue') or '?'):<16}  "
                f"try={j.get('attempt')}  match={str(j.get('match_id'))[:16]}"
            )
        app.flash_ok(f"{len(jobs)} live job(s) on {app.env.label}")
    except Exception as e:
        lines.append(f"error: {e}")
        app.flash_error(str(e))
    show_text(app, "Pipeline snapshot", lines)


# ─── reconcile screens ────────────────────────────────────────────────────────


def _fmt_b2_only_row(e: B2Entry) -> str:
    files = ",".join(sorted(e.basenames)[:4])
    extra = f"+{len(e.basenames) - 4}" if len(e.basenames) > 4 else ""
    return (
        f"{clip(e.match_id, 16):<16}  {e.origin:<4}  "
        f"{e.object_count:>3} obj  {clip(files + extra, 40)}"
    )


def _fmt_db_only_row(m: dict) -> str:
    origin = "user" if m.get("owner_id") else "bwf"
    src = "src" if m.get("source_url") else "—"
    st = (m.get("status") or "?").lower()
    if st in ("ready", "processing", "failed"):
        flag = "!"
    elif st == "pending" and (m.get("source_url") or m.get("owner_id")):
        flag = "·"  # likely just not processed yet
    else:
        flag = "?"
    return (
        f"{flag} {clip(m['id'], 14):<14}  {origin:<4}  "
        f"{(m.get('status') or '?'):<10}  {src:<3}  "
        f"{clip(m.get('tournament'), 26)}"
    )


def _fmt_drift_row(d: DriftItem) -> str:
    m = d.match
    n_obj = d.b2.object_count if d.b2 else 0
    issue = d.issues[0] if d.issues else "?"
    return (
        f"{clip(m['id'], 14):<14}  {(m.get('status') or '?'):<10}  "
        f"{n_obj:>3} obj  {clip(issue, 42)}"
    )


def _reconcile_delete_b2_entries(app: App, entries: list[B2Entry]) -> None:
    if not entries:
        return
    lines = [
        f"Environment  {app.env.label}",
        f"Delete B2 for {len(entries)} orphan match prefix(es).",
        "",
    ]
    for e in entries[:15]:
        lines.append(f"  {e.prefix}  ({e.object_count} objects)")
    if len(entries) > 15:
        lines.append(f"  … and {len(entries) - 15} more")
    lines += ["", "This cannot be undone."]
    if not confirm(app, "Confirm B2 orphan delete", lines, danger=True, default_no=True):
        app.set_status("  cancelled", "dim")
        return

    log: list[str] = [f"env  {app.env.label}", ""]
    for e in entries:
        log.append(f"── {e.match_id}  {e.prefix}")
        log.extend(
            delete_b2_prefix(
                app.env, app.secrets, e.prefix,
                dry_run=False, known_keys=list(e.keys),
            )
        )
        log.append("")
    app.flash_ok("B2 cleanup done")
    show_text(app, "B2 delete log", log)


def _reconcile_delete_db_rows(app: App, matches: list[dict]) -> None:
    if not matches:
        return
    lines = [
        f"Environment  {app.env.label}",
        f"Delete {len(matches)} matches row(s) (jobs cascade). B2 untouched.",
        "",
    ]
    for m in matches[:15]:
        lines.append(f"  {m['id']}  status={m.get('status')}")
    if len(matches) > 15:
        lines.append(f"  … and {len(matches) - 15} more")
    if not confirm(
        app, "Confirm DB delete",
        lines + ["", "Jobs cascade. Irreversible."],
        danger=True, default_no=True,
    ):
        return

    log: list[str] = []
    for m in matches:
        try:
            delete_match_row(app.env, app.secrets, m["id"])
            log.append(f"deleted {m['id']}")
        except Exception as e:
            log.append(f"FAILED  {m['id']}  {e}")
    app.flash_ok("DB delete done")
    show_text(app, "DB delete log", log)


def _reconcile_queue_matches(app: App, matches: list[dict]) -> None:
    queueable = [m for m in matches if m.get("source_url") or m.get("owner_id")]
    skipped = len(matches) - len(queueable)
    if not queueable:
        app.flash_warn("None of the selected matches can be re-queued (need source_url or user upload)")
        return
    live = live_job_match_ids(app.env, app.secrets, [m["id"] for m in queueable])
    queueable = [m for m in queueable if m["id"] not in live]
    if not queueable:
        app.flash_warn("All selected already have a live job")
        return

    lines = [
        f"Environment  {app.env.label}",
        f"Re-queue {len(queueable)} match(es) via matches-ingest (enqueue only).",
    ]
    if skipped:
        lines.append(f"Skipped {skipped} without source/owner.")
    if live:
        lines.append(f"Skipped {len(live)} with live job(s).")
    for m in queueable[:10]:
        lines.append(f"  {m['id']}  {clip(m.get('tournament'), 30)}")
    if not confirm(app, "Re-queue matches", lines, danger=app.env.is_prod, default_no=app.env.is_prod):
        return

    log: list[str] = []
    for m in queueable:
        try:
            result = queue_match(app.env, app.secrets, m)
            if result.get("already_queued"):
                log.append(f"already  {m['id']}  job={result.get('job_id')}")
            else:
                log.append(f"enqueued {m['id']}  job={result.get('job_id')}")
        except Exception as e:
            log.append(f"FAILED   {m['id']}  {e}")
    app.flash_ok("Enqueued · cron will dispatch")
    show_text(app, "Re-queue log", log)


def _reconcile_set_status(app: App, matches: list[dict]) -> None:
    if not matches:
        return
    si = menu_select(
        app, "Set status",
        [
            ("pending", "Reset to pending (waiting for pipeline)."),
            ("processing", "Mark as processing (use carefully)."),
            ("ready", "Mark as ready (catalog-visible)."),
            ("failed", "Mark as failed."),
        ],
        subtitle=f"{len(matches)} match(es)  ·  {app.env.label}",
    )
    status = ("pending", "processing", "ready", "failed")[si]
    if not confirm(
        app, f"Set status → {status}",
        [
            f"Environment  {app.env.label}",
            f"PATCH status={status} on {len(matches)} row(s).",
            "",
            "This writes to the database.",
        ],
        danger=app.env.is_prod,
        default_no=app.env.is_prod,
    ):
        return

    log: list[str] = []
    for m in matches:
        try:
            patch_match(app.env, app.secrets, m["id"], {"status": status})
            log.append(f"ok  {m['id']} → {status}")
        except Exception as e:
            log.append(f"FAILED  {m['id']}  {e}")
    app.flash_ok("Status update done")
    show_text(app, "Status log", log)


def _reconcile_delete_both_drift(app: App, items: list[DriftItem]) -> None:
    if not items:
        return
    lines = [
        f"Environment  {app.env.label}",
        f"Delete B2 + DB for {len(items)} match(es).",
        "",
    ]
    for d in items[:12]:
        lines.append(f"  {d.match_id}  {d.expected_prefix}")
    if not confirm(
        app, "Confirm full delete",
        lines + ["", "Irreversible."],
        danger=True, default_no=True,
    ):
        return

    log: list[str] = []
    for d in items:
        log.append(f"── {d.match_id}")
        prefix = d.b2.prefix if d.b2 else d.expected_prefix
        keys = list(d.b2.keys) if d.b2 else None
        log.extend(
            delete_b2_prefix(app.env, app.secrets, prefix, dry_run=False, known_keys=keys)
        )
        try:
            delete_match_row(app.env, app.secrets, d.match_id)
            log.append(f"deleted DB {d.match_id}")
        except Exception as e:
            log.append(f"DB FAILED  {d.match_id}  {e}")
        log.append("")
    app.flash_ok("Full delete done")
    show_text(app, "Delete log", log)


def _browse_b2_only(app: App, report: ReconcileReport) -> None:
    items = report.b2_only
    if not items:
        app.flash_ok("No B2-only orphans")
        return
    while True:
        rows = [_fmt_b2_only_row(e) for e in items]
        try:
            picks = pick_from_list(
                app, "B2 only (no Supabase row)",
                rows,
                subtitle=f"{len(items)} orphan prefix(es)  ·  Space multi-select  ·  Enter actions",
                multi=True,
            )
        except Cancel:
            return
        assert isinstance(picks, list)
        selected = [items[i] for i in picks]
        try:
            act = menu_select(
                app, "B2-only actions",
                [
                    ("Delete B2 objects", "Remove orphan storage under selected prefixes."),
                    ("Inspect objects", "Show full key list for first selection."),
                    ("Select again", "Back to the list."),
                    ("Back to summary", "Return to reconcile summary."),
                ],
                subtitle=f"{len(selected)} selected",
            )
        except Cancel:
            continue
        if act == 0:
            _reconcile_delete_b2_entries(app, selected)
            # drop deleted from local view (optimistic; user can re-scan)
            gone = {e.match_id for e in selected}
            items[:] = [e for e in items if e.match_id not in gone]
            report.b2_only = items
            if not items:
                return
        elif act == 1:
            e = selected[0]
            lines = [
                f"match_id   {e.match_id}",
                f"origin     {e.origin}",
                f"owner_id   {e.owner_id or '—'}",
                f"prefix     {e.prefix}",
                f"objects    {e.object_count}",
                "",
                *sorted(e.keys),
            ]
            show_text(app, f"B2 · {clip(e.match_id, 20)}", lines)
        elif act == 3:
            return


def _browse_db_only(app: App, report: ReconcileReport) -> None:
    items = report.db_only
    if not items:
        app.flash_ok("No Supabase-only rows")
        return
    while True:
        # Suspicious first, then expected-empty pending
        items.sort(
            key=lambda m: (
                0 if (m.get("status") or "").lower() in ("ready", "processing", "failed") else 1,
                m.get("created_at") or "",
            ),
            reverse=False,
        )
        rows = [_fmt_db_only_row(m) for m in items]
        n_sus = len(report.db_only_suspicious)
        try:
            picks = pick_from_list(
                app, "Supabase only (no B2 objects)",
                rows,
                subtitle=(
                    f"{len(items)} row(s)  ·  {n_sus} suspicious (!)  ·  "
                    f"· = pending empty  ·  Space multi  ·  Enter actions"
                ),
                multi=True,
            )
        except Cancel:
            return
        assert isinstance(picks, list)
        selected = [items[i] for i in picks]
        try:
            act = menu_select(
                app, "DB-only actions",
                [
                    ("Re-queue pipeline", "matches-ingest so workers re-download / re-upload to B2."),
                    ("Delete DB rows", "Drop matches (+ jobs). Leaves B2 alone (already empty)."),
                    ("Set status…", "PATCH status without touching storage."),
                    ("Inspect first", "Show match fields."),
                    ("Select again", "Back to the list."),
                    ("Back to summary", "Return to reconcile summary."),
                ],
                subtitle=f"{len(selected)} selected",
            )
        except Cancel:
            continue
        if act == 0:
            _reconcile_queue_matches(app, selected)
        elif act == 1:
            _reconcile_delete_db_rows(app, selected)
            gone = {m["id"] for m in selected}
            items[:] = [m for m in items if m["id"] not in gone]
            report.db_only = items
            if not items:
                return
        elif act == 2:
            _reconcile_set_status(app, selected)
        elif act == 3:
            m = selected[0]
            prefix = match_b2_prefix(m.get("owner_id"), m["id"])
            show_text(app, "Match", [
                f"id          {m['id']}",
                f"status      {m.get('status')}",
                f"owner_id    {m.get('owner_id') or '—'}",
                f"source_url  {m.get('source_url') or '—'}",
                f"tournament  {m.get('tournament') or '—'}",
                f"expected B2 {prefix}",
                f"created_at  {m.get('created_at')}",
                "",
                "No objects found under the expected B2 prefix.",
            ])
        elif act == 5:
            return


def _browse_drift(app: App, report: ReconcileReport) -> None:
    items = report.drift
    if not items:
        app.flash_ok("No asset/status drift")
        return
    while True:
        rows = [_fmt_drift_row(d) for d in items]
        try:
            picks = pick_from_list(
                app, "Drift (both sides, inconsistent)",
                rows,
                subtitle=f"{len(items)} issue(s)  ·  Space multi-select  ·  Enter actions",
                multi=True,
            )
        except Cancel:
            return
        assert isinstance(picks, list)
        selected = [items[i] for i in picks]
        try:
            act = menu_select(
                app, "Drift actions",
                [
                    ("Re-queue pipeline", "Re-run normalize (and later stages) from source/B2."),
                    ("Set status…", "Align DB status with what is actually in B2."),
                    ("Delete B2 only", "Keep DB row; wipe storage under the match prefix."),
                    ("Delete DB only", "Keep B2 objects; drop matches row."),
                    ("Delete B2 + DB", "Full cleanup for selected matches."),
                    ("Inspect first", "Show issues + object inventory."),
                    ("Select again", "Back to the list."),
                    ("Back to summary", "Return to reconcile summary."),
                ],
                subtitle=f"{len(selected)} selected",
            )
        except Cancel:
            continue
        if act == 0:
            _reconcile_queue_matches(app, [d.match for d in selected])
        elif act == 1:
            _reconcile_set_status(app, [d.match for d in selected])
        elif act == 2:
            entries = []
            for d in selected:
                if d.b2:
                    entries.append(d.b2)
                else:
                    entries.append(B2Entry(
                        match_id=d.match_id,
                        owner_id=d.match.get("owner_id"),
                        prefix=d.expected_prefix,
                    ))
            _reconcile_delete_b2_entries(app, entries)
        elif act == 3:
            _reconcile_delete_db_rows(app, [d.match for d in selected])
            gone = {d.match_id for d in selected}
            items[:] = [d for d in items if d.match_id not in gone]
            report.drift = items
            if not items:
                return
        elif act == 4:
            _reconcile_delete_both_drift(app, selected)
            gone = {d.match_id for d in selected}
            items[:] = [d for d in items if d.match_id not in gone]
            report.drift = items
            if not items:
                return
        elif act == 5:
            d = selected[0]
            m = d.match
            lines = [
                f"id              {m['id']}",
                f"status          {m.get('status')}",
                f"owner_id        {m.get('owner_id') or '—'}",
                f"source_url      {m.get('source_url') or '—'}",
                f"expected prefix {d.expected_prefix}",
                f"actual prefix   {d.b2.prefix if d.b2 else '—'}",
                "",
                "Issues",
                *[f"  • {iss}" for iss in d.issues],
                "",
                f"B2 objects ({d.b2.object_count if d.b2 else 0})",
            ]
            if d.b2:
                lines.extend(f"  {k}" for k in sorted(d.b2.keys))
            else:
                lines.append("  (none)")
            show_text(app, f"Drift · {clip(m['id'], 18)}", lines)
        elif act == 7:
            return


def screen_reconcile(app: App) -> None:
    scope_i = menu_select(
        app, "Reconcile B2 ↔ Supabase",
        [
            ("Full scan (BWF + user)", "List all B2 prefixes and every matches row."),
            ("BWF / system only", "owner_id IS NULL  ·  bwf/<id>/"),
            ("User uploads only", "owner_id set  ·  users/<owner>/<id>/"),
        ],
        subtitle=f"Find orphans and asset/status drift  ·  {app.env.label}",
    )
    scope = ("all", "bwf", "user")[scope_i]

    def on_progress(msg: str) -> None:
        app.set_status(f"  {msg}", "dim")
        app.paint_chrome("Reconcile", "scanning…")
        app.stdscr.refresh()

    try:
        on_progress("starting scan…")
        report = build_reconcile_report(
            app.env, app.secrets, scope=scope, on_progress=on_progress,
        )
    except Exception as e:
        app.flash_error(str(e))
        show_text(
            app, "Reconcile failed",
            textwrap.wrap(str(e), 70)
            + ["", *traceback.format_exc().splitlines()[-8:]],
        )
        return

    n_sus = len(report.db_only_suspicious)
    n_exp = len(report.db_only_expected)
    if report.problem_count == 0 and not report.loose_keys and not report.path_conflicts:
        note = f"  ·  {n_exp} pending empty (ok)" if n_exp else ""
        app.flash_ok(
            f"In sync  ·  {report.synced} match(es)  ·  "
            f"DB={report.db_total}  B2={report.b2_total}{note}"
        )
    else:
        app.flash_warn(
            f"{report.problem_count} issue(s)  ·  "
            f"B2-only={len(report.b2_only)}  DB-orphan={n_sus}  "
            f"drift={len(report.drift)}"
            + (f"  ·  {n_exp} pending empty" if n_exp else "")
        )

    while True:
        summary_lines = [
            f"Environment   {app.env.label}  scope={scope}",
            f"DB matches    {report.db_total}",
            f"B2 prefixes   {report.b2_total}",
            f"In sync       {report.synced}",
            "",
            f"B2 only       {len(report.b2_only):>4}   objects in storage, no matches row",
            f"DB only       {len(report.db_only):>4}   "
            f"({n_sus} suspicious · {n_exp} pending/empty ok)",
            f"Drift         {len(report.drift):>4}   both sides, status/assets disagree",
        ]
        if report.path_conflicts:
            summary_lines.append(f"Path conflicts {len(report.path_conflicts):>3}")
        if report.loose_keys:
            summary_lines.append(f"Loose B2 keys  {len(report.loose_keys):>3}   unrecognised layout")

        try:
            act = menu_select(
                app, "Reconcile summary",
                [
                    (
                        f"B2 only ({len(report.b2_only)})",
                        "Orphan storage — delete prefixes, or inspect objects.",
                    ),
                    (
                        f"Supabase only ({len(report.db_only)})",
                        f"{n_sus} suspicious (ready/failed empty); "
                        f"{n_exp} pending empty (often normal). Re-queue / delete / set status.",
                    ),
                    (
                        f"Drift ({len(report.drift)})",
                        "Both exist but status vs assets disagree — fix or clean up.",
                    ),
                    ("View full report", "Scrollable text dump of every issue."),
                    ("Loose / conflicts", "Unrecognised keys and dual-prefix matches."),
                    ("Re-scan", "Run the scan again after fixes."),
                    ("Done", "Back to home."),
                ],
                subtitle=(
                    f"synced={report.synced}  problems={report.problem_count}  "
                    f"DB={report.db_total}  B2={report.b2_total}"
                ),
            )
        except Cancel:
            return

        if act == 0:
            _browse_b2_only(app, report)
        elif act == 1:
            _browse_db_only(app, report)
        elif act == 2:
            _browse_drift(app, report)
        elif act == 3:
            lines = list(summary_lines) + ["", "── B2 only ──"]
            if not report.b2_only:
                lines.append("  (none)")
            for e in report.b2_only:
                lines.append(
                    f"  {e.match_id}  {e.prefix}  "
                    f"[{', '.join(sorted(e.basenames)[:8])}]"
                )
            lines += ["", "── DB only ──"]
            if not report.db_only:
                lines.append("  (none)")
            for m in report.db_only:
                lines.append(
                    f"  {m['id']}  status={m.get('status')}  "
                    f"src={clip(m.get('source_url'), 40)}"
                )
            lines += ["", "── Drift ──"]
            if not report.drift:
                lines.append("  (none)")
            for d in report.drift:
                lines.append(f"  {d.match_id}  status={d.match.get('status')}")
                for iss in d.issues:
                    lines.append(f"      • {iss}")
                if d.b2:
                    lines.append(f"      files: {', '.join(sorted(d.b2.basenames))}")
            show_text(app, "Full reconcile report", lines)
        elif act == 4:
            lines = ["Path conflicts", ""]
            if report.path_conflicts:
                lines.extend(f"  {c}" for c in report.path_conflicts)
            else:
                lines.append("  (none)")
            lines += ["", "Loose B2 keys (not under bwf/<id>/ or users/<owner>/<id>/)", ""]
            if report.loose_keys:
                lines.extend(f"  {k}" for k in report.loose_keys[:200])
                if len(report.loose_keys) > 200:
                    lines.append(f"  … and {len(report.loose_keys) - 200} more")
            else:
                lines.append("  (none)")
            show_text(app, "Loose keys & conflicts", lines)
        elif act == 5:
            try:
                on_progress("re-scanning…")
                report = build_reconcile_report(
                    app.env, app.secrets, scope=scope, on_progress=on_progress,
                )
                app.flash_ok(
                    f"Re-scan  ·  {report.problem_count} issue(s)  ·  "
                    f"synced={report.synced}"
                )
            except Exception as e:
                app.flash_error(str(e))
                show_text(app, "Re-scan failed", textwrap.wrap(str(e), 70))
        else:
            return


# ─── entry ────────────────────────────────────────────────────────────────────


HOME_ITEMS: list[tuple[str, str]] = [
    ("Browse matches", "Scroll the catalog. Filter by origin or status. Open a match for details."),
    ("Queue for processing", "Enqueue BWF matches only — cron dispatches to vast (~1 min)."),
    ("Ingest a video", "Annotate, create match + job (enqueue only; cron dispatches)."),
    ("Delete a match", "Remove B2 objects and/or the database row (jobs cascade)."),
    ("Reconcile storage", "Find B2↔Supabase orphans and asset/status drift; fix or clean up."),
    ("Force dispatch", "Emergency drain — normally pg_cron pops the queue every minute."),
    ("Pipeline snapshot", "Counts by status + currently live jobs."),
    ("Settings", "Edit secrets & variables for this environment. Test connections."),
    ("Switch environment", "Toggle between DEV and PROD databases / CDN / secrets."),
    ("Quit", "Exit the app."),
]


def _curses_main(stdscr: Any, initial_env: str) -> None:
    curses.curs_set(0)
    stdscr.keypad(True)
    curses.noecho()
    curses.cbreak()
    try:
        curses.set_escdelay(25)
    except Exception:
        pass

    app = App(stdscr=stdscr, env=PROFILES[initial_env])
    app.init_colors()
    app.set_status(
        f"  ready on {app.env.label}  ·  ↑↓ navigate  ·  Enter select  ·  e env  ·  , settings",
        "dim",
    )
    screen_home(app)


def screen_home(app: App) -> None:
    items = HOME_ITEMS
    idx = 0
    (
        I_BROWSE, I_QUEUE, I_INGEST, I_DELETE, I_RECONCILE,
        I_DISPATCH, I_SNAP, I_SETTINGS, I_ENV, I_QUIT,
    ) = range(10)

    while True:
        miss = app.missing_secrets()
        set_n, total = app.config_score()
        if miss and app.status_kind not in ("ok", "err"):
            app.set_status(
                f"  missing required: {', '.join(miss)}  ·  open Settings to fix",
                "warn",
            )

        top, bottom, w = app.paint_chrome(
            "Home",
            "↑↓ move   Enter select   e env   , settings   1-0 jump   q quit",
        )
        y = top

        # welcome card
        bar = progress_bar(set_n, total, 12)
        sub = (
            f"Working on {app.env.label}  ·  {app.env.project_ref}  ·  "
            f"config [{bar}] {set_n}/{total}"
        )
        app.add(y, 2, clip(sub, w - 4), app.attr(C_MUTED))
        y += 1
        app.hline(y, 2, min(w - 4, 64))
        y += 2

        left_w = min(42, max(28, w // 2 - 4))
        panel_x = left_w + 5

        icons = ["☰", "⇢", "＋", "⌫", "⇄", "▶", "◈", "⚙", "⇅", "✕"]
        for i, (label, _desc) in enumerate(items):
            if y + i >= bottom - 2:
                break
            selected = i == idx
            num = f"{(i + 1) % 10}"  # 1..9 then 0 for 10th
            icon = icons[i] if i < len(icons) else "·"
            # highlight settings if incomplete
            warn_settings = i == I_SETTINGS and bool(miss)
            if selected:
                bar_txt = f"  {num}  {icon}  {label}"
                app.add(
                    y + i, 1,
                    clip(bar_txt.ljust(left_w + 1), left_w + 2),
                    app.attr(C_SEL, bold=True),
                )
            else:
                app.add(y + i, 3, num, app.attr(C_NUM))
                app.add(y + i, 6, icon, app.attr(C_WARN if warn_settings else C_ACCENT))
                app.add(
                    y + i, 9,
                    clip(label, left_w - 10),
                    app.attr(C_WARN, bold=True) if warn_settings else curses.A_NORMAL,
                )

        # description card
        _label, desc = items[idx]
        if panel_x + 12 < w:
            width = min(40, w - panel_x - 3)
            py = y
            app.box(py, panel_x, min(14, bottom - py - 1), width + 2, title="about")
            app.add(py + 2, panel_x + 2, clip(_label, width - 2), app.attr(C_TITLE, bold=True))
            wrapped = textwrap.wrap(desc, max(10, width - 2))[:6]
            for j, line in enumerate(wrapped):
                app.add(py + 4 + j, panel_x + 2, line, app.attr(C_MUTED))
            # env tip
            tip_y = py + 4 + len(wrapped) + 1
            if tip_y < bottom - 2:
                if idx == I_SETTINGS:
                    tip = f"file: {os.path.basename(app.env.secrets_path)}"
                elif idx == I_ENV:
                    tip = f"now: {app.env.label}"
                elif idx == I_RECONCILE:
                    tip = "scan B2 + DB · fix orphans"
                else:
                    tip = "prod is red · be careful"
                app.add(tip_y, panel_x + 2, clip(tip, width - 2), app.attr(C_ACCENT))

        app.add(
            bottom - 1, 2,
            clip(f"secrets  {app.env.secrets_path}", w - 4),
            app.attr(C_MUTED),
        )

        app.stdscr.refresh()
        ch = app.getch()

        def run_action(i: int) -> None:
            if i == I_QUIT:
                return
            app.set_status("")
            try:
                if i == I_BROWSE:
                    screen_browse(app)
                elif i == I_QUEUE:
                    screen_queue(app)
                elif i == I_INGEST:
                    screen_ingest(app)
                elif i == I_DELETE:
                    screen_delete(app)
                elif i == I_RECONCILE:
                    screen_reconcile(app)
                elif i == I_DISPATCH:
                    screen_dispatch(app)
                elif i == I_SNAP:
                    screen_snapshot(app)
                elif i == I_SETTINGS:
                    screen_settings(app)
                elif i == I_ENV:
                    screen_switch_env(app)
            except Cancel:
                app.set_status("  cancelled", "dim")
            except Exception as e:
                app.flash_error(str(e))
                show_text(
                    app, "Error",
                    textwrap.wrap(str(e), 70)
                    + ["", *traceback.format_exc().splitlines()[-8:]],
                )

        if ch in (curses.KEY_UP, ord("k"), ord("K")):
            idx = (idx - 1) % len(items)
        elif ch in (curses.KEY_DOWN, ord("j"), ord("J")):
            idx = (idx + 1) % len(items)
        elif ch in (ord("e"), ord("E")):
            try:
                screen_switch_env(app)
            except Cancel:
                pass
        elif ch in (ord(","), ord(".")):
            try:
                screen_settings(app)
            except Cancel:
                pass
        elif ch in (27, ord("q"), ord("Q")):
            if confirm(app, "Quit?", ["Leave Mintonix backend?"], default_no=False):
                return
        elif ch in (10, 13, curses.KEY_ENTER):
            if idx == I_QUIT:
                if confirm(app, "Quit?", ["Leave Mintonix backend?"], default_no=False):
                    return
            else:
                run_action(idx)
        elif ord("1") <= ch <= ord("9") or ch == ord("0"):
            n = 9 if ch == ord("0") else ch - ord("1")
            if n < len(items):
                idx = n
                if n == I_QUIT:
                    if confirm(app, "Quit?", ["Leave Mintonix backend?"], default_no=False):
                        return
                else:
                    run_action(n)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return

    initial = "dev"
    args = sys.argv[1:]
    for a in args:
        if a in ("--prod", "-p"):
            initial = "prod"
        elif a in ("--dev", "-d"):
            initial = "dev"
        elif a in ("dev", "prod"):
            initial = a
        else:
            print("Usage:  python3 scripts/manage.py [--dev|--prod]\n")
            print("Full-screen TUI. Settings page edits ~/.mintonix/*-secrets.env")
            sys.exit(2)

    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("Need an interactive terminal (TTY).", file=sys.stderr)
        sys.exit(1)

    try:
        curses.wrapper(_curses_main, initial)
    except KeyboardInterrupt:
        pass
    print("bye")


if __name__ == "__main__":
    main()
