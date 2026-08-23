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
  catalogStatsFromSql,
  isoDateUtc,
  planMatchList,
  tournamentDiscIlike,
  youtubeSourceOrFilter,
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
  buildStaticSearchIndex,
  filterMatches,
  formSortMatches,
  h2hFromMatches,
  paginateMatches,
  pairH2hFromMatches,
  pickPlayerRating,
  pickPairRating,
  resolvePlayerId,
  sortMatches,
  thisWeekMatches,
  toDirectoryPlayer,
  buildFormBoard,
  utcIsoWeekStart,
} from "./query";
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
import { BWF_SEARCH_LIMIT, DISCS } from "./types";

const MATCH_SELECT =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,team1_player1_country,team1_player2_country,team2_player1_country,team2_player2_country,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,result,winner_side,status,source_url,duration_sec,created_at";

const MATCH_SELECT_NO_RESULT =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,team1_player1_country,team1_player2_country,team2_player1_country,team2_player2_country,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,status,source_url,duration_sec,created_at";

const MATCH_SELECT_NO_COUNTRY =
  "id,tournament,match_date,team1_player1,team1_player2,team2_player1,team2_player2,g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2,status,source_url,duration_sec,created_at";

/**
 * Server-private catalog access via service role (never the public anon path).
 *
 * Fast path (home, match list, stats): targeted PostgREST queries +
 * `bwf_catalog_stats` RPC. Do not page the full `matches` table for those.
 *
 * Slow path (search, player directory, H2H, profiles): process-local
 * `CatalogSnapshot` (matches + slim directory + ratings). Multi-year payload
 * is ~tens of MB, so Next.js Data Cache (2MB) cannot hold it. TTL 300s with
 * single-flight rebuild + stale-while-revalidate. Layout warms this in
 * `after()` so first paint is not blocked.
 *
 * Full player profiles (form/rivals) are built on demand in getPlayerById.
 * YEAR-SCOPE: Prefer year-scoped snapshot later if RSS becomes a problem.
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

async function selectMatchRows(
  build: (
    select: string,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
    count?: number | null;
  }>,
): Promise<{ rows: DbMatchRow[]; error: string | null; count: number | null }> {
  let select = MATCH_SELECT;
  for (;;) {
    const { data, error, count } = await build(select);
    if (error) {
      if (select === MATCH_SELECT && /result|winner_side/i.test(error.message)) {
        select = MATCH_SELECT_NO_RESULT;
        continue;
      }
      if (
        (select === MATCH_SELECT || select === MATCH_SELECT_NO_RESULT) &&
        /country/i.test(error.message)
      ) {
        select = MATCH_SELECT_NO_COUNTRY;
        continue;
      }
      return { rows: [], error: error.message, count: null };
    }
    return {
      rows: ((data as DbMatchRow[] | null) ?? []) as DbMatchRow[],
      error: null,
      count: count ?? null,
    };
  }
}

async function fetchCatalogStatsFallback(
  client: SupabaseClient,
): Promise<CatalogStats> {
  type CountBuilder = PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }> & {
    or: (filters: string) => CountBuilder;
    ilike: (column: string, value: string) => CountBuilder;
  };
  const headCount = async (
    apply: (q: CountBuilder) => CountBuilder,
  ): Promise<number> => {
    const base = client
      .from("matches")
      .select("id", { count: "exact", head: true })
      .is("owner_id", null) as unknown as CountBuilder;
    const { count, error } = await apply(base);
    if (error) return 0;
    return count ?? 0;
  };

  const [matches, withVideo, playersRes, ...discCounts] = await Promise.all([
    headCount((q) => q),
    headCount((q) => q.or(youtubeSourceOrFilter())),
    client
      .from("player_ratings")
      .select("web_id", { count: "exact", head: true })
      .eq("kind", "player"),
    ...DISCS.map((d) =>
      headCount((q) => q.ilike("tournament", tournamentDiscIlike(d))),
    ),
  ]);

  const by_disc = Object.fromEntries(
    DISCS.map((d, i) => [d, discCounts[i] ?? 0]),
  ) as Partial<Record<Disc, number>>;

  return catalogStatsFromSql({
    matches,
    players: playersRes.error ? 0 : (playersRes.count ?? 0),
    tournaments: 0,
    with_video: withVideo,
    by_disc,
    events: [],
    rounds: [],
    years: [],
  });
}

async function fetchCatalogStatsRemote(): Promise<CatalogStats> {
  requireServiceRole();
  const client = createServiceClient();
  const { data, error } = await client.rpc("bwf_catalog_stats");
  if (!error && data && typeof data === "object") {
    return catalogStatsFromSql(data as SqlCatalogStats);
  }
  return fetchCatalogStatsFallback(client);
}

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
      if (select === MATCH_SELECT && /result|winner_side/i.test(error.message)) {
        select = MATCH_SELECT_NO_RESULT;
        from = 0;
        rows.length = 0;
        continue;
      }
      if (
        (select === MATCH_SELECT || select === MATCH_SELECT_NO_RESULT) &&
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

/**
 * Full BWF snapshot for this server process (search / players / H2H).
 * Not `unstable_cache` — multi-year payload exceeds Next Data Cache 2MB limit
 * (~26MB observed), which forced a full rebuild every request.
 * Expired entries are served stale while a rebuild runs.
 */
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

