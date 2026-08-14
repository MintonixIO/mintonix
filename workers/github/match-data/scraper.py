#!/usr/bin/env python3
"""
BWF World Tour season scraper (current year).

Determines the current year from an internet time server, then fetches that
season's BWF_World_Tour Wikipedia page, enumerates per-tournament wikilinks,
fetches each tournament's wikitext via the MediaWiki Action API, parses bracket
templates (NTeamBracket-Tennis3) into structured Match records, and writes a
per-year JSON file (bwf_<year>_results.json) next to this script.

Disk cache (MediaWiki JSON under /tmp/mintonix_cache):
  - Default TTL: 24 hours (stale entries are re-fetched).
  - --refresh: ignore existing cache entries (always re-fetch, still write).
  - --no-cache: neither read nor write the disk cache.

Empty / partial seasons:
  - Exit code 1 when a season yields 0 tournaments (unless --allow-empty).
  - Never overwrite an existing bwf_<year>_results.json with empty output when
    failing closed (0 tournaments and not --allow-empty).
  - Partial success (≥1 tournament, some skipped): write results, warn loudly
    with skip counts, exit 0.

Usage:
  python3 scraper.py                          # current year (from a time server)
  python3 scraper.py --year 2024              # one historical season
  python3 scraper.py --from-year 2018 --to-year 2025
  python3 scraper.py --year 2024 --refresh    # force re-fetch (bypass cache)
  python3 scraper.py --year 2024 --no-cache   # no disk cache read/write
  python3 scraper.py --year 2010 --allow-empty  # do not fail on 0 tournaments
  ./load_historical_years.sh                  # scrape + load a year range to Supabase
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from match_key import match_key_from_scraped, normalize_player_name

USER_AGENT = "MintonixScraper/0.1 (research)"
CACHE_DIR = "/tmp/mintonix_cache"
CACHE_TTL_SEC = 24 * 3600  # 24h default; use --refresh / --no-cache to override
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

# Set by main() from CLI flags.
_cache_refresh = False
_cache_disabled = False

# Internet time sources, tried in order. Each returns an ISO-8601 UTC datetime.
TIME_SERVERS = [
    ("https://worldtimeapi.org/api/timezone/Etc/UTC", "utc_datetime"),
    ("https://timeapi.io/api/time/current/zone?timeZone=UTC", "dateTime"),
]


def get_current_year():
    """Return the current year from an internet time server.

    Falls back to the local system clock only if every time server is
    unreachable, so a misconfigured CI runner clock won't silently pick the
    wrong season.
    """
    for url, field in TIME_SERVERS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.load(r)
            year = int(data[field][:4])
            print(f"Current year {year} (from {urllib.parse.urlparse(url).netloc})")
            return year
        except Exception as e:
            print(f"  time server {urllib.parse.urlparse(url).netloc} failed: {e}")
    year = datetime.now(timezone.utc).year
    print(f"All time servers failed; falling back to local clock: {year}")
    return year


# ============================ Fetching ============================

def fetch_wikitext(page_title):
    """Fetch wikitext for a Wikipedia page via Action API.

    Disk cache under CACHE_DIR:
      - Hit when file exists, age < CACHE_TTL_SEC, and not --refresh/--no-cache.
      - Written after a successful fetch unless --no-cache.
    """
    safe = page_title.replace("/", "_").replace(" ", "_")
    cache_path = os.path.join(CACHE_DIR, safe + ".json")
    if not _cache_disabled and not _cache_refresh and os.path.exists(cache_path):
        age = time.time() - os.path.getmtime(cache_path)
        if age < CACHE_TTL_SEC:
            with open(cache_path) as f:
                return json.load(f)
        # Stale entry — fall through to re-fetch.
    if not _cache_disabled:
        os.makedirs(CACHE_DIR, exist_ok=True)
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
    })
    url = "https://en.wikipedia.org/w/api.php?" + params
    # Retry with exponential backoff on 429 / 5xx
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if not _cache_disabled:
                with open(cache_path, "w") as f:
                    json.dump(data, f)
            time.sleep(3)  # politeness
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429 or 500 <= e.code < 600:
                wait = 10 * (2 ** attempt)  # 10, 20, 40, 80, 160, 320
                print(f"    HTTP {e.code}, retry in {wait}s (attempt {attempt+1}/6)")
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError as e:
            wait = 10 * (2 ** attempt)
            print(f"    URL error {e}, retry in {wait}s (attempt {attempt+1}/6)")
            time.sleep(wait)
            continue
    raise RuntimeError(f"Failed after 6 retries: {page_title}")


# ============================ Template parsing ============================

def find_template_bounds(text, start):
    """Given position of '{{', return position just after matching '}}'."""
    assert text[start : start + 2] == "{{"
    depth = 1
    pos = start + 2
    while pos < len(text) and depth > 0:
        if text[pos : pos + 2] == "{{":
            depth += 1
            pos += 2
        elif text[pos : pos + 2] == "}}":
            depth -= 1
            pos += 2
        else:
            pos += 1
    return pos if depth == 0 else -1


def split_template_params(content):
    """Split template interior by top-level '|' (respecting {} and [])."""
    params = []
    current = []
    brace_depth = 0
    bracket_depth = 0
    for c in content:
        if c == "{":
            brace_depth += 1
            current.append(c)
        elif c == "}":
            brace_depth -= 1
            current.append(c)
        elif c == "[":
            bracket_depth += 1
            current.append(c)
        elif c == "]":
            bracket_depth -= 1
            current.append(c)
        elif c == "|" and brace_depth == 0 and bracket_depth == 0:
            params.append("".join(current))
            current = []
        else:
            current.append(c)
    params.append("".join(current))
    return params


def parse_template(content):
    """Return (name, params_dict) from template interior content.
    Normalizes compact-bracket zero-padded keys: 'RD1-team03' -> 'RD1-team3'."""
    parts = split_template_params(content)
    name = parts[0].strip()
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            k = k.strip()
            m = re.match(r"(RD\d+-(?:team|seed|score))0*(\d+)(-\d+)?$", k)
            if m:
                k = m.group(1) + m.group(2) + (m.group(3) or "")
            params[k] = v
    return name, params


# ============================ Field parsing ============================

def strip_bold(s):
    s = s.strip()
    if s.startswith("'''") and s.endswith("'''") and len(s) >= 6:
        return s[3:-3].strip(), True
    return s, False


FLAGICON_RE = re.compile(r"\{\{flagicon\|([^}|]+)(?:\|[^}]*)?\}\}")
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]")
_WO_RE = re.compile(r"\b(?:w\s*/\s*o|w/?o|walk[- ]?over)\b", re.I)
_RET_RE = re.compile(r"\b(?:retired?|rtd|ret\.?)\b", re.I)


def classify_result_text(*texts: str) -> str | None:
    """walkover / retired from wiki score cells. None if the cell is a normal score."""
    blob = " ".join(t or "" for t in texts)
    if _WO_RE.search(blob):
        return "walkover"
    if _RET_RE.search(blob):
        return "retired"
    return None


def parse_team_field(value):
    """Parse a team field. Returns dict with players list, is_winner, raw."""
    if value is None:
        value = ""
    value, is_winner = strip_bold(value)
    countries = [m.group(1).strip() for m in FLAGICON_RE.finditer(value)]
    wiki_links = WIKILINK_RE.findall(value)
    players = []
    for i, (wiki, disp) in enumerate(wiki_links):
        players.append({
            "country": countries[i] if i < len(countries) else None,
            "wiki_name": wiki.strip(),
            "display_name": (disp or wiki).strip(),
        })
    if not players:
        plain = FLAGICON_RE.sub("", value).strip()
        plain = re.sub(r"<br\s*/?>", " / ", plain).strip()
        if plain and plain != "&nbsp;":
            players.append({
                "country": None,
                "wiki_name": None,
                "display_name": plain,
            })
    return {
        "players": players,
        "is_winner": is_winner,
        "raw": value,
    }


def parse_score_field(value):
    if value is None:
        return None
    value, is_winner = strip_bold(value)
    if not value or value == "&nbsp;":
        return None
    m = re.match(r"(\d+)", value)
    if not m:
        return None
    return {
        "score": int(m.group(1)),
        "raw": value,
        "is_winner": is_winner,
    }


def parse_seed_field(value):
    if value is None:
        return None
    value = value.strip()
    if not value or value == "&nbsp;":
        return None
    m = re.match(r"(\d+)", value)
    return int(m.group(1)) if m else None


# ============================ Bracket extraction ============================

BRACKET_NAME_RE = re.compile(r"\{\{(\d+TeamBracket(?:-[A-Za-z0-9-]+)?)\b")


def extract_bracket_matches(template_content, section_path, page_title, discipline):
    """Extract matches from a parsed bracket template."""
    name, params = parse_template(template_content)
    if not re.match(r"\d+TeamBracket", name):
        return []
    # Derive rounds and team slots from the params that are actually present, so
    # non-power-of-two draws (a partial first round) enumerate correctly instead
    # of assuming n_teams is a power of two. Slots in a round are paired in order.
    round_teams = {}  # rd -> set of team-slot indices present
    for key in params:
        km = re.match(r"RD(\d+)-team(\d+)$", key)
        if km:
            round_teams.setdefault(int(km.group(1)), set()).add(int(km.group(2)))
    matches = []
    for rd in sorted(round_teams):
        slots = sorted(round_teams[rd])
        for mi, base in enumerate(range(0, len(slots) - 1, 2), start=1):
            t1 = slots[base]
            t2 = slots[base + 1]
            team1 = params.get(f"RD{rd}-team{t1}", "")
            team2 = params.get(f"RD{rd}-team{t2}", "")
            # Skip empty (unplayed) matches
            if not team1.strip() and not team2.strip():
                continue
            games = []
            score_blobs: list[str] = []
            for g in range(1, 9):
                s1 = params.get(f"RD{rd}-score{t1}-{g}")
                s2 = params.get(f"RD{rd}-score{t2}-{g}")
                # Compact brackets also use RD1-score1 (no game suffix).
                if g == 1:
                    if s1 is None:
                        s1 = params.get(f"RD{rd}-score{t1}")
                    if s2 is None:
                        s2 = params.get(f"RD{rd}-score{t2}")
                if (s1 is None or not str(s1).strip()) and (
                    s2 is None or not str(s2).strip()
                ):
                    break
                score_blobs.append(s1 or "")
                score_blobs.append(s2 or "")
                games.append({
                    "game": g,
                    "score1": parse_score_field(s1 or ""),
                    "score2": parse_score_field(s2 or ""),
                })
            result = classify_result_text(*score_blobs)
            round_label = (params.get(f"RD{rd}") or f"Round {rd}").strip()
            matches.append({
                "tournament_page": page_title,
                "discipline": discipline,
                "section_path": list(section_path),
                "round": round_label,
                "round_num": rd,
                "match_idx": mi,
                "seed1": parse_seed_field(params.get(f"RD{rd}-seed{t1}", "")),
                "team1": parse_team_field(team1),
                "seed2": parse_seed_field(params.get(f"RD{rd}-seed{t2}", "")),
                "team2": parse_team_field(team2),
                "games": games,
                "result": result,
            })
    return matches


# ============================ Group stage (World Tour Finals) ============================

DISCIPLINE_HEADERS = {
    "Men's singles": "MS",
    "Women's singles": "WS",
    "Men's doubles": "MD",
    "Women's doubles": "WD",
    "Mixed doubles": "XD",
}

_MONTHS = {m.lower(): i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


def _iso_date(day_month, year):
    """Convert a yearless wikitable date ('17 Dec') + season year to ISO
    'YYYY-MM-DD'. Returns None if absent or unparseable. The year comes from the
    season so the stored date isn't silently bound to whenever the loader runs."""
    if not day_month:
        return None
    m = re.match(r"(\d{1,2})\s+([A-Za-z]+)", day_month.strip())
    if not m:
        return None
    mon = _MONTHS.get(m.group(2)[:3].lower())
    if not mon:
        return None
    try:
        return datetime(year, mon, int(m.group(1))).date().isoformat()
    except ValueError:
        return None


