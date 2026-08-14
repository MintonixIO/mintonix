import type {
  CatalogMatch,
  Disc,
  GameScore,
  MatchStatus,
} from "./types";
import { DISCS } from "./types";

const DISC_SET = new Set<string>(DISCS);

const GENERIC_PAREN = new Set(["badminton", "player", "badminton player"]);

const COUNTRY_ALIASES: Record<string, string> = {
  prc: "chn",
  china: "chn",
  chinesetaipei: "tpe",
  taiwan: "tpe",
  korea: "kor",
  southkorea: "kor",
  rok: "kor",
  denmark: "den",
  indonesia: "ina",
  malaysia: "mas",
  japan: "jpn",
  thailand: "tha",
  india: "ind",
  england: "eng",
  singapore: "sgp",
  unitedstates: "usa",
  france: "fra",
  germany: "ger",
  hongkong: "hkg",
};

/** Same-person spelling variants. Must stay aligned with ratings.py. */
const NAME_ALIASES: Record<string, string> = {
  "wang yilu": "wang yilyu",
  "wang yilyu": "wang yilyu",
  "an se young": "an se-young",
  "an seyoung": "an se-young",
  "an se yeong": "an se-young",
  "an se-yeong": "an se-young",
  "an se-young": "an se-young",
};

/** Strip only generic wiki suffixes; keep (born 1980) so homonyms stay split. */
export function cleanPlayerName(raw: string | null | undefined): string {
  if (!raw) return "";
  const rewritten = raw.replace(/_/g, " ").replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const parts = inner
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const keep = parts.filter((p) => !GENERIC_PAREN.has(p.toLowerCase()));
    return keep.length ? ` (${keep.join(", ")})` : " ";
  });
  return rewritten.replace(/\s+/g, " ").trim();
}

export function normalizeCountry(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return COUNTRY_ALIASES[s] || s;
}

/** Ratings / URL key fragment (no country). Mirrors ratings.normalize_name. */
export function normalizePlayerKey(raw: string | null | undefined): string {
  const cleaned = cleanPlayerName(raw);
  if (!cleaned) return "";
  const key = cleaned
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[key] ?? key;
}

/**
 * Stable URL-safe id from a player display name + optional country.
 * Homonyms with different countries get distinct ids (`chen-yu--chn`).
 * Returns empty string for blank/unusable names.
 */
export function playerIdFromName(
  name: string,
  country?: string | null,
): string {
  const key = normalizePlayerKey(name);
  if (!key) return "";
  let slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cc = normalizeCountry(country ?? "");
  if (cc) slug = `${slug}--${cc}`;
  return slug.slice(0, 80);
}

/** Name slug without the `--cc` country suffix (`chen-yu--chn` → `chen-yu`). */
export function playerIdBase(id: string): string {
  const i = id.lastIndexOf("--");
  if (i <= 0) return id;
  const maybeCc = id.slice(i + 2);
  if (/^[a-z0-9]{2,4}$/.test(maybeCc)) return id.slice(0, i);
  return id;
}

/** Country fragment of a player id, or null. */
export function playerIdCountry(id: string): string | null {
  const i = id.lastIndexOf("--");
  if (i <= 0) return null;
  const maybeCc = id.slice(i + 2);
  return /^[a-z0-9]{2,4}$/.test(maybeCc) ? maybeCc : null;
}

export function formatCountry(cc: string | null | undefined): string {
  if (!cc) return "";
  return cc.toUpperCase();
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
  team1_player1_country?: string | null;
  team1_player2_country?: string | null;
  team2_player1_country?: string | null;
  team2_player2_country?: string | null;
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

function rosterWithIds(
  names: string[],
  countries: (string | null | undefined)[] = [],
): { names: string[]; ids: string[]; countries: (string | null)[] } {
  const outNames: string[] = [];
  const ids: string[] = [];
  const outCc: (string | null)[] = [];
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    const cc = countries[i] ?? null;
    const id = playerIdFromName(n, cc);
    if (!id) continue;
    outNames.push(n);
    ids.push(id);
    outCc.push(cc ? normalizeCountry(cc) : null);
  }
  return { names: outNames, ids, countries: outCc };
}

export function mapDbMatch(row: DbMatchRow): CatalogMatch {
  const parsed = parseTournament(row.tournament);
  const t1 = rosterWithIds(teamNames(row.team1_player1, row.team1_player2), [
    row.team1_player1_country,
    row.team1_player2_country,
  ]);
  const t2 = rosterWithIds(teamNames(row.team2_player1, row.team2_player2), [
    row.team2_player1_country,
    row.team2_player2_country,
  ]);
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
    team1Countries: t1.countries,
    team2Countries: t2.countries,
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
      if (m.year) return `${m.year} · event year`;
      return "Date unknown";
    }
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (m.year) return `${m.year} · event year`;
  return "Date unknown";
}
