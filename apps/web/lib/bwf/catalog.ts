import "server-only";

import {
  createServiceClient,
  hasServiceRoleKey,
} from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveMatchByIdOutcome,
  type SnapshotAttempt,
} from "./match-by-id";
import {
  mapDbMatch,
  matchInvolvesPlayer,
  type DbMatchRow,
} from "./parse";
import {
  aggregatePlayers,
  applyInferredCountries,
  applyRating,
  buildCatalogStats,
  buildSearchHits,
  buildStaticSearchIndex,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  paginateMatches,
  pairH2hFromMatches,
  pickPlayerRating,
  resolvePlayerId,
  sortMatches,
  thisWeekMatches,
  toDirectoryPlayer,
} from "./query";
import type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  DirectoryPlayer,
  Disc,
  FormRating,
  MatchFilters,
  SearchHit,
} from "./types";
import { BWF_SEARCH_LIMIT } from "./types";

const MATCH_SELECT =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,team1_player1_country,team1_player2_country,team2_player1_country,team2_player2_country,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,status,source_url,duration_sec,created_at";

const MATCH_SELECT_NO_COUNTRY =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,status,source_url,duration_sec,created_at";

/**
 * Server-private catalog snapshot: matches + slim directory + stats.
 * Full player profiles (form/rivals) are built on demand in getPlayerById.
 * Loaded only via service role (never the public anon path).
 *
 * Caching: multi-year snapshot is ~tens of MB. Next.js `unstable_cache` /
 * Data Cache rejects entries over 2MB, so we use a process-local TTL cache
 * with single-flight rebuild instead. Survives for the life of the Node
 * process (dev server / one server instance); not shared across workers.
 *
 * Scale note: full multi-year catalogs stay in process RAM for the TTL.
 * YEAR-SCOPE: Prefer year-scoped load later if RSS becomes a problem — no year filter on snapshot today (client filters still work after full load).
 */
export type CatalogSnapshot = {
  matches: CatalogMatch[];
  directoryPlayers: DirectoryPlayer[];
  stats: CatalogStats;
  ratingsByKey: Map<string, FormRating>;
  individualsByKey: Map<string, FormRating>;
};

/** Process-local snapshot TTL (seconds), aligned with former revalidate: 300. */
const SNAPSHOT_TTL_MS = 300_000;

type SnapshotCacheEntry = {
  snapshot: CatalogSnapshot;
  expiresAt: number;
};

let snapshotCache: SnapshotCacheEntry | null = null;
/** In-flight build so parallel layout+page callers share one Supabase page-in. */
let snapshotInflight: Promise<CatalogSnapshot> | null = null;