_DATE_TOKEN = re.compile(
    r"(?P<d>\d{1,2})\s+(?P<m>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|"
    r"May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)(?:\s+(?P<y>19\d{2}|20\d{2}))?",
    re.I,
)
# Compact same-month range: "7–12 January" / "7-12 January 2025"
# First day must not be the tail of a year ("2024 – 3 January").
_COMPACT_RANGE = re.compile(
    r"(?<!\d)(?P<d0>\d{1,2})\s*[–\-]\s*(?P<d1>\d{1,2})\s+"
    r"(?P<m>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|"
    r"May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)(?:\s+(?P<y>19\d{2}|20\d{2}))?",
    re.I,
)
_START_DATE_TMPL = re.compile(
    r"\{\{\s*(?:Start\s+date|End\s+date)\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})",
    re.I,
)

# Typical BWF week: Qual/R64 early, Final on the last day.
_ROUND_DATE_FRAC = (
    (re.compile(r"qual", re.I), 0.00),
    (re.compile(r"\bgroup\b", re.I), 0.10),
    (re.compile(r"round of 64|\br64\b", re.I), 0.15),
    (re.compile(r"round of 32|\br32\b|first round", re.I), 0.30),
    (re.compile(r"round of 16|\br16\b|second round", re.I), 0.50),
    (re.compile(r"quarter|\bqf\b|third round", re.I), 0.70),
    (re.compile(r"semi|\bsf\b", re.I), 0.85),
    (re.compile(r"bronze|3rd|third place", re.I), 0.95),
    (re.compile(r"\bfinal\b", re.I), 1.00),
)


