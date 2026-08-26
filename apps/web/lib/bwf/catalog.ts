import "server-only";

import {
  createServiceClient,
  hasServiceRoleKey,
} from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMatchByIdOutcome } from "./match-by-id";
import {
  mapDbMatch,
  matchInvolvesPlayer,
  type DbMatchRow,
} from "./parse";
import {
  catalogStatsFromSql,
  filterMatchList,
  planMatchList,
  sanitizeFilterValue,
  type MatchListPlan,
  type SqlCatalogStats,
} from "./match-query";
import {
  aggregatePlayers,
  applyInferredCountries,
  applyCanonicalNames,
  bestH2hPair,
  applyRating,
  buildCatalogStats,
  buildSearchHits,
  formSortMatches,
  h2hFromMatches,
  paginateMatches,
  pairH2hFromMatches,
  pickPlayerRating,
  pickPairRating,
  resolvePlayerId,
  toDirectoryPlayer,
} from "./query";
import {
  buildFormBoard,
  mapFormBoardRows,
  type FormBoardSqlRow,
} from "./form-board";
import type {
  CatalogMatch,
  CatalogPlayer,
  CatalogStats,
  DirectoryPlayer,
  Disc,
  FormBoardRow,
  FormRating,
  H2hResult,
  MatchFilters,
  SearchHit,
} from "./types";
import { BWF_SEARCH_LIMIT, BWF_SEARCH_MAX_Q, DISCS } from "./types";

const MATCH_SELECT =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,team1_player1_country,team1_player2_country,team2_player1_country,team2_player2_country,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,result,winner_side,status,source_url,duration_sec,created_at";

/**
 * Server-private catalog access via service role (never the public anon path).
 *
 * Fast path (home, match list, stats, form boards): targeted PostgREST queries +
 * `bwf_catalog_stats` RPC. Do not page the full `matches` table for those.
 *
 * Slow path (search, directory profiles, player profiles, H2H): process-local
 * `CatalogSnapshot`. Held in process RAM because Next Data Cache is 2MB.
 * Snapshot loads only when those surfaces call `getCatalogSnapshot()`.
 *
 * Full player profiles (form/rivals) are built on demand in getPlayerById.
 */
export type CatalogSnapshot = {
  matches: CatalogMatch[];
  directoryPlayers: DirectoryPlayer[];
  stats: CatalogStats;
  ratingsByKey: Map<string, FormRating>;
  individualsByKey: Map<string, FormRating>;
};

/** Snapshot TTL (ms). */
const SNAPSHOT_TTL_MS = 300_000;

type SnapshotCacheEntry = {
  snapshot: CatalogSnapshot;
  expiresAt: number;
};

let snapshotCache: SnapshotCacheEntry | null = null;
/** In-flight build so parallel snapshot callers share one Supabase page-in. */
let snapshotInflight: Promise<CatalogSnapshot> | null = null;

type StatsCacheEntry = { stats: CatalogStats; expiresAt: number };
let statsCache: StatsCacheEntry | null = null;
let statsInflight: Promise<CatalogStats> | null = null;

function requireServiceRole(): void {
  if (!hasServiceRoleKey()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — BWF catalog requires service-role credentials",
    );
  }
}

type MatchListBuilder = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}> & {
  ilike: (column: string, value: string) => MatchListBuilder;
  not: (column: string, operator: string, value: unknown) => MatchListBuilder;
  or: (filters: string) => MatchListBuilder;
  order: (
    column: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean },
  ) => MatchListBuilder;
  range: (from: number, to: number) => MatchListBuilder;
  limit: (n: number) => MatchListBuilder;
};

function applyMatchListPlan(
  query: MatchListBuilder,
  plan: MatchListPlan,
): MatchListBuilder {
  let q = query;
  for (const f of plan.filters) {
    if (f.kind === "ilike") q = q.ilike(f.column, f.value);
    else if (f.kind === "not_is") q = q.not(f.column, "is", null);
    else q = q.or(f.value);
  }
  for (const o of plan.order) {
    q = q.order(o.column, { ascending: o.ascending, nullsFirst: false });
  }
  return q.range(plan.from, plan.to);
}