async function fetchPages(
  supabase: SupabaseClient,
): Promise<{ rows: DbMatchRow[]; error: string | null }> {
  const pageSize = 1000;
  let from = 0;
  const rows: DbMatchRow[] = [];
  let select = MATCH_SELECT;

  for (;;) {
    // Order by unique `id` so range pagination cannot skip/duplicate rows when
    // many matches share the same created_at (bulk season upserts).
    const { data, error } = await supabase
      .from("matches")
      .select(select)
      .is("owner_id", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      if (
        select === MATCH_SELECT &&
        /country/i.test(error.message)
      ) {
        select = MATCH_SELECT_NO_COUNTRY;
        from = 0;
        rows.length = 0;
        continue;
      }
      return { rows: [], error: error.message };
    }
    if (!data?.length) break;
    rows.push(...((data as unknown) as DbMatchRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { rows, error: null };
}

type RatingRow = {
  web_id: string;
  discipline: Disc;
  kind: string;
  mu: number;
  rd: number;
  rank_score: number;
  peak_mu: number;
  matches: number;
};

type IndividualRow = {
  web_id: string;
  discipline: Disc;
  mu: number;
  sigma: number;
  exposure: number;
  matches: number;
};

async function fetchRatingTables(supabase: SupabaseClient): Promise<{
  ratingsByKey: Map<string, FormRating>;
  individualsByKey: Map<string, FormRating>;
}> {
  const ratingsByKey = new Map<string, FormRating>();
  const individualsByKey = new Map<string, FormRating>();
  const pageSize = 1000;

  const pageIn = async <T,>(
    table: string,
    select: string,
    sink: (row: T) => void,
  ) => {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .order("web_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        // Table missing (migration not applied) — catalog still works.
        return;
      }
      if (!data?.length) break;
      for (const row of data as T[]) sink(row);
      if (data.length < pageSize) break;
      from += pageSize;
    }
  };

  await pageIn<RatingRow>(
    "player_ratings",
    "web_id,discipline,kind,mu,rd,rank_score,peak_mu,matches",
    (row) => {
      if (row.kind !== "player") return;
      ratingsByKey.set(`${row.web_id}|${row.discipline}`, {
        disc: row.discipline,
        kind: "player",
        mu: row.mu,
        rd: row.rd,
        rankScore: row.rank_score,
        peakMu: row.peak_mu,
        matches: row.matches,
      });
    },
  );

  await pageIn<IndividualRow>(
    "rating_individuals",
    "web_id,discipline,mu,sigma,exposure,matches",
    (row) => {
      individualsByKey.set(`${row.web_id}|${row.discipline}`, {
        disc: row.discipline,
        kind: "individual",
        mu: row.mu,
        exposure: row.exposure,
        matches: row.matches,
      });
    },
  );

  return { ratingsByKey, individualsByKey };
}

/**
 * Load full BWF catalog via service role only.
 * Always filters owner_id IS NULL (defense in depth; service role bypasses RLS).
 */
async function fetchAllBwfRows(): Promise<CatalogMatch[]> {
  if (!hasServiceRoleKey()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — BWF catalog requires service-role credentials",
    );
  }

  const svc = await fetchPages(createServiceClient());
  if (svc.error) {
    throw new Error(`BWF catalog load failed: ${svc.error}`);
  }
  return applyInferredCountries(svc.rows.map(mapDbMatch));
}

async function buildCatalogSnapshot(): Promise<CatalogSnapshot> {
  const client = createServiceClient();
  const matches = await fetchAllBwfRows();
  const { ratingsByKey, individualsByKey } = await fetchRatingTables(client);
  // Aggregate once for directory + stats; discard full CatalogPlayer[] so the
  // cache does not dual-store form/rivals for every player.
  const full = aggregatePlayers(matches);
  const directoryPlayers = full.map((p) => {
    const slim = toDirectoryPlayer(p);
    return {
      ...slim,
      rating: pickPlayerRating(p, ratingsByKey),
    };
  });
  const stats = buildCatalogStats(matches, directoryPlayers);
  return { matches, directoryPlayers, stats, ratingsByKey, individualsByKey };
}

/**
 * Full BWF snapshot for this server process.
 * Not `unstable_cache` — multi-year payload exceeds Next Data Cache 2MB limit
 * (~26MB observed), which forced a full rebuild every request.
 */
export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const now = Date.now();
  if (snapshotCache && snapshotCache.expiresAt > now) {
    return snapshotCache.snapshot;
  }
  if (snapshotInflight) return snapshotInflight;

  snapshotInflight = buildCatalogSnapshot()
    .then((snapshot) => {
      snapshotCache = {
        snapshot,
        expiresAt: Date.now() + SNAPSHOT_TTL_MS,
      };
      return snapshot;
    })
    .finally(() => {
      snapshotInflight = null;
    });

  return snapshotInflight;
}

export async function getDirectoryPlayers(): Promise<DirectoryPlayer[]> {
  const snap = await getCatalogSnapshot();
  return snap.directoryPlayers;
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const snap = await getCatalogSnapshot();
  return snap.stats;
}

/**
 * Prefer a direct single-row fetch (cold detail pages) over loading the full
 * snapshot. Snapshot is recovery only when the direct fetch errors — a
 * confirmed miss returns null without loading the catalog.
 * Decision matrix lives in `resolveMatchByIdOutcome` (unit-tested).
 */