def _ymd(year, month, day):
    try:
        return datetime(year, month, day).date()
    except ValueError:
        return None


def parse_infobox_date_range(dates_raw, season):
    """Parse Infobox ``dates`` into (start_iso, end_iso).

    Handles ``7–12 January``, ``28 January – 2 February``, year-crossing
    ``29 December – 3 January``, optional years, and {{Start date|Y|M|D}}.
    """
    if not dates_raw:
        return None, None
    text = str(dates_raw)
    tmpls = _START_DATE_TMPL.findall(text)
    if len(tmpls) >= 2:
        a = _ymd(int(tmpls[0][0]), int(tmpls[0][1]), int(tmpls[0][2]))
        b = _ymd(int(tmpls[1][0]), int(tmpls[1][1]), int(tmpls[1][2]))
        if a and b:
            if b < a:
                a, b = b, a
            return a.isoformat(), b.isoformat()

    compact = _COMPACT_RANGE.search(text)
    if compact:
        mon = _MONTHS.get(compact.group("m")[:3].lower())
        year = int(compact.group("y")) if compact.group("y") else season
        if mon:
            a = _ymd(year, mon, int(compact.group("d0")))
            b = _ymd(year, mon, int(compact.group("d1")))
            if a and b:
                if b < a:
                    a, b = b, a
                return a.isoformat(), b.isoformat()
    tokens = list(_DATE_TOKEN.finditer(text))
    if not tokens:
        return None, None

    def tok_date(m, default_year, prev_month=None):
        mon = _MONTHS.get(m.group("m")[:3].lower())
        if not mon:
            return None
        year = int(m.group("y")) if m.group("y") else default_year
        # Year-crossing: "29 December – 3 January" with season 2025 → Dec 2024.
        if m.group("y") is None and prev_month is None and mon >= 11:
            # First token in Nov/Dec with no year: keep season unless end is Jan.
            pass
        return _ymd(year, mon, int(m.group("d"))), mon, year

    if len(tokens) == 1:
        d, _, _ = tok_date(tokens[0], season)
        if not d:
            return None, None
        iso = d.isoformat()
        return iso, iso

    # Two (or more) tokens: start then end.
    t0, t1 = tokens[0], tokens[1]
    mon0 = _MONTHS.get(t0.group("m")[:3].lower())
    mon1 = _MONTHS.get(t1.group("m")[:3].lower())
    y0 = int(t0.group("y")) if t0.group("y") else season
    y1 = int(t1.group("y")) if t1.group("y") else season
    if t0.group("y") is None and t1.group("y") is None and mon0 and mon1 and mon0 > mon1:
        # Dec → Jan wrap: start belongs to the previous calendar year.
        y0 = season - 1
    start = _ymd(y0, mon0, int(t0.group("d"))) if mon0 else None
    end = _ymd(y1, mon1, int(t1.group("d"))) if mon1 else None
    if start and end and end < start:
        # Same-year wrap missed (e.g. season already is the end year).
        start = _ymd(y0 - 1, mon0, int(t0.group("d")))
    if not start and not end:
        return None, None
    if start and not end:
        return start.isoformat(), start.isoformat()
    if end and not start:
        return end.isoformat(), end.isoformat()
    return start.isoformat(), end.isoformat()


