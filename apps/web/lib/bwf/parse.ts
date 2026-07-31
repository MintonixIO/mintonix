import type {
  CatalogMatch,
  Disc,
  GameScore,
  MatchStatus,
} from "./types";
import { DISCS } from "./types";

const DISC_SET = new Set<string>(DISCS);

/** Strip Wikipedia-style disambiguators: `Brian Yang (badminton)`. */
export function cleanPlayerName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\s*\([^)]*badminton[^)]*\)\s*/gi, " ")
    .replace(/\s*\(\d{4}[^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable URL-safe id from a player display name.
 * Returns empty string for blank/unusable names — callers must skip those
 * (do not mint a synthetic "unknown" player).
 */
export function playerIdFromName(name: string): string {
  const cleaned = cleanPlayerName(name);
  if (!cleaned) return "";
  return cleaned
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Clean event titles: `2026 Swiss Open (badminton)` → `2026 Swiss Open`. */
export function cleanEventName(raw: string): string {
  return raw
    .replace(/\s*\(badminton\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Loader writes `tournament` as `{title} · {discipline} · {round}`
 * (see workers/github/match-data/schema.md).
 */
export function parseTournament(raw: string | null | undefined): {
  event: string;
  year: number | null;
  disc: Disc | null;
  round: string;
} {
  const text = (raw || "").trim();
  if (!text) {
    return { event: "Unknown event", year: null, disc: null, round: "" };
  }
  const parts = text.split(/\s*·\s*/).map((p) => p.trim());
  const event = cleanEventName(parts[0] || text);
  let disc: Disc | null = null;
  let round = "";

  if (parts.length >= 3) {
    const mid = parts[1]?.toUpperCase();
    if (mid && DISC_SET.has(mid)) {
      disc = mid as Disc;
      round = parts.slice(2).join(" · ");
    } else {
      round = parts.slice(1).join(" · ");
    }
  } else if (parts.length === 2) {
    const mid = parts[1]?.toUpperCase();
    if (mid && DISC_SET.has(mid)) disc = mid as Disc;
    else round = parts[1] || "";
  }

  // Fallback: scan for discipline token anywhere.
  if (!disc) {
    for (const d of DISCS) {
      if (new RegExp(`\\b${d}\\b`).test(text)) {
        disc = d;
        break;
      }
    }
  }

  const yearMatch = event.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  return { event, year, disc, round };
}

export function teamNames(
  p1: string | null | undefined,
  p2: string | null | undefined,
): string[] {
  const names = [cleanPlayerName(p1), cleanPlayerName(p2)].filter(Boolean);
  return names;
}

export function formatTeam(names: string[]): string {
  if (names.length === 0) return "TBD";
  if (names.length === 1) return names[0];
  return names.join(" / ");
}

export function computeGames(row: {
  g1_t1: number | null;
  g1_t2: number | null;
  g2_t1: number | null;
  g2_t2: number | null;
  g3_t1: number | null;
  g3_t2: number | null;
}): GameScore[] {
  const games: GameScore[] = [];
  const pairs: [number | null, number | null][] = [
    [row.g1_t1, row.g1_t2],
    [row.g2_t1, row.g2_t2],
    [row.g3_t1, row.g3_t2],
  ];
  for (const [a, b] of pairs) {
    if (a == null || b == null) continue;
    games.push({ t1: a, t2: b });
  }
  return games;
}

/**
 * Best-of-3 winner: first to 2 game wins.
 * Incomplete series (0–0, 1–0, 1–1) → null until someone reaches 2.
 */
export function computeWinner(games: GameScore[]): 1 | 2 | null {
  let w1 = 0;
  let w2 = 0;
  for (const g of games) {
    if (g.t1 > g.t2) w1 += 1;
    else if (g.t2 > g.t1) w2 += 1;
  }
  if (w1 >= 2 && w1 > w2) return 1;
  if (w2 >= 2 && w2 > w1) return 2;
  return null;
}

export function isComeback(games: GameScore[], winner: 1 | 2 | null): boolean {
  if (!winner || games.length < 2) return false;
  const g1 = games[0];
  const g1Winner: 1 | 2 | null =
    g1.t1 > g1.t2 ? 1 : g1.t2 > g1.t1 ? 2 : null;
  return g1Winner != null && g1Winner !== winner && games.length === 3;
}

export function formatScoreLine(games: GameScore[]): string {
  if (!games.length) return "—";
  return games.map((g) => `${g.t1}–${g.t2}`).join(", ");
}

export function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ROUND_RANK: Record<string, number> = {
  final: 100,
  "bronze medal": 95,
  "3rd/4th place": 94,
  semifinal: 90,
  "semi-final": 90,
  "semi final": 90,
  quarterfinal: 80,
  "quarter-final": 80,
  "quarter final": 80,
  "round of 16": 70,
  "third round": 60,
  "second round": 50,
  "first round": 40,
  "group stage": 30,
  "group play": 30,
};

export function roundRank(round: string): number {
  const key = round.trim().toLowerCase();
  if (ROUND_RANK[key] != null) return ROUND_RANK[key];
  for (const [k, v] of Object.entries(ROUND_RANK)) {
    if (key.includes(k)) return v;
  }
  return 10;
}

export type DbMatchRow = {
  id: string;
  tournament: string | null;
  match_date: string | null;
  team1_player1: string | null;
  team1_player2: string | null;
  team2_player1: string | null;
  team2_player2: string | null;
  g1_t1: number | null;
  g1_t2: number | null;
  g2_t1: number | null;
  g2_t2: number | null;
  g3_t1: number | null;
  g3_t2: number | null;
  status: string;
  source_url: string | null;
  duration_sec: number | null;
  created_at: string;
};

function rosterWithIds(names: string[]): { names: string[]; ids: string[] } {
  const outNames: string[] = [];
  const ids: string[] = [];
  for (const n of names) {
    const id = playerIdFromName(n);
    if (!id) continue;
    outNames.push(n);
    ids.push(id);
  }
  return { names: outNames, ids };
}

export function mapDbMatch(row: DbMatchRow): CatalogMatch {
  const parsed = parseTournament(row.tournament);
  const t1 = rosterWithIds(teamNames(row.team1_player1, row.team1_player2));
  const t2 = rosterWithIds(teamNames(row.team2_player1, row.team2_player2));
  const games = computeGames(row);
  const winner = computeWinner(games);
  const status = (
    ["pending", "processing", "ready", "failed"].includes(row.status)
      ? row.status
      : "pending"
  ) as MatchStatus;

  return {
    id: row.id,
    tournamentRaw: row.tournament || "",
    event: parsed.event,
    year: parsed.year,
    disc: parsed.disc,
    round: parsed.round,
    matchDate: row.match_date,
    team1: t1.names,
    team2: t2.names,
    team1Ids: t1.ids,
    team2Ids: t2.ids,
    games,
    winner,
    threeGames: games.length === 3,
    comeback: isComeback(games, winner),
    status,
    sourceUrl: row.source_url,
    durationSec: row.duration_sec,
    createdAt: row.created_at,
  };
}

export function matchInvolvesPlayer(m: CatalogMatch, playerId: string): boolean {
  return m.team1Ids.includes(playerId) || m.team2Ids.includes(playerId);
}

export function playerWon(m: CatalogMatch, playerId: string): boolean | null {
  if (m.winner == null) return null;
  const on1 = m.team1Ids.includes(playerId);
  const on2 = m.team2Ids.includes(playerId);
  if (!on1 && !on2) return null;
  return (on1 && m.winner === 1) || (on2 && m.winner === 2);
}

export function opponentNames(m: CatalogMatch, playerId: string): string[] {
  if (m.team1Ids.includes(playerId)) return m.team2;
  if (m.team2Ids.includes(playerId)) return m.team1;
  return [];
}

export function displayDate(m: CatalogMatch): string {
  if (m.matchDate) {
    const d = new Date(m.matchDate + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) {
      // Invalid calendar date — fall through rather than printing "Invalid Date".
      if (m.year) return String(m.year);
      return "";
    }
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (m.year) return String(m.year);
  return "";
}