export async function getMatchById(id: string): Promise<CatalogMatch | null> {
  if (!hasServiceRoleKey()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — BWF catalog requires service-role credentials",
    );
  }

  const client = createServiceClient();
  let { data, error } = await client
    .from("matches")
    .select(MATCH_SELECT)
    .eq("id", id)
    .is("owner_id", null)
    .maybeSingle();

  if (error && /country/i.test(error.message)) {
    const retry = await client
      .from("matches")
      .select(MATCH_SELECT_NO_COUNTRY)
      .eq("id", id)
      .is("owner_id", null)
      .maybeSingle();
    data = retry.data as typeof data;
    error = retry.error;
  }

  // Cold detail path: return immediately on direct hit — never load snapshot.
  if (data && !error) {
    return mapDbMatch(data as DbMatchRow);
  }

  // Confirmed miss: true 404 — do not load the full catalog snapshot.
  if (!error) {
    return null;
  }

  let snapshot: SnapshotAttempt;
  try {
    const snap = await getCatalogSnapshot();
    const hit = snap.matches.find((m) => m.id === id);
    snapshot = hit
      ? { status: "hit", match: hit }
      : { status: "miss" };
  } catch (e) {
    snapshot = { status: "error", error: e };
  }

  return resolveMatchByIdOutcome(null, { message: error.message }, snapshot);
}