def date_for_round(round_label, start_iso, end_iso):
    """Place a bracket match on a day inside the tournament window.

    Wikipedia brackets have no per-match dates. Group-stage rows already carry
    an exact ``date`` and must not go through this helper. Finals land on the
    last day; qualifying on the first; other rounds interpolate.
    """
    if not start_iso:
        return None
    if not end_iso:
        return start_iso
    try:
        start = datetime.fromisoformat(start_iso).date()
        end = datetime.fromisoformat(end_iso).date()
    except ValueError:
        return start_iso
    span = (end - start).days
    if span <= 0:
        return start_iso
    frac = 0.5
    label = round_label or ""
    for pat, f in _ROUND_DATE_FRAC:
        if pat.search(label):
            frac = f
            break
    day = start.toordinal() + int(round(span * frac))
    day = min(max(day, start.toordinal()), end.toordinal())
    return datetime.fromordinal(day).date().isoformat()


def assign_bracket_dates(matches, info, season):
    """Fill missing match dates from the infobox range + round."""
    start, end = parse_infobox_date_range(
        (info or {}).get("dates") or (info or {}).get("date") or "",
        season,
    )
    if info is not None:
        info["_date_start"] = start
        info["_date_end"] = end
    if not start:
        return matches
    for m in matches:
        if m.get("date"):
            continue
        m["date"] = date_for_round(m.get("round") or "", start, end)
    return matches


