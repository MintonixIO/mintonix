/**
 * Pure BWF match-list planning for PostgREST + the in-memory twin.
 * Catalog I/O (service-role fetches) stays in catalog.ts.
 */
import {
  matchInvolvesPlayer,
  parseTournament,
  playerIdBase,
  roundRank,
  tournamentDiscSlot,
} from "./parse";
import type { CatalogMatch, CatalogStats, Disc, MatchFilters } from "./types";
import { DISCS } from "./types";

export type MatchListFilter =
  | { kind: "ilike"; column: string; value: string }
  | { kind: "not_is"; column: string }
  | { kind: "or"; value: string };

export type MatchListPlan = {
  filters: MatchListFilter[];
  order: { column: string; ascending: boolean }[];
  from: number;
  to: number;
  /** Fetch a PostgREST window, then match player ids in JS. */
  overFetch: boolean;
};

export type SqlTournamentCount = {
  tournament: string | null;
  count: number;
};

export type SqlCatalogStats = {
  matches: number;
  players: number;
  with_video: number;
  tournament_strings: SqlTournamentCount[];
};

/** Strip characters that change PostgREST filter parsing or LIKE wildcards. */
export function sanitizeFilterValue(raw: string): string {
  return raw.replace(/[*(),\\"%_]/g, "").trim();
}

/** Loader writes `{title} · {discipline} · {round}`. */
export function tournamentDiscIlike(disc: Disc): string {
  return `% · ${disc} · %`;
}

export function youtubeSourceOrFilter(): string {
  return [
    "source_url.ilike.%youtube.com%",
    "source_url.ilike.%youtu.be%",
    "source_url.ilike.%youtube-nocookie.com%",
  ].join(",");
}

/** Same needles as `youtubeSourceOrFilter` (PostgREST ilike). */
export function sourceUrlMatchesYoutubeFilter(
  sourceUrl: string | null | undefined,
): boolean {
  const s = (sourceUrl ?? "").toLowerCase();
  return (
    s.includes("youtube.com") ||
    s.includes("youtu.be") ||
    s.includes("youtube-nocookie.com")
  );
}

export function rosterSearchOrFilter(needle: string): string {
  const v = sanitizeFilterValue(needle);
  if (!v) return "";
  const like = `"%${v}%"`;
  return [
    `tournament.ilike.${like}`,
    `team1_player1.ilike.${like}`,
    `team1_player2.ilike.${like}`,
    `team2_player1.ilike.${like}`,
    `team2_player2.ilike.${like}`,
  ].join(",");
}

/**
 * LIKE needles (no wrapping %) so SQL is a superset of `matchInvolvesPlayer`.
 * `an-se-young--kor` → `an%se%young` (matches `An Se-young`) and `an-se-young`.
 */
export function playerRosterLikeNeedles(playerId: string): string[] {
  const base = playerIdBase(playerId);
  if (!base) return [];
  const tokens = base
    .split("-")
    .map((t) => sanitizeFilterValue(t))
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const between = tokens.join("%");
  const hyphen = tokens.join("-");
  return between === hyphen ? [between] : [between, hyphen];
}

export function playerRosterOrFilter(playerId: string): string {
  const needles = playerRosterLikeNeedles(playerId);
  if (!needles.length) return "";
  const cols = [
    "team1_player1",
    "team1_player2",
    "team2_player1",
    "team2_player2",
  ];
  const parts: string[] = [];
  for (const col of cols) {
    for (const n of needles) {
      parts.push(`${col}.ilike."%${n}%"`);
    }
  }
  return parts.join(",");
}

const PAGE_CAP = 100;
const DEFAULT_PAGE = 24;
/** Hard cap: player-id lists must not page the full catalog dump. */
export const PLAYER_OVERFETCH_LIMIT = 1000;

export function planMatchList(filters: MatchFilters = {}): MatchListPlan {
  const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE, 1), PAGE_CAP);
  const page = Math.max(filters.page ?? 1, 1);
  const player = filters.player?.trim() ?? "";
  const overFetch = Boolean(player);
  const from = overFetch ? 0 : (page - 1) * pageSize;
  const to = overFetch ? PLAYER_OVERFETCH_LIMIT - 1 : from + pageSize - 1;

  const out: MatchListFilter[] = [];

  const disc = filters.disc && filters.disc !== "all" ? filters.disc : null;
  if (disc) {
    out.push({
      kind: "ilike",
      column: "tournament",
      value: tournamentDiscIlike(disc),
    });
  }

  const year =
    filters.year && filters.year !== "all" ? Number(filters.year) : null;
  if (year != null && !Number.isNaN(year)) {
    out.push({
      kind: "ilike",
      column: "tournament",
      value: `%${year}%`,
    });
  }

  const event = sanitizeFilterValue(filters.event ?? "");
  if (event) {
    out.push({ kind: "ilike", column: "tournament", value: `%${event}%` });
  }

  const round = sanitizeFilterValue(filters.round ?? "");
  if (round) {
    out.push({ kind: "ilike", column: "tournament", value: `% · ${round}%` });
  }

  const q = sanitizeFilterValue(filters.q ?? "");
  if (q) {
    const or = rosterSearchOrFilter(q);
    if (or) out.push({ kind: "or", value: or });
  }

  if (filters.hasVideo) {
    out.push({ kind: "or", value: youtubeSourceOrFilter() });
  }

  if (filters.threeGames) {
    out.push({ kind: "not_is", column: "g3_t1" });
    out.push({ kind: "not_is", column: "g3_t2" });
  }

  if (filters.comeback) {
    out.push({ kind: "not_is", column: "g3_t1" });
    out.push({ kind: "not_is", column: "g3_t2" });
    out.push({
      kind: "or",
      value:
        "and(g1_t1.gt.g1_t2,winner_side.eq.2),and(g1_t2.gt.g1_t1,winner_side.eq.1)",
    });
  }

  if (player) {
    const or = playerRosterOrFilter(player);
    if (or) out.push({ kind: "or", value: or });
  }

  let order: { column: string; ascending: boolean }[];
  switch (filters.sort) {
    case "created":
      order = [{ column: "created_at", ascending: false }];
      break;
    case "status":
      order = [
        { column: "status", ascending: true },
        { column: "match_date", ascending: false },
      ];
      break;
    case "round":
    case "event":
    default:
      order = [
        { column: "match_date", ascending: false },
        { column: "tournament", ascending: true },
      ];
      break;
  }

  return { filters: out, order, from, to, overFetch };
}

