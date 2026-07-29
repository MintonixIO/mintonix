/**
 * Pure BWF catalog helpers — no Next.js / Supabase imports.
 * Safe for unit tests and for use from server catalog loaders.
 */
import {
  formatTeam,
  matchInvolvesPlayer,
  playerWon,
  roundRank,
} from "./parse";
import { playerImageUrl } from "./player-image";
import { isAllowlistedYoutubeUrl } from "./youtube";
import type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  Disc,
  MatchFilters,
  SearchHit,
} from "./types";
import { DISCS } from "./types";

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
      const rank: Record<string, number> = {
        ready: 0,
        processing: 1,
        pending: 2,
        failed: 3,
      };
      return copy.sort(
        (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9),
      );
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

/** Prefer match_date, else created_at (for form chronology). */
export function formSortMatches(list: CatalogMatch[]): CatalogMatch[] {
  return list.slice().sort((a, b) => {
    const ta = a.matchDate
      ? new Date(a.matchDate + "T00:00:00Z").getTime()
      : new Date(a.createdAt).getTime();
    const tb = b.matchDate
      ? new Date(b.matchDate + "T00:00:00Z").getTime()
      : new Date(b.createdAt).getTime();
    return tb - ta;
  });
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
  const player = filters.player?.trim() ?? "";

  let list = matches.filter((m) => {
    if (disc && m.disc !== disc) return false;
    if (year != null && !Number.isNaN(year) && m.year !== year) return false;
    if (event && !m.event.toLowerCase().includes(event)) return false;
    if (round && m.round.toLowerCase() !== round) return false;
    if (filters.hasVideo && !isAllowlistedYoutubeUrl(m.sourceUrl)) return false;
    if (filters.threeGames && !m.threeGames) return false;
    if (filters.comeback && !m.comeback) return false;
    if (player && !matchInvolvesPlayer(m, player)) return false;
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
  recentMatchIds: string[];
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
    recentMatchIds: [],
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
    recentMatchIds: p.recentMatchIds.slice(0, 12),
    imageUrl: playerImageUrl(p.id, p.name),
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

  // Form + recentMatchIds: same chronology (matchDate then createdAt).
  for (const m of forForm) {
    for (const side of [
      { ids: m.team1Ids, names: m.team1 },
      { ids: m.team2Ids, names: m.team2 },
    ]) {
      for (let i = 0; i < side.ids.length; i++) {
        const id = side.ids[i];
        const p = byId.get(id);
        if (!p) continue;
        if (p.recentMatchIds.length < 12) p.recentMatchIds.push(m.id);
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
  players: CatalogPlayer[],
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

export function buildSearchHits(
  queryRaw: string,
  players: CatalogPlayer[],
  matches: CatalogMatch[],
  stats: CatalogStats,
  limit = 8,
): SearchHit[] {
  const query = queryRaw.trim().toLowerCase().slice(0, 100);
  if (!query) return [];

  const playerHits: SearchHit[] = players
    .filter((p) => p.name.toLowerCase().includes(query))
    .slice(0, limit)
    .map((p) => ({
      kind: "Player" as const,
      id: p.id,
      label: p.name,
      sub: `${p.matches} matches · ${p.winRate}% win${p.disc ? ` · ${p.disc}` : ""}`,
      href: `/bwf/players/${p.id}`,
    }));

  const eventHits: SearchHit[] = stats.events
    .filter((e) => e.event.toLowerCase().includes(query))
    .slice(0, 4)
    .map((e) => ({
      kind: "Tournament" as const,
      id: e.event,
      label: e.event,
      sub: `${e.count} matches`,
      href: `/bwf/matches?event=${encodeURIComponent(e.event)}`,
    }));

  const matchHits: SearchHit[] = filterMatches(matches, { q: query })
    .slice(0, limit)
    .map((m) => ({
      kind: "Match" as const,
      id: m.id,
      label: `${formatTeam(m.team1)} vs ${formatTeam(m.team2)}`,
      sub: `${m.event}${m.round ? ` · ${m.round}` : ""}${m.disc ? ` · ${m.disc}` : ""}`,
      href: `/bwf/matches/${m.id}`,
    }));

  return [...playerHits, ...eventHits, ...matchHits].slice(0, limit);
}

export function topPlayersFromList(
  players: CatalogPlayer[],
  opts?: { disc?: Disc | "all"; limit?: number; minDecided?: number },
): CatalogPlayer[] {
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const limit = opts?.limit ?? 8;
  const minDecided = opts?.minDecided ?? 3;
  return players
    .filter((p) => (disc ? p.disc === disc || p.discs.includes(disc) : true))
    .filter((p) => p.wins + p.losses >= minDecided)
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins)
    .slice(0, limit);
}
