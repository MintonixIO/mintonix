/**
 * Pure BWF catalog helpers — no Next.js / Supabase imports.
 * Safe for unit tests and for use from server catalog loaders.
 */
import {
  formatTeam,
  playerWon,
  roundRank,
} from "./parse";
import { playerImageUrl } from "./player-image";
import { isAllowlistedYoutubeUrl } from "./youtube";
import type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  DirectoryPlayer,
  Disc,
  MatchFilters,
  MatchStatus,
  SearchHit,
} from "./types";
import { BWF_SEARCH_LIMIT, BWF_SEARCH_MAX_Q, DISCS } from "./types";

export function sortMatches(
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
    case "status": {
      const rank: Record<MatchStatus, number> = {
        ready: 0,
        processing: 1,
        pending: 2,
        failed: 3,
      };
      return copy.sort((a, b) => rank[a.status] - rank[b.status]);
    }
    case "round":
      return copy.sort((a, b) => {
        const r = roundRank(b.round) - roundRank(a.round);
        if (r !== 0) return r;
        return a.event.localeCompare(b.event);
      });
    case "event":
    default:
      return copy.sort((a, b) => {
        const y = (b.year ?? 0) - (a.year ?? 0);
        if (y !== 0) return y;
        const e = a.event.localeCompare(b.event);
        if (e !== 0) return e;
        const r = roundRank(b.round) - roundRank(a.round);
        if (r !== 0) return r;
        return formatTeam(a.team1).localeCompare(formatTeam(b.team1));
      });
  }
}

/**
 * Chronology ms for form / recent-order sorts.
 * Prefer valid matchDate; fall back to createdAt when missing or invalid.
 */
export function matchChronologyMs(m: CatalogMatch): number {
  if (m.matchDate) {
    const t = new Date(m.matchDate + "T00:00:00Z").getTime();
    if (!Number.isNaN(t)) return t;
  }
  const c = new Date(m.createdAt).getTime();
  return Number.isNaN(c) ? 0 : c;
}

/** Prefer match_date, else created_at (for form chronology). */
export function formSortMatches(list: CatalogMatch[]): CatalogMatch[] {
  return list
    .slice()
    .sort((a, b) => matchChronologyMs(b) - matchChronologyMs(a));
}