/** Kick a snapshot rebuild without blocking the current response. */
export function warmCatalogSnapshot(): Promise<CatalogSnapshot> {
  return getCatalogSnapshot();
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
 * Prefer a direct single-row fetch (cold detail pages) over loading the full
 * snapshot. Snapshot is recovery only when the direct fetch errors — a
 * confirmed miss returns null without loading the catalog.
 * Decision matrix lives in `resolveMatchByIdOutcome` (unit-tested).
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
  let { data, error } = await client
    .from("matches")
    .select(MATCH_SELECT)
    .eq("id", id)
    .is("owner_id", null)
    .maybeSingle();

  if (error && /result|winner_side/i.test(error.message)) {
    const retry = await client
      .from("matches")
      .select(MATCH_SELECT_NO_RESULT)
      .eq("id", id)
      .is("owner_id", null)
      .maybeSingle();
    data = retry.data as typeof data;
    error = retry.error;
  }

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
  if (process.env.CATALOG_FIXTURE === "1") {
    const { matches } = await getCatalogSnapshot();
    return paginateMatches(
      filterMatches(matches, filters),
      filters.page ?? 1,
      filters.pageSize ?? 24,
    );
  }
  requireServiceRole();
  const plan = planMatchList(filters);
  const client = createServiceClient();
  const fetched = await selectMatchRows((select) =>
    applyMatchListPlan(
      client
        .from("matches")
        .select(select, { count: "exact" })
        .is("owner_id", null) as unknown as MatchListBuilder,
      plan,
    ),
  );
  if (fetched.error) {
    throw new Error(`BWF match list failed: ${fetched.error}`);
  }
  const mapped = fetched.rows.map(mapDbMatch);
  if (plan.overFetch && filters.player) {
    const involved = mapped.filter((m) =>
      matchInvolvesPlayer(m, filters.player as string),
    );
    return paginateMatches(involved, filters.page ?? 1, filters.pageSize ?? 24);
  }
  const pageSize = Math.min(Math.max(filters.pageSize ?? 24, 1), 100);
  const total = fetched.count ?? mapped.length;
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
  limit?: number,
): Promise<CatalogMatch[]> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const { matches } = await getCatalogSnapshot();
    return thisWeekMatches(matches, limit != null ? { limit } : undefined);
  }
  requireServiceRole();
  const weekStart = utcIsoWeekStart(Date.now());
  const start = isoDateUtc(weekStart);
  const end = isoDateUtc(weekStart + 7 * 24 * 60 * 60 * 1000);
  const client = createServiceClient();
  const fetched = await selectMatchRows((select) =>
    client
      .from("matches")
      .select(select)
      .is("owner_id", null)
      .or(
        `and(match_date.gte.${start},match_date.lt.${end}),and(match_date.is.null,created_at.gte.${start}T00:00:00.000Z,created_at.lt.${end}T00:00:00.000Z)`,
      )
      .order("match_date", { ascending: false, nullsFirst: false })
      .limit(limit != null ? Math.min(Math.max(limit, 1), 1000) : 1000),
  );
  if (fetched.error) {
    throw new Error(`BWF this-week load failed: ${fetched.error}`);
  }
  const mapped = formSortMatches(fetched.rows.map(mapDbMatch));
  return limit != null ? mapped.slice(0, limit) : mapped;
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
    const rows = buildFormBoard(ratingsByKey, knownIds, opts);
    return { rows, total: rows.length };
  }
  requireServiceRole();
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200);
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const q = (opts?.q ?? "").trim();
  const client = createServiceClient();
  let query = client
    .from("player_ratings")
    .select(
      "web_id,discipline,kind,mu,rd,rank_score,peak_mu,matches,display_name",
      { count: "exact" },
    )
    .in("kind", ["player", "pair"]);
  if (disc) query = query.eq("discipline", disc);
  if (q) {
    query = query.ilike("display_name", `%${q.replace(/[%*,()\\]/g, "")}%`);
  }
  const { data, error, count } = await query
    .order("rank_score", { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) {
    return { rows: [], total: 0 };
  }
  const ratingsByKey = new Map<string, FormRating>();
  for (const row of data as RatingRow[]) {
    if (row.kind !== "player" && row.kind !== "pair") continue;
    if (row.rank_score == null) continue;
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
  }
  // SQL already applied disc/q; do not filter again (would drop rows if
  // `discipline` is missing on a mapped rating).
  const rows = buildFormBoard(ratingsByKey, new Set(), { limit });
  return { rows, total: count ?? rows.length };
}

/** Featured matches for home: late rounds first (not chronological “recent”). */
export async function getFeaturedMatches(
  limit = 6,
): Promise<CatalogMatch[]> {
  if (process.env.CATALOG_FIXTURE === "1") {
    const { matches } = await getCatalogSnapshot();
    return sortMatches(matches, "round").slice(0, limit);
  }
  requireServiceRole();
  const take = Math.min(Math.max(limit, 1), 24);
  const client = createServiceClient();
  const fetched = await selectMatchRows((select) =>
    client
      .from("matches")
      .select(select)
      .is("owner_id", null)
      .order("match_date", { ascending: false, nullsFirst: false })
      .limit(80),
  );
  if (fetched.error) {
    throw new Error(`BWF featured load failed: ${fetched.error}`);
  }
  return sortMatches(fetched.rows.map(mapDbMatch), "round").slice(0, take);
}
