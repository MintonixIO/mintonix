#!/usr/bin/env python3
"""
Match BWF TV YouTube videos to scraped tournament matches — fully offline.

Reads:
  - yt-dlp flat JSON from fetch_bwf_videos.py (--videos-file)
  - scraped results from scraper.py     (bwf_<year>_results.json, --results / auto-glob)

Parses video titles, scores them against the scraped matches, and writes a
local mapping file (--out, default video_matches.json):

  [ {"match_key": ..., "video_id": ..., "video_title": ..., "confidence": ...}, ... ]

This script does NOT touch Supabase. load_to_supabase.py consumes the mapping
(via --videos-file) and folds the video columns onto each match row, so the
loader is the only writer that needs the service key.

Usage:
  python3 find_youtube_videos.py --videos-file bwf_videos.json
  python3 find_youtube_videos.py --videos-file bwf_videos.json --results bwf_2026_results.json
  python3 find_youtube_videos.py --videos-file bwf_videos.json --dry-run
"""
import argparse
import glob
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

ROUND_MAP = {
    "round of 64": "Round of 64",
    "round of 32": "Round of 32",
    "round of 16": "Round of 16",
    "round 1": "Round of 32",
    "round 2": "Round of 16",
    "quarter-finals": "Quarter-finals",
    "quarterfinal": "Quarter-finals",
    "quarter finals": "Quarter-finals",
    "semi-finals": "Semi-finals",
    "semifinal": "Semi-finals",
    "semi finals": "Semi-finals",
    "final": "Final",
    "qualification": "Qualification",
    "qualifying round": "Qualification",
    "group a": "Group A",
    "group b": "Group B",
    "group c": "Group C",
    "group d": "Group D",
}

DISCIPLINE_ALIASES = {
    "ms": "MS", "men's singles": "MS", "men singles": "MS",
    "ws": "WS", "women's singles": "WS", "women singles": "WS",
    "md": "MD", "men's doubles": "MD", "men doubles": "MD",
    "wd": "WD", "women's doubles": "WD", "women doubles": "WD",
    "xd": "XD", "mixed doubles": "XD", "mixed doubles (xd)": "XD",
}


# ============================ Title parsing ============================

def find_discipline(text):
    text_lower = text.lower()
    for short in ("MS", "WS", "MD", "WD", "XD"):
        pattern = r'(?<!\w)' + re.escape(short.lower()) + r'(?!\w)'
        if re.search(pattern, text_lower):
            return short
    for alias, code in DISCIPLINE_ALIASES.items():
        if alias in text_lower:
            return code
    return None


def find_round(text):
    text_lower = text.lower()
    for alias, canonical in ROUND_MAP.items():
        if alias in text_lower:
            return canonical
    return None


def parse_team_members(segment):
    members = []
    for raw in segment.split("/"):
        raw = raw.strip()
        raw = re.sub(r'\s*\[\d+\]\s*', ' ', raw)
        raw = re.sub(r'\s*\([A-Za-z]{3}\)\s*', ' ', raw)
        raw = re.sub(r'\s+', ' ', raw).strip()
        if raw:
            members.append(raw)
    return members


def parse_video_title(title):
    parts = [p.strip() for p in title.split("|")]

    vs_part = None
    other_parts = []
    for p in parts:
        if " vs. " in p or " vs " in p:
            if vs_part is None or len(p) > len(vs_part):
                vs_part = p
        else:
            other_parts.append(p)

    if not vs_part:
        return None

    vs_sep = " vs. " if " vs. " in vs_part else " vs "
    teams_raw = vs_part.split(vs_sep)
    if len(teams_raw) != 2:
        return None

    team1 = parse_team_members(teams_raw[0])
    team2 = parse_team_members(teams_raw[1])
    if not team1 or not team2:
        return None

    all_text = " ".join(other_parts)
    discipline = find_discipline(all_text) or find_discipline(vs_part) or find_discipline(title)
    round_name = find_round(all_text)

    return {
        "team1": team1,
        "team2": team2,
        "discipline": discipline,
        "round": round_name,
    }


# ============================ Scoring ============================

