#!/usr/bin/env python3
"""Backend ops CLI for the Mintonix match pipeline (DEV).

Subcommands:

  ingest   Interactive annotate + create job (delegates to annotate_and_ingest.py)
  queue    Enqueue GPU work for scraper-loaded BWF catalog matches (one or all)
  delete   Remove a match's B2 objects and/or DB row (jobs cascade)
  dispatch Kick the jobs dispatcher (pipeline token)
  list     List matches from the DB (filter by origin / status)

Catalog load (scraper → `matches` rows) does NOT enqueue pipeline jobs
(ARCHITECTURE.md / load_to_supabase.py). Use `queue` after a scrape to start
normalize for matches that already have a `source_url`.

Secrets (~/.mintonix/dev-secrets.env, or environment):

  PIPELINE_SERVICE_TOKEN     matches-ingest + jobs/dispatch
  SUPABASE_URL               default: dev project
  SUPABASE_SERVICE_ROLE_KEY  or SUPABASE_SERVICE_KEY — PostgREST (list/delete/queue)
  CDN_PRESIGN_URL            e.g. https://cdn-dev.mintonix.com/presign
  PRESIGN_SERVICE_TOKEN      CDN Worker control plane (storage list/delete)

  For `ingest` (user upload lane) also need the annotate script secrets:
  SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD

Examples:

  # Annotate a YouTube BWF clip and enqueue (+ optional dispatch)
  python3 scripts/manage.py ingest --url 'https://youtu.be/…' \\
      --tournament '2025 Worlds-MS-Final' --dispatch

  # Queue every BWF catalog row that has a source_url and no live job
  python3 scripts/manage.py queue --all

  # Queue one match by id
  python3 scripts/manage.py queue --id <match_id>

  # Delete B2 prefix + DB row (asks for confirmation unless --yes)
  python3 scripts/manage.py delete --id <match_id> --yes

  # Dry-run storage+DB cleanup
  python3 scripts/manage.py delete --id <match_id> --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

SECRETS_FILE = os.path.expanduser("~/.mintonix/dev-secrets.env")
DEFAULT_SUPABASE_URL = "https://xaxyuytvgcdbdnndhgwj.supabase.co"
DEFAULT_CDN_PRESIGN = "https://cdn-dev.mintonix.com/presign"

# Canonical basenames under a match prefix (SUPABASE.md). Used as a fallback
# when LIST is unavailable; real cleanup prefers LIST from the CDN worker.
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
    # Environment wins over the file (CI / one-off overrides).
    for k, v in os.environ.items():
        if v:
            secrets[k] = v
    return secrets


def require(secrets: dict[str, str], *keys: str) -> None:
    missing = [k for k in keys if not secrets.get(k)]
    if missing:
        sys.exit(
            f"missing secret(s): {', '.join(missing)}\n"
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
        sys.exit(
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


def cdn_control(
    secrets: dict[str, str],
    body: dict,
    timeout: float = 60,
) -> dict:
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
    """List all object keys under prefix via CDN Worker op=LIST (paginated)."""
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
    """Presign DELETE and execute it. Returns status label."""
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


# ---------------------------------------------------------------- subcommands


def cmd_ingest(args: argparse.Namespace, secrets: dict[str, str]) -> None:
    """Delegate to annotate_and_ingest.py (interactive court/player UI)."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "annotate_and_ingest.py")
    if not os.path.isfile(script):
        sys.exit(f"annotate_and_ingest.py not found next to manage.py ({script})")
    cmd = [sys.executable, script]
    if args.url:
        cmd += ["--url", args.url]
    if args.file:
        cmd += ["--file", args.file]
    if args.tournament:
        cmd += ["--tournament", args.tournament]
    if args.queue:
        cmd += ["--queue", args.queue]
    if args.dispatch:
        cmd.append("--dispatch")
    if args.dry_run:
        cmd.append("--dry-run")
    print(f"[info] exec: {' '.join(cmd)}")
    raise SystemExit(subprocess.call(cmd))


MATCH_SELECT = (
    "id,owner_id,source_url,tournament,match_date,status,created_at,"
    "team1_player1,team1_player2,team2_player1,team2_player2,"
    "g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2"
)


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
    """Return match_ids that already have a queued/processing job."""
    if not match_ids:
        return set()
    # PostgREST `in` filter; chunk to stay under URL limits.
    live: set[str] = set()
    chunk = 50
    for i in range(0, len(match_ids), chunk):
        part = match_ids[i : i + chunk]
        # ids are hex/uuid — safe for unquoted in.(…)
        ids = ",".join(part)
        url = (
            f"{supabase_url(secrets)}/rest/v1/jobs"
            f"?select=match_id&status=in.(queued,processing)&match_id=in.({ids})"
        )
        rows = http_json("GET", url, rest_headers(secrets)) or []
        live.update(r["match_id"] for r in rows)
    return live


