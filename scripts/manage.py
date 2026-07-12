#!/usr/bin/env python3
"""Interactive backend ops CLI for the Mintonix match pipeline (DEV).

Run with no args for a menu-driven session:

    python3 scripts/manage.py

Catalog load (scraper → `matches` rows) does NOT enqueue pipeline jobs.
Use Queue after a scrape to start normalize for matches that have a
`source_url`.

Secrets (~/.mintonix/dev-secrets.env, or environment):

  PIPELINE_SERVICE_TOKEN     matches-ingest + jobs/dispatch
  SUPABASE_URL               default: dev project
  SUPABASE_SERVICE_ROLE_KEY  or SUPABASE_SERVICE_KEY — PostgREST
  CDN_PRESIGN_URL            e.g. https://cdn-dev.mintonix.com/presign
  PRESIGN_SERVICE_TOKEN      CDN Worker control plane (storage list/delete)

  For user-upload ingest also need:
  SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

SECRETS_FILE = os.path.expanduser("~/.mintonix/dev-secrets.env")
DEFAULT_SUPABASE_URL = "https://xaxyuytvgcdbdnndhgwj.supabase.co"
DEFAULT_CDN_PRESIGN = "https://cdn-dev.mintonix.com/presign"

KNOWN_BASENAMES = (
    "original.mp4",
    "original.mov",
    "original.mkv",
    "annotation.json",
    "normalized.mp4",
    "thumbnail.jpg",
    "valid.mp4",
    "frame_manifest.csv",
    "scores.csv",
    "detections.json",
    "analysis.json",
)

MATCH_SELECT = (
    "id,owner_id,source_url,tournament,match_date,status,created_at,"
    "team1_player1,team1_player2,team2_player1,team2_player2,"
    "g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2"
)

METADATA_COLS = (
    "source_url",
    "tournament",
    "match_date",
    "team1_player1",
    "team1_player2",
    "team2_player1",
    "team2_player2",
    "g1_t1",
    "g1_t2",
    "g2_t1",
    "g2_t2",
    "g3_t1",
    "g3_t2",
)


# ---------------------------------------------------------------- prompts


class Cancel(Exception):
    """User cancelled the current action (return to menu)."""


def _stdin_line(prompt: str) -> str:
    try:
        return input(prompt)
    except (EOFError, KeyboardInterrupt):
        print()
        raise Cancel from None


def ask(prompt: str, *, default: str | None = None) -> str:
    """Free-text prompt. Empty input → default if set, else re-prompt.
    Enter 'q' / 'quit' / 'back' to cancel to the main menu."""
    suffix = f" [{default}]" if default is not None else ""
    while True:
        raw = _stdin_line(f"{prompt}{suffix}: ").strip()
        if raw.lower() in ("q", "quit", "back"):
            raise Cancel
        if raw:
            return raw
        if default is not None:
            return default
        print("  (required — or q to go back)")


def ask_optional(prompt: str, *, default: str = "") -> str:
    """Optional free-text; empty returns default. 'q' still cancels."""
    suffix = f" [{default}]" if default else " [enter to skip]"
    raw = _stdin_line(f"{prompt}{suffix}: ").strip()
    if raw.lower() in ("q", "quit", "back"):
        raise Cancel
    return raw if raw else default


def ask_yes_no(prompt: str, *, default: bool = False) -> bool:
    hint = "Y/n" if default else "y/N"
    while True:
        raw = _stdin_line(f"{prompt} [{hint}]: ").strip().lower()
        if raw in ("q", "quit", "back"):
            raise Cancel
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        print("  enter y or n (or q to go back)")


def ask_int(prompt: str, *, default: int | None = None, min_v: int | None = None) -> int:
    while True:
        raw = ask(prompt, default=None if default is None else str(default))
        try:
            n = int(raw)
        except ValueError:
            print("  enter an integer")
            continue
        if min_v is not None and n < min_v:
            print(f"  must be ≥ {min_v}")
            continue
        return n


def ask_choice(prompt: str, choices: list[tuple[str, str]], *, default: str | None = None) -> str:
    """choices: list of (key, label). Returns key. default is a key."""
    print(prompt)
    key_set = {k for k, _ in choices}
    for i, (key, label) in enumerate(choices, 1):
        mark = " *" if default is not None and key == default else ""
        print(f"  {i}) {label}{mark}")
    while True:
        raw = _stdin_line("  choice (number or key, q=back): ").strip().lower()
        if raw in ("q", "quit", "back"):
            raise Cancel
        if not raw and default is not None:
            return default
        if raw in key_set:
            return raw
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(choices):
                return choices[idx - 1][0]
        print("  invalid choice")


def pause() -> None:
    try:
        _stdin_line("\n[enter] back to menu  ")
    except Cancel:
        pass


def banner(secrets: dict[str, str]) -> None:
    url = supabase_url(secrets)
    host = url.replace("https://", "").replace("http://", "").split("/")[0]
    print()
    print("┌─────────────────────────────────────────────┐")
    print("│  Mintonix backend  ·  interactive ops CLI   │")
    print("└─────────────────────────────────────────────┘")
    print(f"  project  {host}")
    print(f"  secrets  {SECRETS_FILE}")
    print(f"  cdn      {cdn_presign_url(secrets)}")
    print("  tip      type q at any prompt to cancel")
    print()


# ---------------------------------------------------------------- secrets / HTTP


def load_secrets() -> dict[str, str]:
    secrets: dict[str, str] = {}
    try:
        with open(SECRETS_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    secrets[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    for k, v in os.environ.items():
        if v:
            secrets[k] = v
    return secrets


def missing_secrets(secrets: dict[str, str], *keys: str) -> list[str]:
    return [k for k in keys if not secrets.get(k)]


def require(secrets: dict[str, str], *keys: str) -> None:
    miss = missing_secrets(secrets, *keys)
    if miss:
        raise RuntimeError(
            f"missing secret(s): {', '.join(miss)}\n"
            f"  set in {SECRETS_FILE} or the environment"
        )


def supabase_url(secrets: dict[str, str]) -> str:
    return (secrets.get("SUPABASE_URL") or DEFAULT_SUPABASE_URL).rstrip("/")


def functions_base(secrets: dict[str, str]) -> str:
    return f"{supabase_url(secrets)}/functions/v1"


def service_key(secrets: dict[str, str]) -> str:
    return (
        secrets.get("SUPABASE_SERVICE_ROLE_KEY")
        or secrets.get("SUPABASE_SERVICE_KEY")
        or ""
    )


def rest_headers(secrets: dict[str, str]) -> dict[str, str]:
    key = service_key(secrets)
    if not key:
        raise RuntimeError(
            "need SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY "
            f"in {SECRETS_FILE} (service role; bypasses RLS)"
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
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {detail}") from e


def post_fn(secrets: dict[str, str], path: str, headers: dict[str, str], body: dict) -> Any:
    return http_json(
        "POST",
        f"{functions_base(secrets)}{path}",
        {"Content-Type": "application/json", **headers},
        body,
    )


# ---------------------------------------------------------------- B2 via CDN /presign


def cdn_presign_url(secrets: dict[str, str]) -> str:
    return (secrets.get("CDN_PRESIGN_URL") or DEFAULT_CDN_PRESIGN).rstrip("/")


def cdn_control(secrets: dict[str, str], body: dict, timeout: float = 60) -> dict:
    require(secrets, "PRESIGN_SERVICE_TOKEN")
    return http_json(
        "POST",
        cdn_presign_url(secrets),
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secrets['PRESIGN_SERVICE_TOKEN']}",
        },
        body,
        timeout=timeout,
    )


def list_prefix_keys(secrets: dict[str, str], prefix: str) -> list[str]:
    keys: list[str] = []
    token: str | None = None
    while True:
        body: dict[str, Any] = {"op": "LIST", "prefix": prefix, "maxKeys": 1000}
        if token:
            body["continuationToken"] = token
        result = cdn_control(secrets, body)
        keys.extend(result.get("keys") or [])
        if not result.get("isTruncated"):
            break
        token = result.get("nextContinuationToken")
        if not token:
            break
    return keys


def delete_b2_key(secrets: dict[str, str], key: str, dry_run: bool) -> str:
    if dry_run:
        return "would-delete"
    signed = cdn_control(secrets, {"op": "DELETE", "key": key})
    url = signed["url"]
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
            return f"deleted ({resp.status})"
    except urllib.error.HTTPError as e:
        if e.code in (404, 204):
            return f"gone ({e.code})"
        detail = e.read().decode(errors="replace")[:200]
        raise RuntimeError(f"DELETE {key} -> HTTP {e.code}: {detail}") from e


def match_b2_prefix(owner_id: str | None, match_id: str) -> str:
    if owner_id:
        return f"users/{owner_id}/{match_id}/"
    return f"bwf/{match_id}/"


# ---------------------------------------------------------------- data access


def fetch_matches(
    secrets: dict[str, str],
    *,
    match_id: str | None = None,
    bwf_only: bool = False,
    user_only: bool = False,
    with_source: bool = False,
    status: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    params: list[str] = [
        f"select={MATCH_SELECT}",
        "order=created_at.desc",
    ]
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

    url = f"{supabase_url(secrets)}/rest/v1/matches?{'&'.join(params)}"
    result = http_json("GET", url, rest_headers(secrets))
    return result or []


def live_job_match_ids(secrets: dict[str, str], match_ids: list[str]) -> set[str]:
    if not match_ids:
        return set()
    live: set[str] = set()
    chunk = 50
    for i in range(0, len(match_ids), chunk):
        part = match_ids[i : i + chunk]
        ids = ",".join(part)
        url = (
            f"{supabase_url(secrets)}/rest/v1/jobs"
            f"?select=match_id&status=in.(queued,processing)&match_id=in.({ids})"
        )
        rows = http_json("GET", url, rest_headers(secrets)) or []
        live.update(r["match_id"] for r in rows)
    return live


def print_matches(matches: list[dict], *, numbered: bool = False) -> None:
    if not matches:
        print("  (no rows)")
        return
    for i, m in enumerate(matches, 1):
        origin = "user" if m.get("owner_id") else "bwf"
        src = m.get("source_url") or ""
        if len(src) > 44:
            src = src[:41] + "…"
        mid = m["id"]
        short = mid if len(mid) <= 16 else mid[:16]
        prefix = f"  {i:3}) " if numbered else "  "
        print(
            f"{prefix}{short:16}  {origin:4}  {m.get('status') or '?':10}  "
            f"{(m.get('tournament') or '')[:36]:36}  {src}"
        )
    print(f"\n  {len(matches)} row(s)")


def pick_match_from_list(matches: list[dict], *, prompt: str = "Select match") -> dict:
    print_matches(matches, numbered=True)
    while True:
        raw = ask(f"{prompt} (number or full id)")
        if raw.isdigit():
            idx = int(raw)
            if 1 <= idx <= len(matches):
                return matches[idx - 1]
            print(f"  pick 1–{len(matches)}")
            continue
        for m in matches:
            if m["id"] == raw or m["id"].startswith(raw):
                return m
        print("  no match for that id / prefix")


# ---------------------------------------------------------------- actions


def do_list(secrets: dict[str, str]) -> None:
    print("\n── List matches ──")
    origin = ask_choice(
        "Origin filter:",
        [
            ("all", "All matches"),
            ("bwf", "BWF / system only"),
            ("user", "User-owned only"),
        ],
        default="all",
    )
    status = ask_optional("Status filter (pending|processing|ready|failed)")
    with_source = ask_yes_no("Only rows with source_url?", default=False)
    limit = ask_int("Limit", default=50, min_v=1)

    matches = fetch_matches(
        secrets,
        bwf_only=origin == "bwf",
        user_only=origin == "user",
        with_source=with_source,
        status=status or None,
        limit=limit,
    )
    print()
    print_matches(matches)


def do_ingest(secrets: dict[str, str]) -> None:
    print("\n── Ingest video ──")
    print("  Opens the annotation UI (annotate_and_ingest.py).")
    lane = ask_choice(
        "Source lane:",
        [
            ("bwf", "YouTube / BWF (system lane — worker downloads)"),
            ("upload", "Local file (user-upload lane)"),
            ("both", "YouTube URL + local file as scrub proxy"),
        ],
        default="bwf",
    )

    url = file_path = tournament = None
    if lane in ("bwf", "both"):
        url = ask("YouTube URL")
        tournament = ask("Tournament label (e.g. 2025 Worlds-MS-Final)")
    if lane in ("upload", "both"):
        file_path = ask("Path to local video file")
        if not os.path.isfile(file_path):
            raise RuntimeError(f"file not found: {file_path}")

    queue = "jobs_bulk"
    if lane != "upload":
        queue = ask_choice(
            "Queue:",
            [
                ("jobs_bulk", "jobs_bulk (BWF backlog)"),
                ("jobs_interactive", "jobs_interactive"),
            ],
            default="jobs_bulk",
        )

    dispatch = ask_yes_no("Dispatch a job after ingest?", default=False)
    dry_run = ask_yes_no("Dry-run (annotate only, write nothing)?", default=False)

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "annotate_and_ingest.py")
    if not os.path.isfile(script):
        raise RuntimeError(f"annotate_and_ingest.py not found ({script})")

    cmd = [sys.executable, script]
    if url:
        cmd += ["--url", url]
    if file_path:
        cmd += ["--file", file_path]
    if tournament:
        cmd += ["--tournament", tournament]
    if lane != "upload":
        cmd += ["--queue", queue]
    if dispatch:
        cmd.append("--dispatch")
    if dry_run:
        cmd.append("--dry-run")

    print(f"\n[info] exec: {' '.join(cmd)}\n")
    code = subprocess.call(cmd)
    if code != 0:
        print(f"[warn] annotate_and_ingest exited {code}")


def do_queue(secrets: dict[str, str]) -> None:
    print("\n── Queue matches ──")
    print("  Enqueue normalize for scraper catalog rows (matches-ingest).")
    require(secrets, "PIPELINE_SERVICE_TOKEN")

    mode = ask_choice(
        "Queue scope:",
        [
            ("one", "One match (by id or pick from list)"),
            ("all", "All BWF matches with source_url"),
        ],
        default="all",
    )

    matches: list[dict]
    if mode == "one":
        pick = ask_choice(
            "How to choose the match:",
            [
                ("id", "Enter match id"),
                ("list", "Browse recent BWF with source_url"),
            ],
            default="list",
        )
        if pick == "id":
            mid = ask("Match id")
            matches = fetch_matches(secrets, match_id=mid)
            if not matches:
                raise RuntimeError(f"no match with id={mid}")
        else:
            recent = fetch_matches(secrets, bwf_only=True, with_source=True, limit=30)
            if not recent:
                print("  no BWF matches with source_url")
                return
            matches = [pick_match_from_list(recent)]
    else:
        status = ask_optional("Only status (pending|processing|ready|failed)")
        limit_raw = ask_optional("Limit (empty = no limit)")
        limit = int(limit_raw) if limit_raw else None
        matches = fetch_matches(
            secrets,
            bwf_only=True,
            with_source=True,
            status=status or None,
            limit=limit,
        )
        if not matches:
            print("  no BWF matches with source_url to queue")
            return
        print(f"\n  candidates: {len(matches)}")
        print_matches(matches[:15])
        if len(matches) > 15:
            print(f"  … and {len(matches) - 15} more")

    skip_live = ask_yes_no("Skip matches that already have a live job?", default=True)
    if skip_live:
        live = live_job_match_ids(secrets, [m["id"] for m in matches])
        before = len(matches)
        matches = [m for m in matches if m["id"] not in live]
        skipped = before - len(matches)
        if skipped:
            print(f"  skipped {skipped} already live (queued/processing)")

    if not matches:
        print("  nothing to queue")
        return

    queue = ask_choice(
        "Target queue:",
        [
            ("jobs_bulk", "jobs_bulk"),
            ("jobs_interactive", "jobs_interactive"),
        ],
        default="jobs_bulk",
    )
    priority = ask_int("Priority (lower runs first)", default=100, min_v=0)
    dry_run = ask_yes_no("Dry-run (print only)?", default=False)
    dispatch = False
    dispatch_max = 1
    if not dry_run:
        dispatch = ask_yes_no("Dispatch after queueing?", default=False)
        if dispatch:
            dispatch_max = ask_int("How many jobs to dispatch?", default=1, min_v=1)

    if not dry_run and not ask_yes_no(
        f"Enqueue {len(matches)} match(es) on {queue}?", default=True
    ):
        print("  aborted")
        return

    hdr = {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]}
    queued = already = failed = 0
    print()
    for m in matches:
        mid = m["id"]
        if dry_run:
            print(f"  [dry-run] would queue {mid}  source={m.get('source_url')!r}")
            queued += 1
            continue
        body: dict[str, Any] = {
            "id": mid,
            "upsert": True,
            "queue": queue,
            "priority": priority,
        }
        for col in METADATA_COLS:
            if m.get(col) is not None:
                body[col] = m[col]
        try:
            result = post_fn(secrets, "/matches-ingest", hdr, body)
            if result.get("already_queued"):
                already += 1
                print(f"  already_queued  {mid}  job={result.get('job_id')}")
            else:
                queued += 1
                print(f"  queued          {mid}  job={result.get('job_id')}")
        except Exception as e:
            failed += 1
            print(f"  FAILED          {mid}  {e}", file=sys.stderr)

    print(f"\n  done: queued={queued} already={already} failed={failed}")

    if dispatch and not dry_run:
        print()
        run_dispatch(secrets, max_jobs=dispatch_max)


def do_delete(secrets: dict[str, str]) -> None:
    print("\n── Delete match ──")
    print("  Removes B2 objects under the match prefix and/or the DB row.")

    pick = ask_choice(
        "How to choose the match:",
        [
            ("id", "Enter match id"),
            ("list", "Browse recent matches"),
        ],
        default="id",
    )
    if pick == "list":
        recent = fetch_matches(secrets, limit=30)
        if not recent:
            print("  no matches in DB")
            return
        row = pick_match_from_list(recent)
        match_id = row["id"]
    else:
        match_id = ask("Match id")
        rows = fetch_matches(secrets, match_id=match_id)
        row = rows[0] if rows else None

    if not row:
        print(f"  no DB row for id={match_id}")
        if not ask_yes_no("Continue with storage-only delete?", default=False):
            return
        scope = "storage"
        prefix_override = ask_optional(
            "B2 prefix override (empty = bwf/<id>/)",
            default=f"bwf/{match_id}/",
        )
    else:
        print()
        print(f"  match_id : {match_id}")
        print(f"  owner_id : {row.get('owner_id') or '(BWF/system)'}")
        print(f"  status   : {row.get('status')}")
        print(f"  source   : {row.get('source_url')}")
        print(f"  prefix   : {match_b2_prefix(row.get('owner_id'), match_id)}")
        scope = ask_choice(
            "What to delete:",
            [
                ("both", "B2 objects + DB row (jobs cascade)"),
                ("storage", "B2 objects only"),
                ("db", "DB row only"),
            ],
            default="both",
        )
        prefix_override = ""

    dry_run = ask_yes_no("Dry-run (print only)?", default=False)

    owner_id = (row or {}).get("owner_id")
    if prefix_override:
        prefix = prefix_override if prefix_override.endswith("/") else prefix_override + "/"
    else:
        prefix = match_b2_prefix(owner_id, match_id)

    do_storage = scope in ("both", "storage")
    do_db = scope in ("both", "db") and bool(row)

    bits = []
    if do_storage:
        bits.append(f"B2 under {prefix}")
    if do_db:
        bits.append(f"DB matches.id={match_id}")
    print(f"\n  plan: {' + '.join(bits) or 'nothing'}")
    if dry_run:
        print("  mode: dry-run")
    elif not ask_yes_no("Proceed with delete?", default=False):
        print("  aborted")
        return

    if do_storage:
        require(secrets, "PRESIGN_SERVICE_TOKEN")
        try:
            keys = list_prefix_keys(secrets, prefix)
        except Exception as e:
            print(f"  [warn] LIST failed ({e}); falling back to known basenames")
            keys = [prefix + name for name in KNOWN_BASENAMES]

        if not keys:
            print("  no B2 objects under prefix")
        else:
            print(f"  {len(keys)} object(s):")
            for key in keys:
                try:
                    status = delete_b2_key(secrets, key, dry_run)
                    print(f"    {status:16} {key}")
                except Exception as e:
                    print(f"    FAILED           {key}  {e}", file=sys.stderr)

    if do_db:
        if dry_run:
            print(f"  [dry-run] would DELETE matches id={match_id} (jobs cascade)")
        else:
            url = (
                f"{supabase_url(secrets)}/rest/v1/matches"
                f"?id=eq.{urllib.parse.quote(match_id, safe='')}"
            )
            http_json("DELETE", url, rest_headers(secrets))
            print(f"  deleted matches row {match_id} (jobs cascaded)")


def run_dispatch(
    secrets: dict[str, str],
    *,
    max_jobs: int = 1,
    vt: int | None = None,
    max_running: int | None = None,
) -> None:
    require(secrets, "PIPELINE_SERVICE_TOKEN")
    body: dict[str, Any] = {"max": max_jobs}
    if vt is not None:
        body["vt"] = vt
    if max_running is not None:
        body["max_running"] = max_running
    result = post_fn(
        secrets,
        "/jobs/dispatch",
        {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]},
        body,
    )
    print(json.dumps(result, indent=2))


def do_dispatch(secrets: dict[str, str]) -> None:
    print("\n── Dispatch jobs ──")
    print("  Claim queued jobs and send them to vast.")
    max_jobs = ask_int("Max jobs to claim", default=1, min_v=1)
    max_running = ask_optional("Max concurrent processing (empty = server default)")
    vt = ask_optional("Visibility timeout seconds (empty = server default)")
    run_dispatch(
        secrets,
        max_jobs=max_jobs,
        vt=int(vt) if vt else None,
        max_running=int(max_running) if max_running else None,
    )


def do_status(secrets: dict[str, str]) -> None:
    print("\n── Pipeline snapshot ──")
    for status in ("pending", "processing", "ready", "failed"):
        rows = fetch_matches(secrets, status=status, limit=1)
        # Count via a second query with Prefer count — keep simple: fetch up to 500
        all_s = fetch_matches(secrets, status=status, limit=500)
        n = len(all_s)
        extra = "+" if n == 500 else ""
        print(f"  matches.{status:10}  {n}{extra}")

    # Live jobs
    url = (
        f"{supabase_url(secrets)}/rest/v1/jobs"
        f"?select=id,match_id,status,stage,queue,attempt"
        f"&status=in.(queued,processing)&order=created_at.desc&limit=20"
    )
    jobs = http_json("GET", url, rest_headers(secrets)) or []
    print(f"\n  live jobs: {len(jobs)}")
    for j in jobs:
        print(
            f"    {j.get('status'):10}  stage={j.get('stage'):10}  "
            f"q={j.get('queue') or '?':16}  attempt={j.get('attempt')}  "
            f"match={str(j.get('match_id'))[:16]}"
        )


# ---------------------------------------------------------------- main menu


MENU: list[tuple[str, str, Callable[[dict[str, str]], None]]] = [
    ("1", "List matches", do_list),
    ("2", "Ingest video (annotate + create job)", do_ingest),
    ("3", "Queue matches (scraper catalog → pipeline)", do_queue),
    ("4", "Delete match (B2 and/or DB)", do_delete),
    ("5", "Dispatch jobs", do_dispatch),
    ("6", "Pipeline snapshot", do_status),
]


def check_startup(secrets: dict[str, str]) -> None:
    """Warn about missing secrets without hard-failing (ops are optional per action)."""
    warnings: list[str] = []
    if not service_key(secrets):
        warnings.append("SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY (list/queue/delete)")
    if not secrets.get("PIPELINE_SERVICE_TOKEN"):
        warnings.append("PIPELINE_SERVICE_TOKEN (queue/dispatch/ingest BWF)")
    if not secrets.get("PRESIGN_SERVICE_TOKEN"):
        warnings.append("PRESIGN_SERVICE_TOKEN (B2 list/delete)")
    if warnings:
        print("  missing secrets (some actions will fail):")
        for w in warnings:
            print(f"    · {w}")
        print()


def interactive_loop(secrets: dict[str, str]) -> None:
    banner(secrets)
    check_startup(secrets)

    while True:
        print("What do you want to do?")
        for key, label, _ in MENU:
            print(f"  {key}) {label}")
        print("  q) Quit")
        try:
            raw = _stdin_line("\n> ").strip().lower()
        except Cancel:
            print("bye")
            return

        if raw in ("q", "quit", "exit"):
            print("bye")
            return
        if raw == "":
            continue

        action = next((fn for key, _label, fn in MENU if raw == key), None)
        if action is None:
            print("  unknown choice — enter a number or q\n")
            continue

        try:
            action(secrets)
        except Cancel:
            print("  (cancelled)\n")
            continue
        except Exception as e:
            print(f"\n  error: {e}\n", file=sys.stderr)
            continue

        pause()
        print()


def main() -> None:
    secrets = load_secrets()
    # Optional one-shot: `manage.py --once` is unused; always interactive.
    # Keep a tiny non-interactive escape hatch for help.
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        print("\nUsage:  python3 scripts/manage.py")
        print("  Starts an interactive menu. Type q at any prompt to go back/quit.")
        return
    if len(sys.argv) > 1:
        print(
            "This is an interactive CLI — run with no arguments:\n"
            "  python3 scripts/manage.py\n",
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        interactive_loop(secrets)
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