def extract_group_stage_matches(wikitext, discipline_start, discipline_end, page_title, discipline, season):
    """Parse World Tour Finals round-robin group-stage wikitables.

    Format:
      {| class="wikitable"
      ! Date | Player 1 | Score | Player 2 | Set 1 | Set 2 | Set 3
      |-
      | rowspan="2" | 17 Dec
      | '''[[Player1]] {{flagicon|XXX}}''' | '''2'''–0 | {{flagicon|YYY}} [[Player2]] | '''21'''–10 | '''21'''–14 |
      |-
      | [[Player3]] {{flagicon|ZZZ}} | 1–'''2''' | '''{{flagicon|WWW}} [[Player4]]''' | 13–'''21''' | '''21'''–12 | 19–'''21'''

    The "Score" column gives games won (e.g. 2–0, 2–1).
    Set columns give per-game points (e.g. '''21'''–10; bold = winner).
    """
    section = wikitext[discipline_start:discipline_end]
    matches = []
    # Find Group subsections
    group_re = re.compile(r'^(===+)\s*(Group\s+[A-Z])\s*(===+)\s*$', re.MULTILINE)
    group_starts = [(m.start(), m.group(2).strip()) for m in group_re.finditer(section)]
    if not group_starts:
        return matches
    # Add end boundary for the last group
    for i, (gpos, gname) in enumerate(group_starts):
        if i + 1 < len(group_starts):
            gend = group_starts[i + 1][0]
        else:
            gend = len(section)
        group_wt = section[gpos:gend]
        # match_idx is per group, not per table: a group's match_key includes the
        # group name but not the table, so resetting per table would collide and
        # the loader would drop matches as duplicate keys.
        match_idx = 0
        # Find match wikitables (those with "Player 1" / "Player 2" headers)
        table_re = re.compile(r'\{\|([^\n]*\n(?:.*\n)*?)\|\}', re.MULTILINE)
        for tm in table_re.finditer(group_wt):
            tbl = tm.group(1)
            if "Player 1" not in tbl or "Player 2" not in tbl:
                continue
            # Split into rows by |-
            rows = re.split(r'\n\|-', tbl)
            current_date = None
            for row in rows:
                # Skip header row (contains ! )
                if row.strip().startswith("!"):
                    continue
                if not row.strip():
                    continue
                # Extract cells using the updated cell splitter
                cells = _split_wikitable_cells(row)
                if len(cells) < 3:
                    continue
                # Determine layout: if first cell looks like a date, it's a "first row"
                # with rowspan. Otherwise, it's a continuation row (same date).
                first_cell = cells[0].strip()
                # Check if first cell is a date (e.g. "17 Dec", "rowspan=2 | 17 Dec")
                date_match = re.match(r'(\d{1,2}\s+\w+)', first_cell)
                if date_match:
                    if len(cells) < 4:
                        continue
                    current_date = date_match.group(1)
                    p1_raw, score_raw, p2_raw = cells[1], cells[2], cells[3]
                    set_cells = cells[4:]
                else:
                    # Continuation row — no date cell
                    p1_raw, score_raw, p2_raw = cells[0], cells[1], cells[2]
                    set_cells = cells[3:]
                # Parse the score column (games won: e.g. 2–0) — w/o / retired
                # have no numeric games-won but the match still happened.
                games_won = _parse_games_won(score_raw)
                result = classify_result_text(score_raw, *set_cells)
                # Parse per-game scores from set cells
                games = []
                for gi, sc in enumerate(set_cells, 1):
                    parsed = _parse_set_score(sc)
                    if parsed is None:
                        continue
                    games.append({
                        "game": gi,
                        "score1": parsed[0],
                        "score2": parsed[1],
                    })
                if games_won is None and result is None and not games:
                    continue
                match_idx += 1
                matches.append({
                    "tournament_page": page_title,
                    "discipline": discipline,
                    "section_path": [discipline_full_name(discipline), gname],
                    "round": gname,
                    "round_num": 0,
                    "match_idx": match_idx,
                    "date": _iso_date(current_date, season),
                    "seed1": None,
                    "team1": _parse_group_player(p1_raw),
                    "seed2": None,
                    "team2": _parse_group_player(p2_raw),
                    "games_won": games_won,
                    "games": games,
                    "result": result,
                })
    return matches


def _split_wikitable_cells(row):
    """Split a wikitable row into cell content strings.
    Handles styled cells: | style="..." | content -> content
    Also handles rowspan attributes: | rowspan="2" | content -> (content, rowspan=2)
    """
    row = row.strip()
    # Remove leading '|' on the row
    if row.startswith("|"):
        row = row[1:]
    # Split on '\n|' or '||' at top level (outside [[]] and {{}})
    raw_cells = []
    current = []
    depth_b = 0
    depth_c = 0
    i = 0
    while i < len(row):
        c = row[i]
        if c == "[":
            depth_b += 1
        elif c == "]":
            depth_b -= 1
        elif c == "{":
            depth_c += 1
        elif c == "}":
            depth_c -= 1
        # Check for cell separator: newline-pipe or double-pipe at depth 0
        if depth_b == 0 and depth_c == 0:
            if c == "\n" and i + 1 < len(row) and row[i + 1] == "|":
                raw_cells.append("".join(current))
                current = []
                i += 2  # skip \n|
                continue
            elif c == "|" and i + 1 < len(row) and row[i + 1] == "|" and depth_b == 0 and depth_c == 0:
                raw_cells.append("".join(current))
                current = []
                i += 2  # skip ||
                continue
        current.append(c)
        i += 1
    raw_cells.append("".join(current))

    # For each raw cell, extract content from styled format: "style=\"...\" | content"
    cells = []
    for raw in raw_cells:
        raw = raw.strip()
        if not raw:
            cells.append("")
            continue
        # Find the last '|' at depth 0 that separates attributes from content
        depth_b = 0
        depth_c = 0
        split_pos = -1
        for j, c in enumerate(raw):
            if c == "[":
                depth_b += 1
            elif c == "]":
                depth_b -= 1
            elif c == "{":
                depth_c += 1
            elif c == "}":
                depth_c -= 1
            elif c == "|" and depth_b == 0 and depth_c == 0:
                split_pos = j
        if split_pos >= 0:
            content = raw[split_pos + 1:].strip()
        else:
            content = raw
        cells.append(content)
    return [c for c in cells if c]