def cmd_queue(args: argparse.Namespace, secrets: dict[str, str]) -> None:
    require(secrets, "PIPELINE_SERVICE_TOKEN")
    if bool(args.id) == bool(args.all):
        sys.exit("queue: pass exactly one of --id or --all")

    if args.id:
        matches = fetch_matches(secrets, match_id=args.id)
        if not matches:
            sys.exit(f"no match with id={args.id}")
    else:
        matches = fetch_matches(
            secrets,
            bwf_only=True,
            with_source=True,
            status=args.status,
            limit=args.limit,
        )
        if not matches:
            print("no BWF matches with source_url to queue")
            return

    if args.skip_live:
        live = live_job_match_ids(secrets, [m["id"] for m in matches])
        before = len(matches)
        matches = [m for m in matches if m["id"] not in live]
        skipped = before - len(matches)
        if skipped:
            print(f"[info] skipped {skipped} already live (queued/processing)")

    if not matches:
        print("nothing to queue")
        return

    hdr = {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]}
    queued = already = failed = 0
    for m in matches:
        mid = m["id"]
        if args.dry_run:
            print(f"[dry-run] would queue {mid}  source={m.get('source_url')!r}")
            queued += 1
            continue
        body: dict[str, Any] = {
            "id": mid,
            "upsert": True,
            "queue": args.queue,
            "priority": args.priority,
        }
        # Re-supply metadata when present so a missing row can still be created
        # (idempotent upsert coalesce keeps existing columns when null).
        for col in (
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
        ):
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

    print(f"\ndone: queued={queued} already={already} failed={failed}")

    if args.dispatch and not args.dry_run:
        cmd_dispatch(
            argparse.Namespace(max=args.dispatch_max, vt=None, max_running=None),
            secrets,
        )


def cmd_delete(args: argparse.Namespace, secrets: dict[str, str]) -> None:
    if not args.id:
        sys.exit("delete: --id is required")
    if args.db_only and args.storage_only:
        sys.exit("delete: pass at most one of --db-only / --storage-only")

    rows = fetch_matches(secrets, match_id=args.id)
    row = rows[0] if rows else None
    if not row and not args.storage_only:
        sys.exit(f"no match with id={args.id}")

    owner_id = (row or {}).get("owner_id")
    # Allow forcing a prefix when the DB row is already gone.
    if args.prefix:
        prefix = args.prefix if args.prefix.endswith("/") else args.prefix + "/"
    else:
        prefix = match_b2_prefix(owner_id, args.id)

    print(f"match_id : {args.id}")
    if row:
        print(f"owner_id : {owner_id or '(BWF/system)'}")
        print(f"status   : {row.get('status')}")
        print(f"source   : {row.get('source_url')}")
    else:
        print("owner_id : (no DB row)")
    print(f"b2_prefix: {prefix}")

    do_storage = not args.db_only
    do_db = not args.storage_only and bool(row)

    if not args.dry_run and not args.yes:
        bits = []
        if do_storage:
            bits.append(f"B2 under {prefix}")
        if do_db:
            bits.append(f"DB matches.id={args.id} (jobs cascade)")
        if bits:
            confirm = input(f"Delete {' + '.join(bits)}? [y/N] ").strip().lower()
            if confirm not in ("y", "yes"):
                print("aborted")
                return

    if do_storage:
        require(secrets, "PRESIGN_SERVICE_TOKEN")
        try:
            keys = list_prefix_keys(secrets, prefix)
        except Exception as e:
            print(f"[warn] LIST failed ({e}); falling back to known basenames")
            keys = [prefix + name for name in KNOWN_BASENAMES]

        if not keys:
            print("[info] no B2 objects under prefix (or LIST empty)")
        else:
            print(f"[info] {len(keys)} object(s) under prefix")
            for key in keys:
                try:
                    status = delete_b2_key(secrets, key, args.dry_run)
                    print(f"  {status:16} {key}")
                except Exception as e:
                    print(f"  FAILED           {key}  {e}", file=sys.stderr)

    if do_db:
        if args.dry_run:
            print(f"[dry-run] would DELETE matches id={args.id} (jobs cascade)")
        else:
            url = (
                f"{supabase_url(secrets)}/rest/v1/matches"
                f"?id=eq.{urllib.parse.quote(args.id, safe='')}"
            )
            http_json("DELETE", url, rest_headers(secrets))
            print(f"[info] deleted matches row {args.id} (jobs cascaded)")
    elif not args.storage_only and not row:
        print("[info] no DB row to delete")


def cmd_dispatch(args: argparse.Namespace, secrets: dict[str, str]) -> None:
    require(secrets, "PIPELINE_SERVICE_TOKEN")
    body: dict[str, Any] = {}
    if args.max is not None:
        body["max"] = args.max
    if getattr(args, "vt", None) is not None:
        body["vt"] = args.vt
    if getattr(args, "max_running", None) is not None:
        body["max_running"] = args.max_running
    result = post_fn(
        secrets,
        "/jobs/dispatch",
        {"x-pipeline-token": secrets["PIPELINE_SERVICE_TOKEN"]},
        body,
    )
    print(json.dumps(result, indent=2))