export async function queryMatches(filters: MatchFilters = {}): Promise<{
  matches: CatalogMatch[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { matches } = await getCatalogSnapshot();
  const filtered = filterMatches(matches, filters);
  return paginateMatches(
    filtered,
    filters.page ?? 1,
    filters.pageSize ?? 24,
  );
}

/**
 * Full profile with form/rivals — built on demand from this player's matches
 * so the shared snapshot need not hold CatalogPlayer[] for everyone.
 */
export async function getPlayerById(
  id: string,
): Promise<CatalogPlayer | null> {
  const snap = await getCatalogSnapshot();
  const resolved = resolvePlayerId(id, snap.directoryPlayers);
  const playerId = resolved.match?.id;
  if (!playerId) return null;
  const involved = snap.matches.filter((m) =>
    matchInvolvesPlayer(m, playerId),
  );
  if (involved.length === 0) return null;
  const players = aggregatePlayers(involved);
  const player = players.find((p) => p.id === playerId);
  if (!player) return null;
  const ratingById = new Map<string, FormRating | null>();
  for (const p of players) {
    ratingById.set(p.id, pickPlayerRating(p, snap.ratingsByKey));
  }
  return applyRating(
    player,
    pickPlayerRating(player, snap.ratingsByKey),
    pickPlayerRating(player, snap.individualsByKey),
    ratingById,
  );
}

export async function listPlayerHomonyms(
  id: string,
): Promise<DirectoryPlayer[]> {
  const { directoryPlayers } = await getCatalogSnapshot();
  return resolvePlayerId(id, directoryPlayers).candidates;
}

export async function getPlayerMatches(
  playerId: string,
  limit = 50,
): Promise<CatalogMatch[]> {
  const { matches } = await getCatalogSnapshot();
  return formSortMatches(
    matches.filter((m) => matchInvolvesPlayer(m, playerId)),
  ).slice(0, limit);
}

export async function getH2h(
  aId: string,
  bId: string,
  opts?: { a2?: string; b2?: string },
): Promise<{
  a: DirectoryPlayer | null;
  b: DirectoryPlayer | null;
  meetings: CatalogMatch[];
  aWins: number;
  bWins: number;
  pairMode: boolean;
}> {
  const { directoryPlayers, matches } = await getCatalogSnapshot();
  const resolve = (id: string) =>
    resolvePlayerId(id, directoryPlayers).match ??
    directoryPlayers.find((p) => p.id === id) ??
    null;
  const a = aId ? resolve(aId) : null;
  const b = bId ? resolve(bId) : null;
  const a2 = opts?.a2 ? resolve(opts.a2) : null;
  const b2 = opts?.b2 ? resolve(opts.b2) : null;
  const pairMode = Boolean(a && a2 && b && b2);
  const { meetings, aWins, bWins } = pairMode
    ? pairH2hFromMatches(
        matches,
        [a!.id, a2!.id],
        [b!.id, b2!.id],
      )
    : h2hFromMatches(matches, a?.id ?? aId, b?.id ?? bId);
  return { a, b, meetings, aWins, bWins, pairMode };
}

export async function searchCatalog(
  q: string,
  limit = BWF_SEARCH_LIMIT,
): Promise<SearchHit[]> {
  const { directoryPlayers, matches, stats } = await getCatalogSnapshot();
  return buildSearchHits(q, directoryPlayers, matches, stats, limit);
}

/** Shell static index (players + tournaments) from the snapshot. */
export async function getStaticSearchIndex(): Promise<SearchHit[]> {
  const { directoryPlayers, stats } = await getCatalogSnapshot();
  return buildStaticSearchIndex(directoryPlayers, stats);
}


export async function listDirectoryPlayers(opts?: {
  q?: string;
  disc?: Disc | "all";
  page?: number;
  pageSize?: number;
}): Promise<{
  players: DirectoryPlayer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const pageSize = Math.min(Math.max(opts?.pageSize ?? 60, 1), 100);
  const page = Math.max(opts?.page ?? 1, 1);
  const q = (opts?.q ?? "").trim().toLowerCase();
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const all = await getDirectoryPlayers();
  const filtered = all.filter((p) => {
    if (disc && p.disc !== disc && !p.discs.includes(disc)) return false;
    if (q) {
      const hay = `${p.name} ${p.country ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    players: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

/** Leaderboard slice computed server-side (avoids shipping full directory). */
export async function listDirectoryBoard(opts?: {
  q?: string;
  disc?: Disc | "all";
  metric?: "winRate" | "wins" | "matches" | "threeGames" | "withVideo";
  limit?: number;
}): Promise<{ players: DirectoryPlayer[]; total: number }> {
  const q = (opts?.q ?? "").trim().toLowerCase();
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const metric = opts?.metric ?? "winRate";
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const all = await getDirectoryPlayers();
  let filtered = all.filter((p) => {
    if (disc && p.disc !== disc && !p.discs.includes(disc)) return false;
    if (q) {
      const hay = `${p.name} ${p.country ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (metric === "winRate") {
    filtered = filtered.filter((p) => p.wins + p.losses >= 3);
  } else {
    filtered = filtered.filter((p) => p.matches >= 1);
  }
  const get = (p: DirectoryPlayer) => {
    switch (metric) {
      case "wins":
        return p.wins;
      case "matches":
        return p.matches;
      case "threeGames":
        return p.threeGames;
      case "withVideo":
        return p.withVideo;
      default:
        return p.winRate;
    }
  };
  filtered = filtered.slice().sort((a, b) => get(b) - get(a) || b.wins - a.wins);
  return { players: filtered.slice(0, limit), total: filtered.length };
}

/** Slim rows for H2H picker seed + remote typeahead. */
export async function searchDirectoryPlayers(
  q: string,
  limit = 40,
): Promise<
  {
    id: string;
    name: string;
    matches: number;
    disc: DirectoryPlayer["disc"];
    country: string | null;
  }[]
> {
  const query = q.trim().toLowerCase().slice(0, 100);
  const all = await getDirectoryPlayers();
  const rows = (query
    ? all.filter((p) =>
        `${p.name} ${p.country ?? ""}`.toLowerCase().includes(query),
      )
    : all.slice().sort((a, b) => b.matches - a.matches)
  ).slice(0, Math.min(Math.max(limit, 1), 80));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    matches: p.matches,
    disc: p.disc,
    country: p.country,
  }));
}

/** This week's matches for home (no ranking leaderboard). */
export async function getThisWeekMatches(
  limit = 12,
): Promise<CatalogMatch[]> {
  const { matches } = await getCatalogSnapshot();
  return thisWeekMatches(matches, { limit });
}

/** Featured matches for home: late rounds first (not chronological “recent”). */
export async function getFeaturedMatches(
  limit = 6,
): Promise<CatalogMatch[]> {
  const { matches } = await getCatalogSnapshot();
  return sortMatches(matches, "round").slice(0, limit);
}