def _parse_games_won(raw):
    """Parse '2–0' or \"'''2'''–0\" -> (2, 0). Returns None if not a score."""
    if not raw:
        return None
    cleaned = re.sub(r"'''", "", raw).strip()
    m = re.match(r"(\d+)\s*[–-]\s*(\d+)", cleaned)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))


def _parse_set_score(raw):
    """Parse '''21'''–10 -> (score1_dict, score2_dict).

    Voided/strikethrough cells are dropped. A retirement that still has
    points (``21–8 retired``) keeps the numbers; the match is tagged
    ``result=retired`` by the caller.
    """
    if not raw:
        return None
    if "<s>" in raw or "voided" in raw.lower():
        return None
    s1_bold = bool(re.search(r"'''-?\d", raw))
    s2_bold = bool(re.search(r"\d\s*[–-]\s*'''-?\d", raw))
    cleaned = re.sub(r"'", "", raw).strip()
    cleaned = _RET_RE.sub("", cleaned).strip()
    m = re.match(r"(\d+)\s*[–-]\s*(\d+)", cleaned)
    if not m:
        return None
    s1 = int(m.group(1))
    s2 = int(m.group(2))
    return (
        {"score": s1, "raw": raw.strip(), "is_winner": s1_bold and not s2_bold},
        {"score": s2, "raw": raw.strip(), "is_winner": s2_bold and not s1_bold},
    )


def _parse_group_player(raw):
    """Parse a player cell from a group-stage wikitable."""
    if not raw:
        return {"players": [], "is_winner": False, "raw": ""}
    # Remove <s> strikethrough (voided players)
    cleaned = re.sub(r"</?s>", "", raw)
    is_winner = "'''" in cleaned
    cleaned = re.sub(r"'''", "", cleaned).strip()
    countries = [m.group(1).strip() for m in FLAGICON_RE.finditer(cleaned)]
    wiki_links = WIKILINK_RE.findall(cleaned)
    players = []
    for i, (wiki, disp) in enumerate(wiki_links):
        players.append({
            "country": countries[i] if i < len(countries) else None,
            "wiki_name": wiki.strip(),
            "display_name": (disp or wiki).strip(),
        })
    if not players:
        plain = FLAGICON_RE.sub("", cleaned).strip()
        if plain:
            players.append({
                "country": None,
                "wiki_name": None,
                "display_name": plain,
            })
    return {"players": players, "is_winner": is_winner, "raw": raw.strip()}


def discipline_full_name(code):
    return {v: k for k, v in DISCIPLINE_HEADERS.items()}.get(code, code)


SECTION_HEADER_RE = re.compile(r"^(=+)([^=\n]+)=+\s*$", re.MULTILINE)


def parse_infobox(wikitext):
    """Find and parse the Infobox tournament template at the top."""
    m = re.search(r"\{\{Infobox\s+tournament\b", wikitext)
    if not m:
        return {}
    start = m.start()
    end = find_template_bounds(wikitext, start)
    if end < 0:
        return {}
    content = wikitext[start + 2 : end - 2]
    _, params = parse_template(content)
    return {k: v.strip() for k, v in params.items()}


def parse_tournament_page(page_title, wikitext, season):
    """Parse a tournament page into metadata + matches."""
    # Tokenize section headers and bracket templates in document order.
    tokens = []
    for m in SECTION_HEADER_RE.finditer(wikitext):
        depth = len(m.group(1))
        name = m.group(2).strip()
        tokens.append(("header", m.start(), m.end(), depth, name))
    for m in BRACKET_NAME_RE.finditer(wikitext):
        start = m.start()
        end = find_template_bounds(wikitext, start)
        if end < 0:
            continue
        content = wikitext[start + 2 : end - 2]
        tokens.append(("bracket", start, end, content))
    tokens.sort(key=lambda t: t[1])

    section_stack = []
    current_discipline = None
    matches = []
    for tok in tokens:
        if tok[0] == "header":
            _, _, _, depth, name = tok
            section_stack = [(d, n) for (d, n) in section_stack if d < depth]
            section_stack.append((depth, name))
            if name in DISCIPLINE_HEADERS:
                current_discipline = DISCIPLINE_HEADERS[name]
        elif tok[0] == "bracket":
            _, _, _, content = tok
            section_path = [n for (_, n) in section_stack]
            if current_discipline is None:
                continue
            matches.extend(extract_bracket_matches(
                content, section_path, page_title, current_discipline
            ))

    info = parse_infobox(wikitext)

    # Detect World Tour Finals: parse group-stage round-robin wikitables
    is_world_tour_finals = "World Tour Finals" in page_title
    if is_world_tour_finals:
        # Use only L2 discipline headers (the results section, not the L3 qualifier lists)
        disc_positions = []
        for m in SECTION_HEADER_RE.finditer(wikitext):
            depth = len(m.group(1))
            name = m.group(2).strip()
            if depth == 2 and name in DISCIPLINE_HEADERS:
                disc_positions.append((m.start(), DISCIPLINE_HEADERS[name]))
        disc_positions.append((len(wikitext), None))
        for i in range(len(disc_positions) - 1):
            start, code = disc_positions[i]
            end = disc_positions[i + 1][0]
            matches.extend(extract_group_stage_matches(
                wikitext, start, end, page_title, code, season
            ))

    assign_bracket_dates(matches, info, season)
    assign_unique_match_idx(matches)
    # Emit stable match_key once so finder/loader cannot diverge.
    tournament_title = page_title
    for m in matches:
        m["match_key"] = match_key_from_scraped(season, tournament_title, m)

    return {
        "page": page_title,
        "metadata": info,
        "matches": matches,
    }