async function fetchCatalogStatsRemote(): Promise<CatalogStats> {
  requireServiceRole();
  const client = createServiceClient();
  const { data, error } = await client.rpc("bwf_catalog_stats");
  if (error || !data || typeof data !== "object") {
    throw new Error(
      `BWF catalog stats failed: ${error?.message ?? "empty response"}`,
    );
  }
  return catalogStatsFromSql(data as SqlCatalogStats);
}

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
  display_name: string | null;
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
        throw new Error(`BWF ${table} load failed: ${error.message}`);
      }
      if (!data?.length) break;
      for (const row of data as T[]) sink(row);
      if (data.length < pageSize) break;
      from += pageSize;
    }
  };

  await pageIn<RatingRow>(
    "player_ratings",
    "web_id,discipline,kind,mu,rd,rank_score,peak_mu,matches,display_name",
    (row) => {
      if (row.kind !== "player" && row.kind !== "pair") return;
      ratingsByKey.set(`${row.web_id}|${row.discipline}`, {
        disc: row.discipline,
        kind: row.kind,
        mu: row.mu,
        rd: row.rd,
        rankScore: row.rank_score,
        peakMu: row.peak_mu,
        matches: row.matches,
        webId: row.web_id,
        name: row.display_name ?? undefined,
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
  if (process.env.CATALOG_FIXTURE === "1") {
    const { loadPreviewSnapshot } = await import("./preview-fixture");
    return loadPreviewSnapshot().matches;
  }
  if (!hasServiceRoleKey()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — BWF catalog requires service-role credentials",
    );
  }

  const svc = await fetchPages(createServiceClient());
  if (svc.error) {
    throw new Error(`BWF catalog load failed: ${svc.error}`);
  }
  return applyCanonicalNames(applyInferredCountries(svc.rows.map(mapDbMatch)));
}

async function buildCatalogSnapshot(): Promise<CatalogSnapshot> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const { loadPreviewSnapshot } = await import("./preview-fixture");
    return loadPreviewSnapshot();
  }
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

/** Process RAM snapshot — Next Data Cache is 2MB. */
export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const now = Date.now();
  if (snapshotCache && snapshotCache.expiresAt > now) {
    return snapshotCache.snapshot;
  }
  if (!snapshotInflight) {
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
  }
  if (snapshotCache) return snapshotCache.snapshot;
  return snapshotInflight;
}

export async function getDirectoryPlayers(): Promise<DirectoryPlayer[]> {
  const snap = await getCatalogSnapshot();
  return snap.directoryPlayers;
}

export async function getCatalogStats(): Promise<CatalogStats> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const snap = await getCatalogSnapshot();
    return snap.stats;
  }
  const now = Date.now();
  if (statsCache && statsCache.expiresAt > now) return statsCache.stats;
  if (!statsInflight) {
    statsInflight = fetchCatalogStatsRemote()
      .then((stats) => {
        statsCache = { stats, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
        return stats;
      })
      .finally(() => {
        statsInflight = null;
      });
  }
  if (statsCache) return statsCache.stats;
  return statsInflight;
}

/**
 * Direct single-row fetch. Confirmed miss is null; any query error throws.
 * Never pages the catalog dump from a detail error.
 */
export async function getMatchById(id: string): Promise<CatalogMatch | null> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const snap = await getCatalogSnapshot();
    return snap.matches.find((m) => m.id === id) ?? null;
  }
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

  return resolveMatchByIdOutcome(
    (data as DbMatchRow | null) ?? null,
    error ? { message: error.message } : null,
  );
}

