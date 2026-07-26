#!/usr/bin/env python3
"""
BWF World Tour season scraper (current year).

Determines the current year from an internet time server, then fetches that
season's BWF_World_Tour Wikipedia page, enumerates per-tournament wikilinks,
fetches each tournament's wikitext via the MediaWiki Action API, parses bracket
templates (NTeamBracket-Tennis3) into structured Match records, and writes a
per-year JSON file (bwf_<year>_results.json) next to this script.

Usage:
  python3 scraper.py        # scrapes the current year (from a time server)
"""

import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from match_key import match_key_from_scraped, normalize_player_name

USER_AGENT = "MintonixScraper/0.1 (research)"
CACHE_DIR = "/tmp/mintonix_cache"
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

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
    """Fetch wikitext for a Wikipedia page via Action API. Caches locally."""
    safe = page_title.replace("/", "_").replace(" ", "_")
    cache_path = os.path.join(CACHE_DIR, safe + ".json")
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return json.load(f)
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
            for g in range(1, 9):
                s1 = params.get(f"RD{rd}-score{t1}-{g}")
                s2 = params.get(f"RD{rd}-score{t2}-{g}")
                if (s1 is None or not s1.strip()) and (s2 is None or not s2.strip()):
                    break
                games.append({
                    "game": g,
                    "score1": parse_score_field(s1 or ""),
                    "score2": parse_score_field(s2 or ""),
                })
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
                if len(cells) < 5:
                    continue
                # Determine layout: if first cell looks like a date, it's a "first row"
                # with rowspan. Otherwise, it's a continuation row (same date).
                first_cell = cells[0].strip()
                # Check if first cell is a date (e.g. "17 Dec", "rowspan=2 | 17 Dec")
                date_match = re.match(r'(\d{1,2}\s+\w+)', first_cell)
                if date_match:
                    current_date = date_match.group(1)
                    p1_raw, score_raw, p2_raw = cells[1], cells[2], cells[3]
                    set_cells = cells[4:]
                else:
                    # Continuation row — no date cell
                    p1_raw, score_raw, p2_raw = cells[0], cells[1], cells[2]
                    set_cells = cells[3:]
                # Parse the score column (games won: e.g. 2–0)
                games_won = _parse_games_won(score_raw)
                if games_won is None:
                    continue
                # Parse per-game scores from set cells
                games = []
                for gi, sc in enumerate(set_cells, 1):
                    parsed = _parse_set_score(sc)
                    if parsed is None:
                        break
                    games.append({
                        "game": gi,
                        "score1": parsed[0],
                        "score2": parsed[1],
                    })
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
    """Parse '''21'''–10 -> (score1_dict, score2_dict). Returns None if empty/voided."""
    if not raw:
        return None
    if "<s>" in raw or "voided" in raw.lower() or "retired" in raw.lower():
        return None
    # Determine which side is bold (winner)
    s1_bold = bool(re.search(r"'''-?\d", raw))
    # Check if the second number is bold: pattern like 21–'''10'''
    s2_bold = bool(re.search(r"\d\s*[–-]\s*'''-?\d", raw))
    cleaned = re.sub(r"'", "", raw).strip()
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

def scrape_season(season):
    """Scrape a single season year. Returns stats dict."""
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
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {out_path}")
    print(f"Tournaments: {output['stats']['total_tournaments']}, "
          f"Matches: {total_matches}, Skipped: {output['stats']['total_skipped']}")
    return output["stats"]


def main():
    year = get_current_year()
    stats = scrape_season(year)

    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    print(f"  {year}: {stats['total_tournaments']} tournaments, "
          f"{stats['total_matches']} matches, {stats['total_skipped']} skipped")


if __name__ == "__main__":
    main()
