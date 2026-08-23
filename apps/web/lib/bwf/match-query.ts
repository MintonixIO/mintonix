/**
 * Pure BWF match-list planning for PostgREST.
 * Catalog I/O (service-role fetches) stays in catalog.ts.
 */
import { playerIdBase, roundRank } from "./parse";
import type { CatalogStats, Disc, MatchFilters } from "./types";
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
  /** Fetch a full PostgREST page, then match player ids in JS. */
  overFetch: boolean;
};

export type SqlCatalogStats = {
  matches: number;
  players: number;
  tournaments: number;
  with_video: number;
  by_disc: Partial<Record<Disc, number>>;
  events?: { event: string; year: number | null; count: number }[];
  rounds?: string[];
  years?: number[];
};

/** Strip characters that change PostgREST filter parsing. */
export function sanitizeFilterValue(raw: string): string {
  return raw.replace(/[*(),\\]/g, "").trim();
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

export function playerRosterOrFilter(playerId: string): string {
  const base = playerIdBase(playerId).replace(/-/g, " ").trim();
  if (!base) return "";
  const like = `"%${sanitizeFilterValue(base)}%"`;
  return [
    `team1_player1.ilike.${like}`,
    `team1_player2.ilike.${like}`,
    `team2_player1.ilike.${like}`,
    `team2_player2.ilike.${like}`,
  ].join(",");
}

/** Third game present and game-1 winner ≠ match winner (winner_side). */
export function comebackAndFilter(): string {
  return [
    "g3_t1.not.is.null",
    "g3_t2.not.is.null",
    "or(and(g1_t1.gt.g1_t2,winner_side.eq.2),and(g1_t2.gt.g1_t1,winner_side.eq.1))",
  ].join(",");
}

export function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const PAGE_CAP = 100;
const DEFAULT_PAGE = 24;
const OVERFETCH_TO = 999;

export function planMatchList(filters: MatchFilters = {}): MatchListPlan {
  const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE, 1), PAGE_CAP);
  const page = Math.max(filters.page ?? 1, 1);
  const player = filters.player?.trim() ?? "";
  const overFetch = Boolean(player);
  const from = overFetch ? 0 : (page - 1) * pageSize;
  const to = overFetch ? OVERFETCH_TO : from + pageSize - 1;

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

export function catalogStatsFromSql(row: SqlCatalogStats): CatalogStats {
  const byDisc = Object.fromEntries(
    DISCS.map((d) => [d, row.by_disc[d] ?? 0]),
  ) as Record<Disc, number>;
  const events = [...(row.events ?? [])].sort((a, b) => b.count - a.count);
  const rounds = [...new Set((row.rounds ?? []).filter(Boolean))].sort(
    (a, b) => roundRank(b) - roundRank(a) || a.localeCompare(b),
  );
  const years = [...new Set(row.years ?? [])].sort((a, b) => b - a);
  return {
    matches: row.matches,
    players: row.players,
    tournaments: row.tournaments,
    withVideo: row.with_video,
    byDisc,
    events,
    rounds,
    years,
  };
}