def _roster_anchor(m):
    """Sorted canonical player names of both teams — a match's stable identity.

    A player belongs to at most one match per (discipline, section, round), so
    the combined roster uniquely identifies a match within that group regardless
    of where it sits in the wikitable. Names are NFKC-normalized and
    parentheticals stripped so minor wiki display churn does not re-key.
    """
    names = []
    for tk in ("team1", "team2"):
        for p in (m.get(tk) or {}).get("players", []) or []:
            raw = p.get("wiki_name") or p.get("display_name") or ""
            n = normalize_player_name(raw)
            # Skip empties, unrendered template residue ("{{flagicon|}}"), and
            # bare punctuation ("/") from TBD/placeholder cells in unplayed
            # draws — those aren't real players, so a match made only of them has
            # no stable anchor and falls back to a positional idx.
            if n and "{" not in n and "}" not in n and any(c.isalpha() for c in n):
                names.append(n)
    return sorted(names)


def assign_unique_match_idx(matches):
    """Assign a match_idx that is unique per (discipline, section, round) AND
    stable across re-scrapes.

    The match_key embeds match_idx, so a positional ordinal (the old scheme)
    shifted every later match's key whenever Wikipedia inserted, removed, or
    reordered a match — which re-keyed the rows on the next load, orphaning the
    old ones and breaking their video links. Deriving the idx from the match's
    roster instead keeps the key pinned to the match no matter where it sits in
    the table. A player appears in at most one match per group, so the roster is
    unique within the group; the short hash keeps the key compact.

    Bye / unparseable rosters have no stable anchor, so they fall back to a
    positional ordinal that is still unique within the group.
    """
    pos = {}
    for m in matches:
        group = (m["discipline"], tuple(m.get("section_path") or []), m["round"])
        anchor = _roster_anchor(m)
        if anchor:
            digest = hashlib.sha1("\x1f".join(anchor).encode("utf-8")).hexdigest()[:10]
            m["match_idx"] = f"r{digest}"
        else:
            pos[group] = pos.get(group, 0) + 1
            m["match_idx"] = f"p{pos[group]}"
    return matches


# ============================ Season enumeration ============================

def enumerate_tournaments(season_year):
    """Fetch season page, return list of per-tournament page titles."""
    page = f"{season_year}_BWF_World_Tour"
    data = fetch_wikitext(page)
    if "parse" not in data:
        return [], page
    wt = data["parse"]["wikitext"]
    # Find the Finals section header (handles both ==Finals== and == Finals ==)
    finals_m = re.search(r"^==\s*Finals\s*==\s*$", wt, re.MULTILINE)
    if not finals_m:
        return [], page
    finals_idx = finals_m.end()
    # Find the next L2 header after Finals (e.g., == Statistics ==)
    stats_m = re.search(r"^==\s*[^=\n]+\s*==\s*$", wt[finals_idx:], re.MULTILINE)
    if stats_m:
        section = wt[finals_idx : finals_idx + stats_m.start()]
    else:
        section = wt[finals_idx:]
    # Find all [[<target>|Draw]] and [[<target>|Report]] links
    targets = set()
    for m in re.finditer(r"\[\[([^\]|]+)\|(?:Draw|Report)\]\]", section):
        target = m.group(1).strip()
        targets.add(target)
    return sorted(targets), page


# ============================ Main ============================

def _write_season_json(out_path: str, output: dict) -> None:
    """Atomic write: temp file then os.replace so a crash cannot leave a half file."""
    tmp_path = f"{out_path}.tmp"
    with open(tmp_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, out_path)


