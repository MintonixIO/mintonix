/**
 * Pure match-detail lookup outcomes (no Next cache / Supabase).
 * Used by server `getMatchById` and unit-tested for the 404-vs-error contract.
 */
import { mapDbMatch, type DbMatchRow } from "./parse";
import type { CatalogMatch } from "./types";

/** PostgREST missing-column / schema-cache failures. */
export function isMissingColumnError(message: string): boolean {
  return /does not exist|schema cache/i.test(message);
}

/**
 * Resolve getMatchById from a direct single-row fetch.
 *
 * 1. Direct error → throw (fail closed; never page the catalog dump)
 * 2. Direct hit → mapped match
 * 3. Confirmed miss → null
 */
export function resolveMatchByIdOutcome(
  directData: DbMatchRow | null,
  directError: { message: string } | null,
): CatalogMatch | null {
  if (directError) {
    throw new Error(`BWF match load failed: ${directError.message}`);
  }
  if (directData) return mapDbMatch(directData);
  return null;
}
