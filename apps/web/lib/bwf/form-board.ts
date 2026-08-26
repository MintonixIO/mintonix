/**
 * Pure form-board mapping — SQL rows and in-memory ratings share one mapper.
 */
import { playerIdCountry } from "./parse";
import type { Disc, FormBoardRow, FormRating } from "./types";
import { DISCS } from "./types";

const DISC_SET = new Set<string>(DISCS);

export type FormBoardSqlRow = {
  web_id: string;
  discipline: string;
  kind: string;
  mu: number;
  rd: number | null;
  rank_score: number | null;
  peak_mu: number | null;
  matches: number;
  display_name: string | null;
};

/**
 * Pair web_id is `playerA--playerB`. Each player id may itself contain `--cc`.
 * Known ids win; then both-country cuts; then a 2-part slug; then any non-empty cut.
 */
export function splitPairWebId(
  webId: string,
  knownIds: Set<string>,
): [string, string] | null {
  const parts = webId.split("--");
  if (parts.length < 2) return null;

  const cuts: [string, string][] = [];
  for (let i = 1; i < parts.length; i++) {
    cuts.push([parts.slice(0, i).join("--"), parts.slice(i).join("--")]);
  }

  for (const [a, b] of cuts) {
    if (knownIds.has(a) && knownIds.has(b)) return [a, b];
  }
  for (const [a, b] of cuts) {
    if (playerIdCountry(a) && playerIdCountry(b)) return [a, b];
  }
  for (const [a, b] of cuts) {
    if (playerIdCountry(a) && b) return [a, b];
  }
  if (parts.length === 2 && parts[0] && parts[1]) {
    return [parts[0], parts[1]];
  }
  for (const [a, b] of cuts) {
    if (a && b) return [a, b];
  }
  return null;
}

export function formBoardHref(
  kind: "player" | "pair",
  webId: string,
  knownIds: Set<string>,
): string {
  if (kind === "player" && webId) {
    return `/bwf/players/${encodeURIComponent(webId)}`;
  }
  if (kind === "pair" && webId) {
    const members = splitPairWebId(webId, knownIds);
    return members
      ? `/bwf/h2h?a=${encodeURIComponent(members[0])}&a2=${encodeURIComponent(members[1])}`
      : "/bwf/h2h";
  }
  return "/bwf/players";
}

export function formBoardRowFromRating(
  rating: FormRating,
  knownIds: Set<string> = new Set(),
): FormBoardRow | null {
  if (rating.kind !== "player" && rating.kind !== "pair") return null;
  if (rating.rankScore == null || Number.isNaN(rating.rankScore)) return null;
  const webId = rating.webId ?? "";
  const name = rating.name ?? webId;
  return {
    id: `${webId}|${rating.disc}`,
    name: name || webId || "Unknown",
    country: null,
    disc: rating.disc,
    kind: rating.kind,
    mu: rating.mu,
    rd: rating.rd ?? null,
    rankScore: rating.rankScore,
    peakMu: rating.peakMu ?? null,
    matches: rating.matches,
    href: formBoardHref(rating.kind, webId, knownIds),
  };
}

export function formBoardRowFromSql(
  row: FormBoardSqlRow,
  knownIds: Set<string> = new Set(),
): FormBoardRow | null {
  if (row.kind !== "player" && row.kind !== "pair") return null;
  if (row.rank_score == null || Number.isNaN(row.rank_score)) return null;
  if (!DISC_SET.has(row.discipline)) return null;
  return formBoardRowFromRating(
    {
      disc: row.discipline as Disc,
      kind: row.kind,
      mu: row.mu,
      rd: row.rd ?? undefined,
      rankScore: row.rank_score,
      peakMu: row.peak_mu ?? undefined,
      matches: row.matches,
      webId: row.web_id,
      name: row.display_name ?? undefined,
    },
    knownIds,
  );
}

export function mapFormBoardRows(
  rows: FormBoardSqlRow[],
  knownIds: Set<string> = new Set(),
): FormBoardRow[] {
  const out: FormBoardRow[] = [];
  for (const row of rows) {
    const mapped = formBoardRowFromSql(row, knownIds);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function buildFormBoard(
  ratingsByKey: Map<string, FormRating>,
  knownIds: Set<string>,
  opts?: { disc?: Disc | "all"; q?: string; limit?: number },
): { rows: FormBoardRow[]; total: number } {
  const disc = opts?.disc && opts.disc !== "all" ? opts.disc : null;
  const q = opts?.q?.trim().toLowerCase() ?? "";
  const limit = opts?.limit ?? 80;
  const rows: FormBoardRow[] = [];
  for (const rating of ratingsByKey.values()) {
    if (disc && rating.disc !== disc) continue;
    const name = rating.name ?? rating.webId ?? "";
    if (q && !name.toLowerCase().includes(q)) continue;
    const row = formBoardRowFromRating(rating, knownIds);
    if (row) rows.push(row);
  }
  rows.sort(
    (a, b) =>
      b.rankScore - a.rankScore ||
      b.matches - a.matches ||
      a.name.localeCompare(b.name),
  );
  return { rows: rows.slice(0, limit), total: rows.length };
}