function containsIlike(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** `%foo%` / `% · MS · %` PostgREST values → unwrapped needle. */
function ilikeNeedle(value: string): string {
  return value.replace(/^%/, "").replace(/%$/, "");
}

/** Mapped equivalent of SQL `g3_t1` and `g3_t2` both present. */
function hasThirdGame(m: CatalogMatch): boolean {
  return m.games.length >= 3;
}

/** Mapped equivalent of SQL g3 + game-1 loser vs winner_side. */
function isListComeback(m: CatalogMatch): boolean {
  if (!hasThirdGame(m) || m.winner == null) return false;
  const g1 = m.games[0];
  const g1Winner: 1 | 2 | null =
    g1.t1 > g1.t2 ? 1 : g1.t2 > g1.t1 ? 2 : null;
  return g1Winner != null && g1Winner !== m.winner;
}

function matchPassesListFilters(
  m: CatalogMatch,
  filters: MatchFilters,
): boolean {
  const disc = filters.disc && filters.disc !== "all" ? filters.disc : null;
  if (disc && !containsIlike(m.tournamentRaw, ilikeNeedle(tournamentDiscIlike(disc)))) {
    return false;
  }

  const year =
    filters.year && filters.year !== "all" ? Number(filters.year) : null;
  if (year != null && !Number.isNaN(year) && !containsIlike(m.tournamentRaw, String(year))) {
    return false;
  }

  const event = sanitizeFilterValue(filters.event ?? "");
  if (event && !containsIlike(m.tournamentRaw, event)) return false;

  const round = sanitizeFilterValue(filters.round ?? "");
  if (round && !containsIlike(m.tournamentRaw, ` · ${round}`)) return false;

  const q = sanitizeFilterValue(filters.q ?? "");
  if (q) {
    const fields = [m.tournamentRaw, ...m.team1, ...m.team2];
    if (!fields.some((f) => containsIlike(f, q))) return false;
  }

  if (filters.hasVideo && !sourceUrlMatchesYoutubeFilter(m.sourceUrl)) {
    return false;
  }
  if (filters.threeGames && !hasThirdGame(m)) return false;
  if (filters.comeback && !isListComeback(m)) return false;
  if (filters.player && !matchInvolvesPlayer(m, filters.player)) return false;
  return true;
}

function cmpIsoDateDesc(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
}

/** PostgREST list order (`planMatchList.order`) — not aggregation `sortMatches`. */
export function orderMatchList(
  list: CatalogMatch[],
  sort: MatchFilters["sort"] = "event",
): CatalogMatch[] {
  const copy = list.slice();
  switch (sort) {
    case "created":
      return copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case "status":
      return copy.sort((a, b) => {
        const s = a.status.localeCompare(b.status);
        if (s !== 0) return s;
        return cmpIsoDateDesc(a.matchDate, b.matchDate);
      });
    case "round":
    case "event":
    default:
      return copy.sort((a, b) => {
        const d = cmpIsoDateDesc(a.matchDate, b.matchDate);
        if (d !== 0) return d;
        return a.tournamentRaw.localeCompare(b.tournamentRaw);
      });
  }
}

/**
 * In-memory match list using the same filters/order as `planMatchList`.
 * Player id uses `matchInvolvesPlayer` (live path post-filters the same way).
 */
export function filterMatchList(
  matches: CatalogMatch[],
  filters: MatchFilters = {},
): CatalogMatch[] {
  return orderMatchList(
    matches.filter((m) => matchPassesListFilters(m, filters)),
    filters.sort ?? "event",
  );
}

export function catalogStatsFromSql(row: SqlCatalogStats): CatalogStats {
  if (!Array.isArray(row.tournament_strings)) {
    throw new Error("BWF catalog stats missing tournament_strings");
  }

  const byDisc = Object.fromEntries(DISCS.map((d) => [d, 0])) as Record<
    Disc,
    number
  >;
  const eventMap = new Map<
    string,
    { event: string; year: number | null; count: number }
  >();
  const roundSet = new Set<string>();
  const yearSet = new Set<number>();

  for (const item of row.tournament_strings) {
    const raw = (item?.tournament ?? "").trim();
    if (!raw) continue;
    const n = Number(item.count);
    const count = Number.isFinite(n) ? n : 0;
    const parsed = parseTournament(raw);
    const disc = tournamentDiscSlot(raw);
    if (disc) byDisc[disc] += count;
    if (parsed.round) roundSet.add(parsed.round);
    // Year facets come from the event title, not match_date.
    if (parsed.year) yearSet.add(parsed.year);
    const prev = eventMap.get(parsed.event);
    if (prev) prev.count += count;
    else {
      eventMap.set(parsed.event, {
        event: parsed.event,
        year: parsed.year,
        count,
      });
    }
  }

  const events = [...eventMap.values()].sort((a, b) => b.count - a.count);
  const rounds = [...roundSet].sort(
    (a, b) => roundRank(b) - roundRank(a) || a.localeCompare(b),
  );
  const years = [...yearSet].sort((a, b) => b - a);
  return {
    matches: row.matches,
    players: row.players,
    tournaments: eventMap.size,
    withVideo: row.with_video,
    byDisc,
    events,
    rounds,
    years,
  };
}
