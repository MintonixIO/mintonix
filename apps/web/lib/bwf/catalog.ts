import "server-only";

import { unstable_cache } from "next/cache";
import {
  createAnonClient,
  createServiceClient,
  hasAnonKey,
  hasServiceRoleKey,
} from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapDbMatch,
  matchInvolvesPlayer,
  type DbMatchRow,
} from "./parse";
import {
  aggregatePlayers,
  buildCatalogStats,
  buildSearchHits,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  paginateMatches,
  sortMatches,
  topPlayersFromList,
} from "./query";
import type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  Disc,
  MatchFilters,
  SearchHit,
} from "./types";

export {
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  paginateMatches,
  sortMatches,
  topPlayersFromList,
  winRateFromRecord,
  isH2hMeeting,
  aggregatePlayers,
  buildCatalogStats,
  buildSearchHits,
} from "./query";

const MATCH_SELECT =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,status,source_url,duration_sec,created_at";

/**
 * Dual-path catalog load:
 * 1. Prefer anon/publishable key (RLS: owner_id IS NULL).
 * 2. On permission/error or empty result when service role is available,
 *    fall back to service role with the same owner_id IS NULL filter.
 * PROD without the public BWF RLS migration still works via service role.
 */
async function fetchPages(
  supabase: SupabaseClient,
): Promise<{ rows: DbMatchRow[]; error: string | null }> {
  const pageSize = 1000;
  let from = 0;
  const rows: DbMatchRow[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from("matches")
      .select(MATCH_SELECT)
      .is("owner_id", null)
      .order("created_at", { ascending: false })
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

async function fetchAllBwfRows(): Promise<CatalogMatch[]> {
  let lastError: string | null = null;

  if (hasAnonKey()) {
    const anon = await fetchPages(createAnonClient());
    if (!anon.error && anon.rows.length > 0) {
      return anon.rows.map(mapDbMatch);
    }
    lastError = anon.error;
    if (!anon.error && anon.rows.length === 0 && hasServiceRoleKey()) {
      // Empty may mean RLS denies all rows — try service role.
      console.warn(
        "[bwf] anon catalog returned 0 rows; trying service-role fallback",
      );
    } else if (anon.error && hasServiceRoleKey()) {
      console.warn(
        "[bwf] anon catalog failed; trying service-role fallback:",
        anon.error,
      );
    } else if (anon.error) {
      throw new Error(`BWF catalog load failed: ${anon.error}`);
    } else {
      // Truly empty catalog with no service fallback.
      return [];
    }
  }

  if (hasServiceRoleKey()) {
    const svc = await fetchPages(createServiceClient());
    if (svc.error) {
      throw new Error(
        `BWF catalog load failed: ${svc.error}${lastError ? ` (anon: ${lastError})` : ""}`,
      );
    }
    return svc.rows.map(mapDbMatch);
  }

  throw new Error(
    lastError
      ? `BWF catalog load failed: ${lastError}`
      : "Missing Supabase catalog credentials",
  );
}

/** Full BWF catalog (~3k rows), cached 5 minutes. */
export const getBwfMatches = unstable_cache(
  async () => fetchAllBwfRows(),
  ["bwf-catalog-matches-v3"],
  { revalidate: 300 },
);

export async function getMatchById(id: string): Promise<CatalogMatch | null> {
  const all = await getBwfMatches();
  const hit = all.find((m) => m.id === id);
  if (hit) return hit;

  // Direct fetch with same dual-path preference.
  const tryOne = async (client: SupabaseClient) => {
    const { data, error } = await client
      .from("matches")
      .select(MATCH_SELECT)
      .eq("id", id)
      .is("owner_id", null)
      .maybeSingle();
    if (error || !data) return null;
    return mapDbMatch(data as DbMatchRow);
  };

  if (hasAnonKey()) {
    const row = await tryOne(createAnonClient());
    if (row) return row;
  }
  if (hasServiceRoleKey()) {
    return tryOne(createServiceClient());
  }
  return null;
}

export async function queryMatches(filters: MatchFilters = {}): Promise<{
  matches: CatalogMatch[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const all = await getBwfMatches();
  const filtered = filterMatches(all, filters);
  return paginateMatches(
    filtered,
    filters.page ?? 1,
    filters.pageSize ?? 24,
  );
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const matches = await getBwfMatches();
  const players = await getCatalogPlayers();
  return buildCatalogStats(matches, players);
}

/** Players derived from the same cached match catalog (no second table scan). */
export const getCatalogPlayers = unstable_cache(
  async () => aggregatePlayers(await getBwfMatches()),
  ["bwf-catalog-players-v3"],
  { revalidate: 300 },
);

export async function getPlayerById(
  id: string,
): Promise<CatalogPlayer | null> {
  const players = await getCatalogPlayers();
  return players.find((p) => p.id === id) ?? null;
}

export async function getPlayerMatches(
  playerId: string,
  limit = 50,
): Promise<CatalogMatch[]> {
  const matches = await getBwfMatches();
  return formSortMatches(
    matches.filter((m) => matchInvolvesPlayer(m, playerId)),
  ).slice(0, limit);
}

export async function getH2h(
  aId: string,
  bId: string,
): Promise<{
  a: CatalogPlayer | null;
  b: CatalogPlayer | null;
  meetings: CatalogMatch[];
  aWins: number;
  bWins: number;
}> {
  const [players, matches] = await Promise.all([
    getCatalogPlayers(),
    getBwfMatches(),
  ]);
  const a = players.find((p) => p.id === aId) ?? null;
  const b = players.find((p) => p.id === bId) ?? null;
  const { meetings, aWins, bWins } = h2hFromMatches(matches, aId, bId);
  return { a, b, meetings, aWins, bWins };
}

export async function searchCatalog(
  q: string,
  limit = 8,
): Promise<SearchHit[]> {
  const [players, matches, stats] = await Promise.all([
    getCatalogPlayers(),
    getBwfMatches(),
    getCatalogStats(),
  ]);
  return buildSearchHits(q, players, matches, stats, limit);
}

export async function getTopPlayers(opts?: {
  disc?: Disc | "all";
  limit?: number;
}): Promise<CatalogPlayer[]> {
  const players = await getCatalogPlayers();
  return topPlayersFromList(players, {
    disc: opts?.disc,
    limit: opts?.limit,
    minDecided: 3,
  });
}

export async function getRecentMatches(limit = 6): Promise<CatalogMatch[]> {
  const matches = await getBwfMatches();
  return sortMatches(matches, "round").slice(0, limit);
}