def player_name_variants(name):
    variants = set()
    name = name.strip()
    variants.add(name.lower())
    variants.add(name.lower().replace(" ", ""))
    variants.add(name.lower().replace("-", " "))
    parts = name.split()
    if len(parts) > 1:
        variants.add(parts[-1].lower())
        variants.add(parts[0].lower())
    return variants


def score_player_match(yt_name, db_name):
    db_name = (db_name or "").strip()
    yt_norm = yt_name.strip().lower()
    if not db_name:
        return 0.0
    if yt_norm == db_name.lower():
        return 1.0

    if not (player_name_variants(yt_name) & player_name_variants(db_name)):
        return 0.0

    if yt_norm == db_name.split()[-1].lower():
        return 0.7
    return 0.6


def score_match_parsed(parsed, match):
    """Compare a parsed video title against a scraped match. 0..1."""
    score = 0.0
    factors = 0

    if parsed["discipline"] and match["discipline"]:
        factors += 1
        if parsed["discipline"] == match["discipline"]:
            score += 1.0
        else:
            return 0.0  # explicit discipline mismatch disqualifies

    if parsed["round"] and match.get("round"):
        factors += 1
        yt_round = parsed["round"].lower().replace("-", " ")
        db_round = match["round"].lower().replace("-", " ")
        if yt_round == db_round:
            score += 1.0
        elif yt_round in db_round or db_round in yt_round:
            score += 0.7

    db_team1, db_team2 = match["team1"], match["team2"]
    # A bye/walkover has an empty side; with no opponent to verify against, any
    # title could "match" on discipline/round alone. Require both rosters.
    if not db_team1 or not db_team2:
        return 0.0
    if db_team1 and db_team2:
        factors += 2
        best1 = _team_score(parsed["team1"], db_team1)
        best2 = _team_score(parsed["team2"], db_team2)
        # also try the swapped orientation (title order may differ from draw)
        best1s = _team_score(parsed["team1"], db_team2)
        best2s = _team_score(parsed["team2"], db_team1)
        if min(best1s, best2s) > min(best1, best2):
            best1, best2 = best1s, best2s
        if best1 >= 0.5 and best2 >= 0.5:
            score += best1 + best2
        else:
            return 0.0

    if factors == 0:
        return 0.0
    return score / factors


def _team_score(yt_team, db_team):
    """Score how well a title's side covers a roster: 0..1.

    Uses the *weakest* roster member's best hit, so a doubles pair must have
    BOTH players named in the title. Taking the max instead let a single shared
    surname (e.g. a stray "Wei"/"Chen") match an unrelated pair — the dominant
    false-positive for doubles.
    """
    if not yt_team or not db_team:
        return 0.0
    return min(
        max((score_player_match(y, d) for y in yt_team), default=0.0)
        for d in db_team
    )


def find_tournament(title, tournaments):
    """Best-matching tournament title for a video title. Returns title or None.

    The tournament's year must appear in the video title: the same event recurs
    every season ("Denmark Open" 2017/2018/...), so name words alone would
    cross-match a clip to the wrong year. A title with no recognizable year can't
    be safely placed, so it matches nothing.
    """
    text_lower = title.lower()
    title_years = set(re.findall(r'\b(20[0-3]\d)\b', title))
    stop_words = {"the", "a", "an", "and", "or", "of", "in", "for", "to", "world", "tour"}
    best_t, best_score = None, 0.0
    for t in tournaments:
        year_m = re.match(r'\s*(\d{4})', t)
        if year_m and year_m.group(1) not in title_years:
            continue
        clean = re.sub(r'^\d{4}\s+', '', t)
        clean = re.sub(r'\s*\(.*?\)\s*$', '', clean).strip().lower()
        words = {w for w in clean.split() if not w.isdigit()} - stop_words
        if not words:
            continue
        score = sum(1 for w in words if w in text_lower) / len(words)
        if clean in text_lower:
            score += 0.5
        if score > best_score:
            best_score, best_t = score, t
    return best_t if best_score >= 0.3 else None


# ============================ IO ============================