def scrape_season(season, allow_empty=False):
    """Scrape a single season year. Returns stats dict.

    When total_tournaments == 0 and allow_empty is False, does **not** write
    bwf_<year>_results.json (avoids clobbering a good prior scrape).
    """
    print(f"\n{'=' * 60}")
    print(f"Scraping {season}")
    print(f"{'=' * 60}")
    print(f"Enumerating tournaments from {season}_BWF_World_Tour...")
    tournaments_list, season_page = enumerate_tournaments(season)
    print(f"Found {len(tournaments_list)} tournament pages:")
    for t in tournaments_list:
        print(f"  - {t}")

    output = {
        "season": season,
        "season_page": season_page,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "stats": {},
        "tournaments": [],
        "skipped": [],
    }
    total_matches = 0
    for title in tournaments_list:
        print(f"  Fetching {title}...")
        try:
            data = fetch_wikitext(title)
        except Exception as e:
            print(f"    ERROR fetching: {e}")
            output["skipped"].append({"page": title, "reason": str(e)})
            continue
        if "parse" not in data:
            code = data.get("error", {}).get("code", "unknown")
            print(f"    SKIP (no parse: {code})")
            output["skipped"].append({"page": title, "reason": code})
            continue
        wt = data["parse"]["wikitext"]
        parsed = parse_tournament_page(title, wt, season)
        parsed["title"] = data["parse"].get("title", title)
        parsed["pageid"] = data["parse"].get("pageid")
        parsed["wikitext_length"] = len(wt)
        total_matches += len(parsed["matches"])
        output["tournaments"].append(parsed)
        print(f"    {len(parsed['matches'])} matches, {len(wt)} bytes wikitext")

    output["stats"] = {
        "total_tournaments": len(output["tournaments"]),
        "total_matches": total_matches,
        "total_skipped": len(output["skipped"]),
    }

    out_path = os.path.join(PROJECT_DIR, f"bwf_{season}_results.json")
    n_tournaments = output["stats"]["total_tournaments"]
    n_skipped = output["stats"]["total_skipped"]

    if n_tournaments == 0 and not allow_empty:
        print(
            f"\nWARNING: not writing {out_path} — 0 tournaments scraped "
            f"(existing file left untouched; pass --allow-empty to write empty)",
            file=sys.stderr,
        )
        print(
            f"Tournaments: 0, Matches: 0, Skipped: {n_skipped}"
        )
        return output["stats"]

    _write_season_json(out_path, output)
    print(f"\nSaved to {out_path}")
    print(
        f"Tournaments: {n_tournaments}, "
        f"Matches: {total_matches}, Skipped: {n_skipped}"
    )
    if n_tournaments > 0 and n_skipped > 0:
        print(
            f"\nWARNING: partial season {season}: "
            f"{n_tournaments} tournament(s) ok, {n_skipped} skipped "
            f"({', '.join(s.get('page', '?') for s in output['skipped'][:8])}"
            f"{'…' if n_skipped > 8 else ''})",
            file=sys.stderr,
        )
    return output["stats"]


def main(argv=None):
    import argparse

    global _cache_refresh, _cache_disabled

    parser = argparse.ArgumentParser(
        description="Scrape BWF World Tour seasons from Wikipedia into bwf_<year>_results.json"
    )
    parser.add_argument(
        "--year",
        type=int,
        action="append",
        dest="years",
        metavar="YYYY",
        help="Season year to scrape (repeatable). Default: current year only.",
    )
    parser.add_argument(
        "--from-year",
        type=int,
        metavar="YYYY",
        help="Inclusive start of a year range (use with --to-year).",
    )
    parser.add_argument(
        "--to-year",
        type=int,
        metavar="YYYY",
        help="Inclusive end of a year range (use with --from-year).",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Ignore existing disk cache entries (re-fetch; still write cache).",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Do not read or write the disk cache under /tmp/mintonix_cache.",
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Do not exit with error when a season yields 0 tournaments; "
        "also allow writing empty bwf_<year>_results.json.",
    )
    args = parser.parse_args(argv)

    if args.refresh and args.no_cache:
        parser.error("--refresh and --no-cache are mutually exclusive")

    _cache_refresh = bool(args.refresh)
    _cache_disabled = bool(args.no_cache)

    years: list[int] = []
    if args.years:
        years.extend(args.years)
    if args.from_year is not None or args.to_year is not None:
        if args.from_year is None or args.to_year is None:
            parser.error("--from-year and --to-year must be used together")
        if args.from_year > args.to_year:
            parser.error("--from-year must be <= --to-year")
        years.extend(range(args.from_year, args.to_year + 1))
    if not years:
        years = [get_current_year()]

    # De-dupe while preserving order
    seen = set()
    ordered: list[int] = []
    for y in years:
        if y not in seen:
            seen.add(y)
            ordered.append(y)

    summary = []
    empty_years = []
    partial_years = []
    for year in ordered:
        stats = scrape_season(year, allow_empty=args.allow_empty)
        summary.append((year, stats))
        n_t = stats.get("total_tournaments", 0)
        n_s = stats.get("total_skipped", 0)
        if n_t == 0:
            empty_years.append(year)
        elif n_s > 0:
            partial_years.append((year, n_t, n_s))

    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    for year, stats in summary:
        print(
            f"  {year}: {stats['total_tournaments']} tournaments, "
            f"{stats['total_matches']} matches, {stats['total_skipped']} skipped"
        )

    if partial_years:
        print(
            "\nWARNING: partial season(s) (exit 0 — at least one tournament ok):",
            file=sys.stderr,
        )
        for year, n_t, n_s in partial_years:
            print(
                f"  {year}: {n_t} tournament(s) succeeded, {n_s} skipped",
                file=sys.stderr,
            )

    if empty_years and not args.allow_empty:
        print(
            f"\nERROR: season(s) yielded 0 tournaments: "
            f"{', '.join(str(y) for y in empty_years)} "
            f"(pass --allow-empty to override; existing JSON not overwritten)",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
