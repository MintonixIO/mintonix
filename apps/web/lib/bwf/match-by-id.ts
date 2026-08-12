/**
 * Pure match-detail lookup outcomes (no Next cache / Supabase).
 * Used by server `getMatchById` and unit-tested for the 404-vs-error contract.
 */
import { mapDbMatch, type DbMatchRow } from "./parse";
import type { CatalogMatch } from "./types";

/** Result of an optional warm-snapshot lookup for one match id. */
export type SnapshotAttempt =
  | { status: "hit"; match: CatalogMatch }
  | { status: "miss" }
  | { status: "error"; error?: unknown };

/**
 * Resolve getMatchById from a direct single-row fetch + optional snapshot.
 *
 * 1. Direct hit → mapped match
 * 2. Confirmed primary miss (`!directError`) → null (no snapshot — true 404)
 * 3. Direct error → snapshot hit, else rethrow catalog load failure
 */
export function resolveMatchByIdOutcome(
  directData: DbMatchRow | null,
  directError: { message: string } | null,
  snapshot: SnapshotAttempt,
): CatalogMatch | null {
  if (directData && !directError) {
    return mapDbMatch(directData);
  }

  // Confirmed primary miss (successful query, zero rows) — never load snapshot.
  if (!directError) {
    return null;
  }

  // Direct fetch errored — snapshot is recovery only.
  if (snapshot.status === "hit") return snapshot.match;
  throw new Error(`BWF match load failed: ${directError.message}`, {
    cause: snapshot.status === "error" ? snapshot.error : undefined,
  });
}
