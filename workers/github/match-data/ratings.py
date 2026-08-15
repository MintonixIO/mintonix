"""BWF form ratings — Glicko-2 (singles/pairs) + TrueSkill (doubles individuals).

Exact Stage 1 spec (plan tab 1 · Ratings):

1.1 Cleaning — keep a row only if a winner can be determined (one side won
    ≥ 2 games with real scores), discipline is MS/WS/MD/WD/XD, and it is not
    a duplicate of another row (same tournament, same four names, same six
    game scores). Incomplete matches and walkovers are dropped.

1.2 Name normalization — ``_`` → space; NFKD + strip combining marks;
    drop generic suffixes like (badminton)/(player); collapse whitespace;
    lowercase; apply alias map. Non-generic parentheticals (born 1980) are
    kept so Wikipedia disambiguators survive. Ratings are keyed on the
    normalized form; display names are title-cased.

1.3 Chronological order — because match_date is often null:
        day = year × 400 + round_order × 30 + (seq mod 30)
    Year is parsed from the tournament title. Round order:
        Qual 0 → Group 1 → R64 2 → R32 3 → R16 4 → QF 5 → SF 6 → Bronze 7 → Final 8
    Matches are sorted by (year, round_order, tournament name), then assigned
    a day index. Real ``match_date`` is *not* mixed into this day scale
    (different epoch); it is used only by the catalog UI.

Homonyms — two people with the same display name are different entities when:
    * they have different countries (CHN vs TPE), or
    * the wiki title keeps a non-generic parenthetical (born 1980).
    Same-person spelling variants go through the alias map (wang yilu →
    wang yilyu; an se young → an se-young) so they do *not* fork.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

DISCIPLINES = ("MS", "WS", "MD", "WD", "XD")
SINGLES = frozenset({"MS", "WS"})
DOUBLES = frozenset({"MD", "WD", "XD"})

# --- 1.2 alias map (normalized form → canonical key) ----------------------
# Applied after NFKD / lowercase / generic-suffix strip. Add only confirmed
# same-person spelling variants — a bad merge poisons every rating it touches.
NAME_ALIASES: dict[str, str] = {
    "wang yilu": "wang yilyu",
    "wang yilyu": "wang yilyu",
    "an se young": "an se-young",
    "an seyoung": "an se-young",
    "an se yeong": "an se-young",
    "an se-yeong": "an se-young",
    "an se-young": "an se-young",
}

_GENERIC_PAREN_TOKENS = frozenset(
    {"badminton", "player", "badminton player"}
)

_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")
_DISC_RE = re.compile(r"\b(MS|WS|MD|WD|XD)\b", re.I)

# Round-order table (1.3). First matching rule wins.
_ROUND_RULES: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"qual", re.I), 0),
    (re.compile(r"\bgroup\b", re.I), 1),
    (re.compile(r"round of 64|\br64\b|1/?64", re.I), 2),
    (re.compile(r"round of 32|\br32\b|1/?32", re.I), 3),
    (re.compile(r"round of 16|\br16\b|1/?16|third round", re.I), 4),
    (re.compile(r"quarter|\bqf\b", re.I), 5),
    (re.compile(r"semi|\bsf\b", re.I), 6),
    (re.compile(r"bronze|3rd|third place|3/?4", re.I), 7),
    (re.compile(r"\bfinal\b", re.I), 8),
]


# ---------------------------------------------------------------------------
# 1.2 Name normalization + homonym keys
# ---------------------------------------------------------------------------

def _strip_combining(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def _rewrite_parens(raw: str) -> str:
    """Drop generic (badminton)/(player); keep (born 1980) and similar."""

    def repl(m: re.Match[str]) -> str:
        inner = m.group(1)
        parts = [p.strip() for p in re.split(r"[,;]", inner) if p.strip()]
        keep = [p for p in parts if p.lower() not in _GENERIC_PAREN_TOKENS]
        if not keep:
            return " "
        return " (" + ", ".join(keep) + ")"

    return re.sub(r"\(([^)]*)\)", repl, raw)


def normalize_name(raw: str | None) -> str:
    """Spec 1.2. Returns the ratings key fragment (no country)."""
    if not raw:
        return ""
    s = str(raw).replace("_", " ")
    s = _strip_combining(s)
    s = _rewrite_parens(s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    if not s:
        return ""
    return NAME_ALIASES.get(s, s)


def normalize_country(raw: str | None) -> str:
    if not raw:
        return ""
    s = _strip_combining(str(raw)).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    # Common Wikipedia flagicon aliases.
    aliases = {
        "prc": "chn",
        "china": "chn",
        "chinese taipei": "tpe",
        "taiwan": "tpe",
        "korea": "kor",
        "southkorea": "kor",
        "rok": "kor",
        "den": "den",
        "denmark": "den",
        "ina": "ina",
        "indonesia": "ina",
        "mas": "mas",
        "malaysia": "mas",
        "jpn": "jpn",
        "japan": "jpn",
        "tha": "tha",
        "thailand": "tha",
        "ind": "ind",
        "india": "ind",
        "eng": "eng",
        "england": "eng",
        "sgp": "sgp",
        "singapore": "sgp",
        "usa": "usa",
        "unitedstates": "usa",
        "fra": "fra",
        "france": "fra",
        "ger": "ger",
        "germany": "ger",
        "hkg": "hkg",
        "hongkong": "hkg",
    }
    return aliases.get(s, s)


def entity_key(name: str | None, country: str | None = None) -> str:
    """Ratings identity: normalized name, plus country when present.

    ``Chen Yu`` + CHN and ``Chen Yu`` + TPE are two keys.
    ``Wang Yilü`` and ``Wang Yilu`` collapse via NFKD + alias.
    """
    n = normalize_name(name)
    if not n:
        return ""
    cc = normalize_country(country)
    return f"{n}|{cc}" if cc else n


_VOWELS = set("aeiou")


def _split_name(normalized: str) -> tuple[str, str, bool] | None:
    tokens = [t for t in normalized.split(" ") if t]
    if len(tokens) < 2:
        return None
    if re.fullmatch(r"[a-z](?:[.\s][a-z])*", tokens[0]):
        return tokens[-1], " ".join(tokens[:-1]), True
    return tokens[0], " ".join(tokens[1:]), False


def given_initials(given: str) -> str:
    parts = [p for p in re.split(r"[\s.-]+", given) if p]
    if len(parts) >= 2:
        return "".join(p[0] for p in parts)
    w = parts[0] if parts else ""
    if len(w) < 2:
        return w
    out = [w[0]]
    i = 1
    while i < len(w) and w[i] not in _VOWELS:
        i += 1
    while i < len(w) and w[i] in _VOWELS:
        i += 1
    while i < len(w):
        if w[i] not in _VOWELS:
            out.append(w[i])
            while i < len(w) and w[i] not in _VOWELS:
                i += 1
            while i < len(w) and w[i] in _VOWELS:
                i += 1
        else:
            i += 1
    return "".join(out)


def is_abbrev_given(given: str) -> bool:
    if not given:
        return False
    if re.fullmatch(r"[a-z](?:[.\s-]+[a-z])+", given):
        return True
    if re.fullmatch(r"[a-z]{2,4}", given):
        without_y = given.replace("y", "")
        return bool(without_y) and not any(c in _VOWELS for c in without_y)
    return False


def _is_full_given(given: str) -> bool:
    return any(len(p) >= 3 for p in re.split(r"[\s-]+", given))


def _is_subsequence(word: str, initials: str) -> bool:
    if not initials or not word or word[0] != initials[0]:
        return False
    i = 1
    for ch in initials[1:]:
        at = word.find(ch, i)
        if at < 0:
            return False
        i = at + 1
    return True


def apply_canonical_names(rows: Iterable[dict]) -> list[dict]:
    """Collapse unique Wikipedia abbreviations onto the full name."""
    raw = list(rows)
    people: list[tuple[str, str, str]] = []  # display, key, country
    for row in raw:
        for side in (1, 2):
            for slot in (1, 2):
                name = row.get(f"team{side}_player{slot}")
                cc = normalize_country(
                    row.get(f"team{side}_player{slot}_country")
                    or row.get(f"team{side}_p{slot}_country")
                )
                key = normalize_name(name)
                if key:
                    people.append((str(name), key, cc))

    class _P:
        __slots__ = ("display", "key", "country", "surname", "given", "initials", "abbrev")

        def __init__(self, display, key, country, surname, given, initials, abbrev):
            self.display = display
            self.key = key
            self.country = country
            self.surname = surname
            self.given = given
            self.initials = initials
            self.abbrev = abbrev

    parsed: list[_P] = []
    for display, key, country in people:
        parts = _split_name(key)
        if not parts:
            continue
        sur, given, _west = parts
        parsed.append(
            _P(
                display,
                key,
                country,
                sur,
                given,
                given_initials(given),
                is_abbrev_given(given),
            )
        )
    fulls = [p for p in parsed if not p.abbrev and _is_full_given(p.given)]
    mapping: dict[str, str] = {}
    for abbr in parsed:
        if not abbr.abbrev:
            continue
        letters = re.sub(r"[^a-z]", "", abbr.given)
        if len(letters) < 2:
            continue
        hits = []
        for f in fulls:
            if f.surname != abbr.surname:
                continue
            if abbr.country and f.country and abbr.country != f.country:
                continue
            if f.initials == letters:
                hits.append(f)
            elif " " not in f.given and "-" not in f.given and _is_subsequence(
                re.sub(r"[^a-z]", "", f.given), letters
            ):
                hits.append(f)
        uniq = {h.key for h in hits}
        if len(uniq) != 1:
            continue
        canon = max(hits, key=lambda h: len(h.display))
        mapping[f"{abbr.key}|{abbr.country}"] = canon.display
        if not abbr.country and canon.country:
            mapping[f"{abbr.key}|{canon.country}"] = canon.display

    if not mapping:
        return raw
    out: list[dict] = []
    for row in raw:
        copy = dict(row)
        for side in (1, 2):
            for slot in (1, 2):
                nk = f"team{side}_player{slot}"
                ck = f"team{side}_player{slot}_country"
                name = copy.get(nk)
                key = normalize_name(name)
                if not key:
                    continue
                cc = normalize_country(copy.get(ck) or copy.get(f"team{side}_p{slot}_country"))
                canon = mapping.get(f"{key}|{cc}") or mapping.get(f"{key}|")
                if canon:
                    copy[nk] = canon
        out.append(copy)
    return out


def pair_key(a: str, b: str) -> str:
    """Order-independent pair identity (A/B == B/A)."""
    parts = sorted(p for p in (a, b) if p)
    return " / ".join(parts)


def display_name(key: str) -> str:
    """Title-case a normalized entity key for output."""
    name = key.split("|", 1)[0]
    words = []
    for w in name.split(" "):
        if w.startswith("(") and w.endswith(")"):
            words.append(w)
            continue
        bits = []
        for part in w.split("-"):
            bits.append(part[:1].upper() + part[1:] if part else part)
        words.append("-".join(bits))
    return " ".join(words)


def web_id(key: str) -> str:
    """URL slug matching apps/web playerIdFromName (name + optional country)."""
    name, _, cc = key.partition("|")
    slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")
    if cc:
        slug = f"{slug}--{cc}"
    return slug[:80]


# ---------------------------------------------------------------------------
# 1.1 Cleaning
# ---------------------------------------------------------------------------

def parse_discipline(tournament: str | None) -> str | None:
    if not tournament:
        return None
    m = _DISC_RE.search(tournament)
    if not m:
        return None
    d = m.group(1).upper()
    return d if d in DISCIPLINES else None


def parse_year(tournament: str | None) -> int | None:
    if not tournament:
        return None
    m = _YEAR_RE.search(tournament)
    return int(m.group(1)) if m else None


def games_from_row(row: dict) -> list[tuple[int, int]]:
    games: list[tuple[int, int]] = []
    for n in (1, 2, 3):
        a, b = row.get(f"g{n}_t1"), row.get(f"g{n}_t2")
        if a is None or b is None:
            continue
        try:
            games.append((int(a), int(b)))
        except (TypeError, ValueError):
            continue
    return games


def determine_winner(games: list[tuple[int, int]]) -> int | None:
    """Winner only when one side has won ≥ 2 games with real scores."""
    if not games:
        return None
    w1 = w2 = 0
    for a, b in games:
        if a > b:
            w1 += 1
        elif b > a:
            w2 += 1
    if w1 >= 2 and w1 > w2:
        return 1
    if w2 >= 2 and w2 > w1:
        return 2
    return None


def is_real_player(name: str | None) -> bool:
    n = normalize_name(name)
    if not n:
        return False
    return _NON_PLAYER_RE.match(n) is None


def roster_names(row: dict) -> tuple[str, ...]:
    names = []
    for k in (
        "team1_player1",
        "team1_player2",
        "team2_player1",
        "team2_player2",
    ):
        n = normalize_name(row.get(k))
        if n:
            names.append(n)
    return tuple(sorted(names))


def score_tuple(games: list[tuple[int, int]]) -> tuple[int, ...]:
    out: list[int] = []
    for a, b in games:
        out.extend((a, b))
    while len(out) < 6:
        out.append(-1)
    return tuple(out[:6])


def dedupe_key(row: dict, games: list[tuple[int, int]]) -> tuple:
    return (
        (row.get("tournament") or "").strip(),
        roster_names(row),
        score_tuple(games),
    )


def infer_unique_countries(rows: Iterable[dict]) -> dict[str, str]:
    """normalized name → country when that name appears with exactly one country.

    Fills missing flagicons for a unique person without merging true homonyms
    (Chen Yu CHN vs Chen Yu TPE stay split).
    """
    seen: dict[str, set[str]] = {}
    for row in rows:
        for side in (1, 2):
            for slot in (1, 2):
                name = row.get(f"team{side}_player{slot}")
                country = row.get(f"team{side}_player{slot}_country") or row.get(
                    f"team{side}_p{slot}_country"
                )
                n = normalize_name(name)
                cc = normalize_country(country)
                if not n or not cc:
                    continue
                seen.setdefault(n, set()).add(cc)
    return {n: next(iter(ccs)) for n, ccs in seen.items() if len(ccs) == 1}


def apply_inferred_countries(rows: Iterable[dict]) -> list[dict]:
    raw = list(rows)
    inferred = infer_unique_countries(raw)
    if not inferred:
        return raw
    out: list[dict] = []
    for row in raw:
        copy = dict(row)
        for side in (1, 2):
            for slot in (1, 2):
                n = normalize_name(copy.get(f"team{side}_player{slot}"))
                if not n or n not in inferred:
                    continue
                ck = f"team{side}_player{slot}_country"
                if not normalize_country(copy.get(ck)):
                    copy[ck] = inferred[n]
        out.append(copy)
    return out


def team_entities(row: dict, side: int) -> list[tuple[str, str | None]]:
    """[(entity_key, raw_name), ...] for one side. Skips blank slots."""
    p1 = row.get(f"team{side}_player1")
    p2 = row.get(f"team{side}_player2")
    c1 = row.get(f"team{side}_player1_country") or row.get(f"team{side}_p1_country")
    c2 = row.get(f"team{side}_player2_country") or row.get(f"team{side}_p2_country")
    out: list[tuple[str, str | None]] = []
    for name, country in ((p1, c1), (p2, c2)):
        k = entity_key(name, country)
        if k:
            out.append((k, name))
    return out


@dataclass
class CleanMatch:
    tournament: str
    year: int
    disc: str
    round_label: str
    round_order: int
    games: list[tuple[int, int]]
    winner: int  # 1 or 2
    side1: list[str]  # entity keys
    side2: list[str]
    weight: float
    s_win: float
    day: int = 0
    seq: int = 0


def clean_matches(rows: Iterable[dict]) -> list[CleanMatch]:
    """Apply 1.1. Typical yield ~37,900 from ~39,001 raw rows."""
    kept: list[CleanMatch] = []
    seen: set[tuple] = set()
    for row in rows:
        games = games_from_row(row)
        winner = determine_winner(games)
        if winner is None:
            continue
        disc = parse_discipline(row.get("tournament"))
        if disc is None:
            continue
        dkey = dedupe_key(row, games)
        if dkey in seen:
            continue
        seen.add(dkey)
        year = parse_year(row.get("tournament"))
        if year is None:
            continue
        s1 = [k for k, raw in team_entities(row, 1) if is_real_player(raw)]
        s2 = [k for k, raw in team_entities(row, 2) if is_real_player(raw)]
        if disc in SINGLES:
            if len(s1) != 1 or len(s2) != 1:
                continue
        else:
            if len(s1) != 2 or len(s2) != 2:
                continue
        if sorted(s1) == sorted(s2):
            continue
        rnd = (row.get("round") or "") or _round_from_tournament(row.get("tournament"))
        ro = round_order(rnd)
        w = match_weight(row.get("tournament") or "", rnd)
        s_win = score_result(games, winner)
        kept.append(
            CleanMatch(
                tournament=row.get("tournament") or "",
                year=year,
                disc=disc,
                round_label=rnd,
                round_order=ro,
                games=games,
                winner=winner,
                side1=s1,
                side2=s2,
                weight=w,
                s_win=s_win,
            )
        )
    return kept


def _round_from_tournament(raw: str | None) -> str:
    if not raw:
        return ""
    parts = [p.strip() for p in raw.split("·")]
    return parts[-1] if len(parts) >= 3 else ""


# ---------------------------------------------------------------------------
# 1.3 Chronological order
# ---------------------------------------------------------------------------

def round_order(round_label: str | None) -> int:
    text = round_label or ""
    for pat, order in _ROUND_RULES:
        if pat.search(text):
            return order
    return 4  # unparsed sits near mid-draw; day formula still monotonic


def assign_days(matches: list[CleanMatch]) -> list[CleanMatch]:
    """Sort by (year, round_order, tournament name); assign 1.3 day index."""
    ordered = sorted(
        matches,
        key=lambda m: (m.year, m.round_order, m.tournament),
    )
    for i, m in enumerate(ordered):
        m.seq = i
        m.day = m.year * 400 + m.round_order * 30 + (i % 30)
    return ordered


# ---------------------------------------------------------------------------
# 2. Match weight  w = w_tier × w_round
# ---------------------------------------------------------------------------

# First match wins. Super 1000 is listed before Super 100 so "Super 1000"
# is not swallowed by the "super 100" substring. Named Super 100 events
# (Baoji / Ruichang) sit above "China Masters" so they stay 0.30, not 0.85.
_TIER_RULES: list[tuple[float, tuple[str, ...]]] = [
    (
        1.00,
        (
            "world championship",
            "world championships",
            "olympics",
            "olympic games",
            "world tour finals",
            "bwf world tour finals",
        ),
    ),
    (
        0.95,
        (
            "super 1000",
            "all england",
            "china open",
            "indonesia open",
            "malaysia open",
            "japan open",
        ),
    ),
    (
        0.30,
        (
            "ruichang",
            "baoji",
            "akita masters",
            "vietnam open",
            "odisha",
            "guwahati",
            "syed modi",
            "kaohsiung",
            "taipei open",
        ),
    ),
    (
        0.85,
        (
            "super 750",
            "denmark open",
            "french open",
            "singapore open",
            "indonesia masters",
            "china masters",
            "india open",
        ),
    ),
    (
        0.70,
        (
            "super 500",
            "korea open",
            "thailand open",
            "arctic open",
            "hong kong open",
            "australia open",
            "australian open",
            "malaysia masters",
            "japan masters",
        ),
    ),
    (
        0.55,
        (
            "super 300",
            "german open",
            "swiss open",
            "spain masters",
            "korea masters",
            "us open",
            "canada open",
            "new zealand open",
            "thailand masters",
            "macau open",
            "taipei masters",
        ),
    ),
    (
        0.30,
        (
            "ruichang",
            "baoji",
            "akita masters",
            "vietnam open",
            "odisha",
            "guwahati",
            "syed modi",
            "kaohsiung",
            "taipei open",
        ),
    ),
]

_SUPER_100_RE = re.compile(r"super\s*100(?!\s*0)")
_NON_PLAYER_RE = re.compile(
    r"^(bye|walkover|w/?o|retired|retire|tbd|n/?a|qualifier|q\d+|lucky loser)$",
    re.I,
)


def tournament_tier_weight(tournament: str) -> float:
    t = tournament.lower()
    for weight, keys in _TIER_RULES:
        if any(k in t for k in keys):
            return weight
    if _SUPER_100_RE.search(t):
        return 0.30
    return 0.40  # Other / unrecognized


_ROUND_WEIGHT = {
    8: 1.00,  # Final
    7: 0.97,  # Bronze
    6: 0.98,  # SF
    5: 0.96,  # QF
    4: 0.94,  # R16
    3: 0.92,  # R32
    2: 0.90,  # R64
    1: 0.90,  # Group
    0: 0.88,  # Qual
}


def round_weight(round_label: str | None) -> float:
    ro = round_order(round_label)
    return _ROUND_WEIGHT.get(ro, 0.93)


def match_weight(tournament: str, round_label: str | None) -> float:
    return tournament_tier_weight(tournament) * round_weight(round_label)


# ---------------------------------------------------------------------------
# 3. Score-aware result S
# ---------------------------------------------------------------------------

def score_result(games: list[tuple[int, int]], winner: int) -> float:
    g1 = g2 = 0
    pts1 = pts2 = 0
    for a, b in games:
        pts1 += a
        pts2 += b
        if a > b:
            g1 += 1
        elif b > a:
            g2 += 1
    total = pts1 + pts2
    margin = abs(pts1 - pts2) / total if total else 0.0
    win_games = g1 if winner == 1 else g2
    lose_games = g2 if winner == 1 else g1
    if win_games >= 2 and lose_games == 0:
        return 0.92 + 0.08 * min(1.0, 2.0 * margin)
    return 0.85 + 0.10 * min(1.0, 2.0 * margin)


# ---------------------------------------------------------------------------
# 4. Glicko-2
# ---------------------------------------------------------------------------

SCALE = 173.7178
MU0 = 1500.0
RD0 = 350.0
SIGMA0 = 0.06
TAU = 0.5
RD_MAX = 350.0
SIGMA_MAX = 1.0
IDLE_THRESHOLD = 70
IDLE_PERIOD = 7
MIN_MATCHES_SINGLES = 15
MIN_MATCHES_PAIRS = 10
# Keep E away from {0,1} so 1/v and Illinois stay finite on a 39k-match catalog.
_E_MIN = 1e-15
_E_MAX = 1.0 - 1e-15
_EXP_CLAMP = 60.0


def _safe_exp(x: float) -> float:
    if x > _EXP_CLAMP:
        return math.exp(_EXP_CLAMP)
    if x < -_EXP_CLAMP:
        return math.exp(-_EXP_CLAMP)
    return math.exp(x)


def _g(phi: float) -> float:
    if not math.isfinite(phi):
        phi = RD_MAX / SCALE
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def _E(mu: float, mu_j: float, phi_j: float) -> float:
    """Numerically stable Glicko expected score. Never raises, never 0/1."""
    x = -_g(phi_j) * (mu - mu_j)
    if x >= _EXP_CLAMP:
        e = 0.0
    elif x <= -_EXP_CLAMP:
        e = 1.0
    else:
        e = 1.0 / (1.0 + math.exp(x))
    if not math.isfinite(e):
        e = 0.5
    return min(_E_MAX, max(_E_MIN, e))


def _f_vol(x: float, delta: float, phi: float, v: float, a: float, tau: float) -> float:
    ex = _safe_exp(x)
    den = 2.0 * (phi * phi + v + ex) ** 2
    if den <= 0.0 or not math.isfinite(den):
        return 0.0
    num = ex * (delta * delta - phi * phi - v - ex)
    return num / den - (x - a) / (tau * tau)


def _update_volatility(phi: float, sigma: float, v: float, delta: float, tau: float) -> float:
    if not (math.isfinite(phi) and math.isfinite(v) and math.isfinite(delta) and sigma > 0):
        return min(SIGMA_MAX, max(1e-6, sigma if math.isfinite(sigma) and sigma > 0 else SIGMA0))
    # Huge Δ makes Illinois hunt an enormous σ; cap Δ so σ stays a volatility.
    delta = max(-1e3, min(1e3, delta))
    v = max(v, 1e-6)
    a = math.log(max(sigma * sigma, 1e-18))
    if delta * delta > phi * phi + v:
        b = math.log(delta * delta - phi * phi - v)
    else:
        k = 1
        while _f_vol(a - k * tau, delta, phi, v, a, tau) < 0:
            k += 1
            if k > 100:
                return min(SIGMA_MAX, sigma)
        b = a - k * tau
    fa = _f_vol(a, delta, phi, v, a, tau)
    fb = _f_vol(b, delta, phi, v, a, tau)
    if not (math.isfinite(fa) and math.isfinite(fb)) or fa == fb:
        return min(SIGMA_MAX, max(1e-6, sigma))
    for _ in range(80):
        if abs(b - a) < 1e-6:
            break
        denom = fb - fa
        if denom == 0.0 or not math.isfinite(denom):
            break
        c = a + (a - b) * fa / denom
        if not math.isfinite(c):
            break
        fc = _f_vol(c, delta, phi, v, a, tau)
        if not math.isfinite(fc):
            break
        if fc * fb <= 0:
            a, fa = b, fb
        else:
            fa /= 2.0
        b, fb = c, fc
    sigma_new = math.exp(a / 2.0)
    if not math.isfinite(sigma_new) or sigma_new <= 0:
        return min(SIGMA_MAX, max(1e-6, sigma))
    return min(SIGMA_MAX, max(1e-6, sigma_new))


@dataclass
class GlickoPlayer:
    key: str
    mu: float = MU0
    rd: float = RD0
    sigma: float = SIGMA0
    peak_mu: float = MU0
    peak_rd: float = RD0
    last_day: int | None = None
    wins: int = 0
    losses: int = 0
    matches: int = 0

    def to_internal(self) -> tuple[float, float]:
        return (self.mu - 1500.0) / SCALE, self.rd / SCALE

    def from_internal(self, mu_int: float, phi: float) -> None:
        if not math.isfinite(mu_int):
            mu_int = (self.mu - 1500.0) / SCALE
        if not math.isfinite(phi) or phi <= 0:
            phi = self.rd / SCALE
        self.mu = mu_int * SCALE + 1500.0
        self.rd = min(RD_MAX, max(1e-3, phi * SCALE))

    def apply_inactivity(self, day: int) -> None:
        if self.last_day is None:
            return
        gap = day - self.last_day
        if gap <= IDLE_THRESHOLD:
            return
        n = (gap - IDLE_THRESHOLD) / IDLE_PERIOD
        _, phi = self.to_internal()
        phi_max = RD_MAX / SCALE
        phi_new = min(phi_max, math.sqrt(phi * phi + self.sigma * self.sigma * n))
        self.from_internal((self.mu - 1500.0) / SCALE, phi_new)

    @property
    def rank_score(self) -> float:
        return self.mu - 2.0 * self.rd


def _weighted_glicko_update(player: GlickoPlayer, opp_mu: float, opp_phi: float, s: float, w: float) -> None:
    mu, phi = player.to_internal()
    if not (math.isfinite(mu) and math.isfinite(phi) and math.isfinite(opp_mu) and math.isfinite(opp_phi)):
        return
    e = _E(mu, opp_mu, opp_phi)
    g = _g(opp_phi)
    w = max(1e-6, min(1.0, w))
    info = max(1e-6, w * g * g * e * (1.0 - e))
    v = 1.0 / info
    delta = v * (w * g * (s - e))
    sigma_new = _update_volatility(phi, player.sigma, v, delta, TAU)
    player.sigma = sigma_new
    phi_star = math.sqrt(phi * phi + sigma_new * sigma_new)
    phi_p = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
    mu_p = mu + phi_p * phi_p * (w * g * (s - e))
    if not (math.isfinite(mu_p) and math.isfinite(phi_p)):
        return
    player.from_internal(mu_p, phi_p)


def _glicko_entity(m: CleanMatch, side: int) -> str:
    keys = m.side1 if side == 1 else m.side2
    if m.disc in SINGLES:
        return keys[0]
    return pair_key(keys[0], keys[1] if len(keys) > 1 else "")


def run_glicko(matches: list[CleanMatch], disc: str) -> dict[str, GlickoPlayer]:
    pool = [m for m in matches if m.disc == disc]
    players: dict[str, GlickoPlayer] = {}

    def get(key: str) -> GlickoPlayer:
        p = players.get(key)
        if p is None:
            p = GlickoPlayer(key=key)
            players[key] = p
        return p

    for m in pool:
        a_key = _glicko_entity(m, 1)
        b_key = _glicko_entity(m, 2)
        if not a_key or not b_key:
            continue
        a, b = get(a_key), get(b_key)
        a.apply_inactivity(m.day)
        b.apply_inactivity(m.day)
        a_mu, a_phi = a.to_internal()
        b_mu, b_phi = b.to_internal()
        s_a = m.s_win if m.winner == 1 else 1.0 - m.s_win
        s_b = 1.0 - s_a
        _weighted_glicko_update(a, b_mu, b_phi, s_a, m.weight)
        _weighted_glicko_update(b, a_mu, a_phi, s_b, m.weight)
        a.matches += 1
        b.matches += 1
        if m.winner == 1:
            a.wins += 1
            b.losses += 1
        else:
            b.wins += 1
            a.losses += 1
        a.last_day = m.day
        b.last_day = m.day
        if a.mu > a.peak_mu:
            a.peak_mu, a.peak_rd = a.mu, a.rd
        if b.mu > b.peak_mu:
            b.peak_mu, b.peak_rd = b.mu, b.rd

    if pool:
        last = pool[-1].day
        for p in players.values():
            p.apply_inactivity(last)
    return players


# ---------------------------------------------------------------------------
# 6. TrueSkill individuals (doubles only)
# ---------------------------------------------------------------------------

TS_MU0 = 25.0
TS_SIGMA0 = 25.0 / 3.0
TS_BETA = 25.0 / 6.0
TS_TAU = 25.0 / 300.0
MIN_MATCHES_INDIVIDUAL = 15


def _norm_pdf(x: float) -> float:
    ax = min(abs(x), 30.0)
    return math.exp(-0.5 * ax * ax) / math.sqrt(2.0 * math.pi)


def _norm_cdf(x: float) -> float:
    if x > 8.0:
        return 1.0
    if x < -8.0:
        return 0.0
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


@dataclass
class TrueSkillPlayer:
    key: str
    mu: float = TS_MU0
    sigma: float = TS_SIGMA0
    matches: int = 0

    @property
    def exposure(self) -> float:
        return self.mu - 3.0 * self.sigma


def run_trueskill(matches: list[CleanMatch], disc: str) -> dict[str, TrueSkillPlayer]:
    pool = [m for m in matches if m.disc == disc]
    players: dict[str, TrueSkillPlayer] = {}

    def get(key: str) -> TrueSkillPlayer:
        p = players.get(key)
        if p is None:
            p = TrueSkillPlayer(key=key)
            players[key] = p
        return p

    for m in pool:
        w_keys = m.side1 if m.winner == 1 else m.side2
        l_keys = m.side2 if m.winner == 1 else m.side1
        if not w_keys or not l_keys:
            continue
        winners = [get(k) for k in w_keys]
        losers = [get(k) for k in l_keys]
        c2 = TS_BETA * TS_BETA * (len(winners) + len(losers))
        c2 += sum(p.sigma * p.sigma for p in winners)
        c2 += sum(p.sigma * p.sigma for p in losers)
        c = math.sqrt(max(c2, 1e-12))
        t = (sum(p.mu for p in winners) - sum(p.mu for p in losers)) / c
        cdf = _norm_cdf(t)
        if cdf < 1e-12:
            cdf = 1e-12
        v = _norm_pdf(t) / cdf
        w_term = v * (v + t)
        v *= m.weight
        w_term *= m.weight
        for p in winners:
            s2 = p.sigma * p.sigma
            mu = p.mu + (s2 / c) * v
            sig = math.sqrt(max(1e-12, s2 * (1.0 - (s2 / (c * c)) * w_term) + TS_TAU * TS_TAU))
            if math.isfinite(mu) and math.isfinite(sig):
                p.mu, p.sigma = mu, sig
            p.matches += 1
        for p in losers:
            s2 = p.sigma * p.sigma
            mu = p.mu - (s2 / c) * v
            sig = math.sqrt(max(1e-12, s2 * (1.0 - (s2 / (c * c)) * w_term) + TS_TAU * TS_TAU))
            if math.isfinite(mu) and math.isfinite(sig):
                p.mu, p.sigma = mu, sig
            p.matches += 1
    return players


# ---------------------------------------------------------------------------
# 7. End-to-end
# ---------------------------------------------------------------------------

@dataclass
class RatingRow:
    discipline: str
    kind: str  # player | pair
    entity_key: str
    display_name: str
    country: str | None
    mu: float
    rd: float
    sigma: float
    peak_mu: float
    peak_rd: float
    rank_score: float
    matches: int
    wins: int
    losses: int
    last_day: int | None
    web_id: str


@dataclass
class IndividualRow:
    discipline: str
    entity_key: str
    display_name: str
    country: str | None
    mu: float
    sigma: float
    exposure: float
    matches: int
    web_id: str


@dataclass
class RatingsResult:
    clean_count: int
    dropped: int
    glicko: list[RatingRow] = field(default_factory=list)
    individuals: list[IndividualRow] = field(default_factory=list)


def _split_country(key: str) -> str | None:
    if "|" in key:
        return key.split("|", 1)[1] or None
    return None


def compute_ratings(rows: Iterable[dict]) -> RatingsResult:
    raw = apply_canonical_names(apply_inferred_countries(rows))
    cleaned = assign_days(clean_matches(raw))
    result = RatingsResult(clean_count=len(cleaned), dropped=len(raw) - len(cleaned))

    for disc in DISCIPLINES:
        kind = "player" if disc in SINGLES else "pair"
        min_n = MIN_MATCHES_SINGLES if kind == "player" else MIN_MATCHES_PAIRS
        board = run_glicko(cleaned, disc)
        for p in board.values():
            if p.matches < min_n:
                continue
            result.glicko.append(
                RatingRow(
                    discipline=disc,
                    kind=kind,
                    entity_key=p.key,
                    display_name=display_name(p.key),
                    country=_split_country(p.key),
                    mu=p.mu,
                    rd=p.rd,
                    sigma=p.sigma,
                    peak_mu=p.peak_mu,
                    peak_rd=p.peak_rd,
                    rank_score=p.rank_score,
                    matches=p.matches,
                    wins=p.wins,
                    losses=p.losses,
                    last_day=p.last_day,
                    web_id=web_id(p.key) if kind == "player" else "--".join(
                        web_id(part) for part in p.key.split(" / ")
                    ),
                )
            )
        if disc in DOUBLES:
            ind = run_trueskill(cleaned, disc)
            for p in ind.values():
                if p.matches < MIN_MATCHES_INDIVIDUAL:
                    continue
                result.individuals.append(
                    IndividualRow(
                        discipline=disc,
                        entity_key=p.key,
                        display_name=display_name(p.key),
                        country=_split_country(p.key),
                        mu=p.mu,
                        sigma=p.sigma,
                        exposure=p.exposure,
                        matches=p.matches,
                        web_id=web_id(p.key),
                    )
                )
    return result