def cmd_list(args: argparse.Namespace, secrets: dict[str, str]) -> None:
    matches = fetch_matches(
        secrets,
        bwf_only=args.bwf,
        user_only=args.user,
        with_source=args.with_source,
        status=args.status,
        limit=args.limit,
    )
    if not matches:
        print("(no rows)")
        return
    for m in matches:
        origin = "user" if m.get("owner_id") else "bwf"
        src = m.get("source_url") or ""
        if len(src) > 48:
            src = src[:45] + "…"
        print(
            f"{m['id'][:16]:16}  {origin:4}  {m.get('status') or '?':10}  "
            f"{(m.get('tournament') or '')[:40]:40}  {src}"
        )
    print(f"\n{len(matches)} row(s)")


# ---------------------------------------------------------------- CLI


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # ingest
    pi = sub.add_parser(
        "ingest",
        help="annotate + ingest (wraps annotate_and_ingest.py)",
        description="Interactive annotation UI; creates match + job.",
    )
    pi.add_argument("--url", help="YouTube URL (BWF / system lane)")
    pi.add_argument("--file", help="local video (user-upload lane, or scrub proxy with --url)")
    pi.add_argument("--tournament", help="tournament label (BWF lane)")
    pi.add_argument(
        "--queue",
        default="jobs_bulk",
        choices=["jobs_bulk", "jobs_interactive"],
        help="BWF queue (default jobs_bulk)",
    )
    pi.add_argument("--dispatch", action="store_true", help="POST /jobs/dispatch after ingest")
    pi.add_argument("--dry-run", action="store_true", help="annotate only; write nothing")
    pi.set_defaults(func=cmd_ingest)

    # queue
    pq = sub.add_parser(
        "queue",
        help="enqueue pipeline jobs for scraper catalog matches",
        description=(
            "Call matches-ingest for BWF rows that already exist (from the "
            "scraper). Does not re-scrape; only enqueues normalize when no "
            "live job exists."
        ),
    )
    g = pq.add_mutually_exclusive_group(required=True)
    g.add_argument("--id", help="single match id")
    g.add_argument("--all", action="store_true", help="all BWF matches with source_url")
    pq.add_argument(
        "--skip-live",
        action="store_true",
        default=True,
        help="skip matches that already have queued/processing jobs (default)",
    )
    pq.add_argument(
        "--include-live",
        action="store_true",
        help="do not skip live jobs (ingest still returns already_queued)",
    )
    pq.add_argument("--status", help="only matches with this status (e.g. pending)")
    pq.add_argument("--limit", type=int, help="max matches when using --all")
    pq.add_argument(
        "--queue",
        default="jobs_bulk",
        choices=["jobs_bulk", "jobs_interactive"],
        help="target queue (default jobs_bulk)",
    )
    pq.add_argument("--priority", type=int, default=100, help="job priority (default 100)")
    pq.add_argument("--dispatch", action="store_true", help="dispatch after queueing")
    pq.add_argument("--dispatch-max", type=int, default=1, help="max jobs to dispatch")
    pq.add_argument("--dry-run", action="store_true")
    pq.set_defaults(func=cmd_queue)

    # delete
    pd = sub.add_parser(
        "delete",
        help="delete B2 objects under the match prefix and/or the DB row",
    )
    pd.add_argument("--id", required=True, help="match id")
    pd.add_argument(
        "--prefix",
        help="override B2 prefix (default: construct from owner_id + id)",
    )
    pd.add_argument("--db-only", action="store_true", help="only delete the matches row")
    pd.add_argument(
        "--storage-only",
        action="store_true",
        help="only delete B2 objects (keep DB row)",
    )
    pd.add_argument("--yes", "-y", action="store_true", help="skip DB delete confirmation")
    pd.add_argument("--dry-run", action="store_true")
    pd.set_defaults(func=cmd_delete)

    # dispatch
    pdi = sub.add_parser("dispatch", help="POST /jobs/dispatch")
    pdi.add_argument("--max", type=int, default=1, help="max jobs to claim (default 1)")
    pdi.add_argument("--vt", type=int, help="visibility timeout seconds")
    pdi.add_argument("--max-running", type=int, help="cap concurrent processing jobs")
    pdi.set_defaults(func=cmd_dispatch)

    # list
    pl = sub.add_parser("list", help="list matches")
    pl.add_argument("--bwf", action="store_true", help="system/BWF only")
    pl.add_argument("--user", action="store_true", help="user-owned only")
    pl.add_argument("--with-source", action="store_true", help="require source_url")
    pl.add_argument("--status", help="filter by status")
    pl.add_argument("--limit", type=int, default=50)
    pl.set_defaults(func=cmd_list)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    secrets = load_secrets()

    # --include-live flips the default skip_live for queue
    if args.cmd == "queue" and getattr(args, "include_live", False):
        args.skip_live = False

    args.func(args, secrets)


if __name__ == "__main__":
    main()