export async function queryMatches(filters: MatchFilters = {}): Promise<{
  matches: CatalogMatch[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const { matches } = await getCatalogSnapshot();
    return paginateMatches(
      filterMatchList(matches, filters),
      filters.page ?? 1,
      filters.pageSize ?? 24,
    );
  }
  requireServiceRole();
  const plan = planMatchList(filters);
  const client = createServiceClient();
  const selected = plan.overFetch
    ? client.from("matches").select(MATCH_SELECT).is("owner_id", null)
    : client
        .from("matches")
        .select(MATCH_SELECT, { count: "exact" })
        .is("owner_id", null);
  const { data, error, count } = await applyMatchListPlan(
    selected as unknown as MatchListBuilder,
    plan,
  );
  if (error) {
    throw new Error(`BWF match list failed: ${error.message}`);
  }
  const mapped = (((data as DbMatchRow[] | null) ?? []) as DbMatchRow[]).map(
    mapDbMatch,
  );
  if (plan.overFetch && filters.player) {
    // Total is the JS-involved set, not the name-ilike SQL count. Window is
    // PLAYER_OVERFETCH_LIMIT so this path cannot page the dump.
    const involved = mapped.filter((m) =>
      matchInvolvesPlayer(m, filters.player as string),
    );
    return paginateMatches(involved, filters.page ?? 1, filters.pageSize ?? 24);
  }
  const pageSize = Math.min(Math.max(filters.pageSize ?? 24, 1), 100);
  const total = count ?? mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = Math.min(Math.max(filters.page ?? 1, 1), totalPages);
  return { matches: mapped, total, page, pageSize, totalPages };
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
    snap.ratingsByKey,
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
): Promise<H2hResult> {
  const { directoryPlayers, matches, ratingsByKey } = await getCatalogSnapshot();
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
  const pairDisc =
    meetings.find((m) => m.disc === "MD" || m.disc === "WD" || m.disc === "XD")
      ?.disc ?? null;
  const pairARating =
    pairMode && a && a2
      ? pickPairRating(a.id, a2.id, pairDisc, ratingsByKey)
      : null;
  const pairBRating =
    pairMode && b && b2
      ? pickPairRating(b.id, b2.id, pairDisc, ratingsByKey)
      : null;
  return { a, b, meetings, aWins, bWins, pairMode, pairARating, pairBRating };
}

export async function getDefaultH2hIds(): Promise<{ a: string; b: string } | null> {
  const { matches } = await getCatalogSnapshot();
  return bestH2hPair(matches);
}

export async function searchCatalog(
  q: string,
  limit = BWF_SEARCH_LIMIT,
): Promise<SearchHit[]> {
  const { directoryPlayers, matches, stats } = await getCatalogSnapshot();
  return buildSearchHits(q, directoryPlayers, matches, stats, limit);
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

/** Form boards: Glicko rank_score per discipline (pairs for MD/WD/XD). */
export async function listFormBoard(opts?: {
  q?: string;
  disc?: Disc | "all";
  limit?: number;
}): Promise<{ rows: FormBoardRow[]; total: number }> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const { ratingsByKey, directoryPlayers } = await getCatalogSnapshot();
    const knownIds = new Set(directoryPlayers.map((p) => p.id));
    return buildFormBoard(ratingsByKey, knownIds, opts);
  }
  requireServiceRole();
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200);
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const q = sanitizeFilterValue(opts?.q ?? "").slice(0, BWF_SEARCH_MAX_Q);
  const client = createServiceClient();
  let query = client
    .from("player_ratings")
    .select(
      "web_id,discipline,kind,mu,rd,rank_score,peak_mu,matches,display_name",
      { count: "exact" },
    )
    .in("kind", ["player", "pair"])
    .in("discipline", [...DISCS])
    .not("rank_score", "is", null);
  if (disc) query = query.eq("discipline", disc);
  if (q) {
    query = query.ilike("display_name", `%${q}%`);
  }
  const { data, error, count } = await query
    .order("rank_score", { ascending: false })
    .order("matches", { ascending: false })
    .order("display_name", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`BWF form board failed: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("BWF form board failed: empty response");
  }
  const rows = mapFormBoardRows(data as FormBoardSqlRow[]);
  const total = count ?? rows.length;
  if (rows.length === 0 && total > 0) {
    throw new Error("BWF form board failed: ratings rows did not map");
  }
  return { rows, total };
}
