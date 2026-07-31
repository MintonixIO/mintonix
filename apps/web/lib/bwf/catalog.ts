import "server-only";

import { unstable_cache } from "next/cache";
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
  buildCatalogStats,
  buildSearchHits,
  buildStaticSearchIndex,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  paginateMatches,
  sortMatches,
  toDirectoryPlayer,
  topPlayersFromList,
} from "./query";
import type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  DirectoryPlayer,
  Disc,
  MatchFilters,
  SearchHit,
} from "./types";
import { BWF_SEARCH_LIMIT } from "./types";

const MATCH_SELECT =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,status,source_url,duration_sec,created_at";

/**
 * Server-private catalog snapshot: matches + slim directory + stats.
 * Full player profiles (form/rivals) are built on demand in getPlayerById.
 * Loaded only via service role (never the public anon path).
 * Bump the cache key when snapshot shape or load path changes.
 *
 * Scale note: multi-year catalogs are held entirely in this process memory
 * for the cache TTL (all match rows + directory). Prefer year-scoped load
 * later if RSS becomes a problem — no year filter today.
 */
export type CatalogSnapshot = {
  matches: CatalogMatch[];
  directoryPlayers: DirectoryPlayer[];
  stats: CatalogStats;
};

async function fetchPages(
  supabase: SupabaseClient,
): Promise<{ rows: DbMatchRow[]; error: string | null }> {
  const pageSize = 1000;
  let from = 0;
  const rows: DbMatchRow[] = [];

  for (;;) {
    // Order by unique `id` so range pagination cannot skip/duplicate rows when
    // many matches share the same created_at (bulk season upserts).
    const { data, error } = await supabase
      .from("matches")
      .select(MATCH_SELECT)
      .is("owner_id", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      return { rows: [], error: error.message };
    }
    if (!data?.length) break;
    rows.push(...(data as DbMatchRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { rows, error: null };
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
  return svc.rows.map(mapDbMatch);
}

async function buildCatalogSnapshot(): Promise<CatalogSnapshot> {
  const matches = await fetchAllBwfRows();
  // Aggregate once for directory + stats; discard full CatalogPlayer[] so the
  // cache does not dual-store form/rivals for every player.
  const full = aggregatePlayers(matches);
  const directoryPlayers = full.map(toDirectoryPlayer);
  const stats = buildCatalogStats(matches, directoryPlayers);
  return { matches, directoryPlayers, stats };
}

/** Single in-memory snapshot (matches + directory + stats), cached 5 minutes. */
export const getCatalogSnapshot = unstable_cache(
  async () => buildCatalogSnapshot(),
  ["bwf-catalog-v6"],
  { revalidate: 300 },
);

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
  const { data, error } = await client
    .from("matches")
    .select(MATCH_SELECT)
    .eq("id", id)
    .is("owner_id", null)
    .maybeSingle();

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
  const { matches } = await getCatalogSnapshot();
  const involved = matches.filter((m) => matchInvolvesPlayer(m, id));
  if (involved.length === 0) return null;
  const players = aggregatePlayers(involved);
  return players.find((p) => p.id === id) ?? null;
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
): Promise<{
  a: DirectoryPlayer | null;
  b: DirectoryPlayer | null;
  meetings: CatalogMatch[];
  aWins: number;
  bWins: number;
}> {
  const { directoryPlayers, matches } = await getCatalogSnapshot();
  const a = directoryPlayers.find((p) => p.id === aId) ?? null;
  const b = directoryPlayers.find((p) => p.id === bId) ?? null;
  const { meetings, aWins, bWins } = h2hFromMatches(matches, aId, bId);
  return { a, b, meetings, aWins, bWins };
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

/** Home leaderboard rows — slim directory DTOs (no form/rivals payload). */
export async function getTopPlayers(opts?: {
  disc?: Disc | "all";
  limit?: number;
}): Promise<DirectoryPlayer[]> {
  const { directoryPlayers } = await getCatalogSnapshot();
  return topPlayersFromList(directoryPlayers, {
    disc: opts?.disc,
    limit: opts?.limit,
    minDecided: 3,
  });
}

/** Featured matches for home: late rounds first (not chronological “recent”). */
export async function getFeaturedMatches(
  limit = 6,
): Promise<CatalogMatch[]> {
  const { matches } = await getCatalogSnapshot();
  return sortMatches(matches, "round").slice(0, limit);
}