def build_match_index(results_paths):
    """Load scraped results into {tournament_title: [match dicts]} keyed by match_key."""
    by_tournament = {}
    for path in results_paths:
        data = json.load(open(path))
        season = data["season"]
        for t in data["tournaments"]:
            tournament = t.get("title") or t.get("page")
            bucket = by_tournament.setdefault(tournament, [])
            for m in t["matches"]:
                section = "/".join(m.get("section_path") or [])
                match_key = f"{season}|{tournament}|{m['discipline']}|{section}|{m['round']}|{m.get('match_idx', 0)}"
                names = lambda team: [
                    (p.get("wiki_name") or p.get("display_name") or "").strip()
                    for p in m[team]["players"] if (p.get("wiki_name") or p.get("display_name"))
                ]
                bucket.append({
                    "match_key": match_key,
                    "discipline": m["discipline"],
                    "round": m["round"],
                    "team1": names("team1"),
                    "team2": names("team2"),
                })
    return by_tournament


def load_video_items(videos_path):
    raw = json.load(open(videos_path))
    items = []
    for v in raw:
        vid = v.get("id")
        title = v.get("title") or ""
        if vid and title:
            items.append((vid, title))
    return items


def main():
    parser = argparse.ArgumentParser(description="Match BWF YouTube videos to scraped matches (offline)")
    parser.add_argument("--videos-file", required=True, help="yt-dlp flat JSON from fetch_bwf_videos.py")
    parser.add_argument("--results", nargs="*", help="Scraped bwf_<year>_results.json (default: auto-glob)")
    parser.add_argument("--out", default="video_matches.json", help="Output mapping file")
    parser.add_argument("--min-score", type=float, default=0.4, help="Minimum match confidence")
    parser.add_argument("--dry-run", action="store_true", help="Print matches, write nothing")
    args = parser.parse_args()

    def resolve(p):
        return p if os.path.isabs(p) else os.path.join(SCRIPT_DIR, p)

    results_paths = [resolve(p) for p in args.results] if args.results else sorted(
        glob.glob(os.path.join(SCRIPT_DIR, "bwf_*_results.json"))
    )
    if not results_paths:
        sys.exit("No results files found (looked for bwf_*_results.json). Run scraper.py first.")

    print("=" * 60)
    print("BWF YouTube Video Matcher (offline)")
    print(f"  Videos:  {args.videos_file}")
    print(f"  Results: {len(results_paths)} file(s)")
    print(f"  Dry run: {args.dry_run}")
    print("=" * 60)

    by_tournament = build_match_index(results_paths)
    tournaments = list(by_tournament.keys())
    total_matches = sum(len(v) for v in by_tournament.values())
    print(f"Indexed {total_matches} matches across {len(tournaments)} tournaments")

    videos = load_video_items(resolve(args.videos_file))
    print(f"Loaded {len(videos)} videos")

    # best video per match_key (schema stores one video per match)
    best_by_match = {}  # match_key -> (confidence, video_id, video_title)
    stats = {"parsed": 0, "tournament": 0, "matched": 0}

    for vid, title in videos:
        parsed = parse_video_title(title)
        if not parsed:
            continue
        stats["parsed"] += 1

        tournament = find_tournament(title, tournaments)
        if not tournament:
            continue
        stats["tournament"] += 1

        best = None  # (score, match_key)
        for match in by_tournament[tournament]:
            s = score_match_parsed(parsed, match)
            if s > args.min_score and (best is None or s > best[0]):
                best = (s, match["match_key"])
        if not best:
            continue
        stats["matched"] += 1

        score, match_key = best
        if match_key not in best_by_match or score > best_by_match[match_key][0]:
            best_by_match[match_key] = (score, vid, title)

    mapping = [
        {"match_key": mk, "video_id": vid, "video_title": vtitle, "confidence": round(score, 4)}
        for mk, (score, vid, vtitle) in best_by_match.items()
    ]
    mapping.sort(key=lambda r: r["match_key"])

    print("\nResults:")
    print(f"  Titles parsed:       {stats['parsed']}")
    print(f"  Tournament matched:  {stats['tournament']}")
    print(f"  Match matched:       {stats['matched']}")
    print(f"  Unique match→video:  {len(mapping)}")

    if args.dry_run:
        for r in mapping[:20]:
            print(f"  [{r['confidence']:.2f}] {r['match_key']}  <-  {r['video_title'][:60]}")
        print("\nDry run — nothing written.")
        return

    out_path = resolve(args.out)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(mapping)} match→video links to {out_path}")


if __name__ == "__main__":
    main()