export function filterMatches(
  matches: CatalogMatch[],
  filters: MatchFilters = {},
): CatalogMatch[] {
  const q = filters.q?.trim().toLowerCase() ?? "";
  const disc = filters.disc && filters.disc !== "all" ? filters.disc : null;
  const event = filters.event?.trim().toLowerCase() ?? "";
  const round = filters.round?.trim().toLowerCase() ?? "";
  const year =
    filters.year && filters.year !== "all" ? Number(filters.year) : null;

  let list = matches.filter((m) => {
    if (disc && m.disc !== disc) return false;
    if (year != null && !Number.isNaN(year) && m.year !== year) return false;
    if (event && !m.event.toLowerCase().includes(event)) return false;
    if (round && m.round.toLowerCase() !== round) return false;
    if (filters.hasVideo && !isAllowlistedYoutubeUrl(m.sourceUrl)) return false;
    if (filters.threeGames && !m.threeGames) return false;
    if (filters.comeback && !m.comeback) return false;
    if (q) {
      const hay = [
        ...m.team1,
        ...m.team2,
        m.event,
        m.round,
        m.disc ?? "",
        m.tournamentRaw,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list = sortMatches(list, filters.sort ?? "event");
  return list;
}

export function paginateMatches(
  matches: CatalogMatch[],
  page = 1,
  pageSize = 24,
): {
  matches: CatalogMatch[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const size = Math.min(Math.max(pageSize, 1), 100);
  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / size) || 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    matches: matches.slice(start, start + size),
    total,
    page: safePage,
    pageSize: size,
    totalPages,
  };
}

export function winRateFromRecord(wins: number, losses: number): number {
  const decided = wins + losses;
  if (decided <= 0) return 0;
  return Math.round((wins / decided) * 1000) / 10;
}

/** Opposite-side meetings only (excludes doubles partners on the same team). */
export function isH2hMeeting(
  m: CatalogMatch,
  aId: string,
  bId: string,
): boolean {
  if (!aId || !bId || aId === bId) return false;
  const aOn1 = m.team1Ids.includes(aId);
  const aOn2 = m.team2Ids.includes(aId);
  const bOn1 = m.team1Ids.includes(bId);
  const bOn2 = m.team2Ids.includes(bId);
  return (aOn1 && bOn2) || (aOn2 && bOn1);
}

export function h2hFromMatches(
  matches: CatalogMatch[],
  aId: string,
  bId: string,
): { meetings: CatalogMatch[]; aWins: number; bWins: number } {
  const meetings = sortMatches(
    matches.filter((m) => isH2hMeeting(m, aId, bId)),
    "event",
  );
  let aWins = 0;
  let bWins = 0;
  for (const m of meetings) {
    const aw = playerWon(m, aId);
    if (aw === true) aWins += 1;
    else if (aw === false) bWins += 1;
  }
  return { meetings, aWins, bWins };
}

type MutablePlayer = {
  id: string;
  name: string;
  discCounts: Map<Disc, number>;
  matches: number;
  wins: number;
  losses: number;
  threeGames: number;
  withVideo: number;
  form: ("W" | "L")[];
  rivalMap: Map<
    string,
    { id: string; name: string; meetings: number; wins: number }
  >;
};

function emptyPlayer(id: string, name: string): MutablePlayer {
  return {
    id,
    name,
    discCounts: new Map(),
    matches: 0,
    wins: 0,
    losses: 0,
    threeGames: 0,
    withVideo: 0,
    form: [],
    rivalMap: new Map(),
  };
}

function finalizePlayer(p: MutablePlayer): CatalogPlayer {
  let primary: Disc | null = null;
  let best = 0;
  const discs: Disc[] = [];
  for (const [d, n] of p.discCounts) {
    discs.push(d);
    if (n > best) {
      best = n;
      primary = d;
    }
  }
  discs.sort();
  const rivals = [...p.rivalMap.values()]
    .sort((a, b) => b.meetings - a.meetings || b.wins - a.wins)
    .slice(0, 8);

  return {
    id: p.id,
    name: p.name,
    disc: primary,
    discs,
    matches: p.matches,
    wins: p.wins,
    losses: p.losses,
    winRate: winRateFromRecord(p.wins, p.losses),
    threeGames: p.threeGames,
    withVideo: p.withVideo,
    form: p.form.slice(0, 10),
    rivals,
    imageUrl: playerImageUrl(p.id, p.name),
  };
}

export function toDirectoryPlayer(p: CatalogPlayer): DirectoryPlayer {
  return {
    id: p.id,
    name: p.name,
    disc: p.disc,
    discs: p.discs,
    matches: p.matches,
    wins: p.wins,
    losses: p.losses,
    winRate: p.winRate,
    threeGames: p.threeGames,
    withVideo: p.withVideo,
    imageUrl: p.imageUrl,
  };
}

export function aggregatePlayers(matches: CatalogMatch[]): CatalogPlayer[] {
  // Form prefers true chronology when match_date exists.
  const forForm = formSortMatches(matches);
  const byId = new Map<string, MutablePlayer>();

  const touch = (id: string, name: string) => {
    if (!id || !name) return null;
    let p = byId.get(id);
    if (!p) {
      p = emptyPlayer(id, name);
      byId.set(id, p);
    } else if (name.length > p.name.length) {
      p.name = name;
    }
    return p;
  };

  // Stats / rivals from event order.
  for (const m of sortMatches(matches, "event")) {
    const sides: { ids: string[]; names: string[]; side: 1 | 2 }[] = [
      { ids: m.team1Ids, names: m.team1, side: 1 },
      { ids: m.team2Ids, names: m.team2, side: 2 },
    ];
    for (const side of sides) {
      for (let i = 0; i < side.ids.length; i++) {
        const id = side.ids[i];
        const name = side.names[i];
        if (!id || !name) continue;
        const p = touch(id, name);
        if (!p) continue;
        p.matches += 1;
        if (m.disc)
          p.discCounts.set(m.disc, (p.discCounts.get(m.disc) ?? 0) + 1);
        if (m.threeGames) p.threeGames += 1;
        if (isAllowlistedYoutubeUrl(m.sourceUrl)) p.withVideo += 1;
        const won = playerWon(m, id);
        if (won === true) p.wins += 1;
        else if (won === false) p.losses += 1;

        const oppSide = side.side === 1 ? sides[1] : sides[0];
        for (let j = 0; j < oppSide.ids.length; j++) {
          const oid = oppSide.ids[j];
          const oname = oppSide.names[j];
          if (!oid || !oname) continue;
          let r = p.rivalMap.get(oid);
          if (!r) {
            r = { id: oid, name: oname, meetings: 0, wins: 0 };
            p.rivalMap.set(oid, r);
          }
          r.meetings += 1;
          if (won === true) r.wins += 1;
        }
      }
    }
  }

  // Form: chronology (matchDate then createdAt), newest first.
  for (const m of forForm) {
    for (const side of [
      { ids: m.team1Ids, names: m.team1 },
      { ids: m.team2Ids, names: m.team2 },
    ]) {
      for (let i = 0; i < side.ids.length; i++) {
        const id = side.ids[i];
        const p = byId.get(id);
        if (!p) continue;
        if (p.form.length >= 10) continue;
        const won = playerWon(m, id);
        if (won === true) p.form.push("W");
        else if (won === false) p.form.push("L");
      }
    }
  }

  return [...byId.values()]
    .map(finalizePlayer)
    .sort((a, b) => b.matches - a.matches || b.winRate - a.winRate);
}

export function buildCatalogStats(
  matches: CatalogMatch[],
  players: { length: number },
): CatalogStats {
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
  let withVideo = 0;

  for (const m of matches) {
    if (m.disc) byDisc[m.disc] = (byDisc[m.disc] ?? 0) + 1;
    if (isAllowlistedYoutubeUrl(m.sourceUrl)) withVideo += 1;
    if (m.round) roundSet.add(m.round);
    if (m.year) yearSet.add(m.year);
    const prev = eventMap.get(m.event);
    if (prev) prev.count += 1;
    else eventMap.set(m.event, { event: m.event, year: m.year, count: 1 });
  }

  return {
    matches: matches.length,
    players: players.length,
    tournaments: eventMap.size,
    withVideo,
    byDisc,
    events: [...eventMap.values()].sort((a, b) => b.count - a.count),
    rounds: [...roundSet].sort(
      (a, b) => roundRank(b) - roundRank(a) || a.localeCompare(b),
    ),
    years: [...yearSet].sort((a, b) => b - a),
  };
}

type SearchPlayer = Pick<
  CatalogPlayer,
  "id" | "name" | "matches" | "winRate" | "disc"
>;

/** Shared hit shape for live search + static shell index (same sub format). */
export function playerSearchHit(p: SearchPlayer): SearchHit {
  return {
    kind: "Player",
    id: p.id,
    label: p.name,
    sub: `${p.matches} matches · ${p.winRate}% win${p.disc ? ` · ${p.disc}` : ""}`,
    href: `/bwf/players/${p.id}`,
  };
}

export function eventSearchHit(e: {
  event: string;
  count: number;
}): SearchHit {
  return {
    kind: "Tournament",
    id: e.event,
    label: e.event,
    sub: `${e.count} matches`,
    href: `/bwf/matches?event=${encodeURIComponent(e.event)}`,
  };
}

export function matchSearchHit(m: CatalogMatch): SearchHit {
  return {
    kind: "Match",
    id: m.id,
    label: `${formatTeam(m.team1)} vs ${formatTeam(m.team2)}`,
    sub: `${m.event}${m.round ? ` · ${m.round}` : ""}${m.disc ? ` · ${m.disc}` : ""}`,
    href: `/bwf/matches/${m.id}`,
  };
}

/**
 * Live typeahead search hits with per-kind slot budgets so one kind cannot
 * starve others (default: up to 3 players / 2 events / 3 matches, then fill).
 */
export function buildSearchHits(
  queryRaw: string,
  players: SearchPlayer[],
  matches: CatalogMatch[],
  stats: CatalogStats,
  limit = BWF_SEARCH_LIMIT,
): SearchHit[] {
  const query = queryRaw.trim().toLowerCase().slice(0, BWF_SEARCH_MAX_Q);
  if (!query || limit <= 0) return [];

  const playerBudget = Math.min(3, limit);
  const eventBudget = Math.min(2, limit);
  const matchBudget = Math.min(3, limit);

  const playerHits: SearchHit[] = players
    .filter((p) => p.name.toLowerCase().includes(query))
    .slice(0, Math.max(playerBudget, limit))
    .map(playerSearchHit);

  const eventHits: SearchHit[] = stats.events
    .filter((e) => e.event.toLowerCase().includes(query))
    .slice(0, Math.max(eventBudget, limit))
    .map(eventSearchHit);

  const matchHits: SearchHit[] = filterMatches(matches, { q: query })
    .slice(0, Math.max(matchBudget, limit))
    .map(matchSearchHit);

  const primary = [
    ...playerHits.slice(0, playerBudget),
    ...eventHits.slice(0, eventBudget),
    ...matchHits.slice(0, matchBudget),
  ];
  if (primary.length >= limit) return primary.slice(0, limit);

  const used = new Set(primary.map((h) => `${h.kind}:${h.id}`));
  const remainder: SearchHit[] = [];
  for (const h of [...playerHits, ...eventHits, ...matchHits]) {
    const key = `${h.kind}:${h.id}`;
    if (used.has(key)) continue;
    used.add(key);
    remainder.push(h);
  }
  return [...primary, ...remainder].slice(0, limit);
}

/**
 * Static shell search index (no query filter): top players + tournaments.
 * Shared by layout so hit construction stays consistent with search API shape.
 */
export function buildStaticSearchIndex(
  players: SearchPlayer[],
  stats: CatalogStats,
  opts?: { playerLimit?: number; eventLimit?: number },
): SearchHit[] {
  const playerLimit = opts?.playerLimit ?? 80;
  const eventLimit = opts?.eventLimit ?? 40;

  const playerHits = players.slice(0, playerLimit).map(playerSearchHit);
  const eventHits = stats.events.slice(0, eventLimit).map(eventSearchHit);
  return [...playerHits, ...eventHits];
}

/** Rank directory (or full) players for home leaderboards. */
export function topPlayersFromList<
  T extends Pick<
    DirectoryPlayer,
    "id" | "disc" | "discs" | "wins" | "losses" | "winRate"
  >,
>(
  players: T[],
  opts?: { disc?: Disc | "all"; limit?: number; minDecided?: number },
): T[] {
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const limit = opts?.limit ?? 8;
  const minDecided = opts?.minDecided ?? 3;
  return players
    .filter((p) => (disc ? p.disc === disc || p.discs.includes(disc) : true))
    .filter((p) => p.wins + p.losses >= minDecided)
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins)
    .slice(0, limit);
}
