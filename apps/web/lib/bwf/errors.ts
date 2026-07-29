/** User-facing catalog failure copy (never includes backend internals). */
export const CATALOG_UNAVAILABLE_MESSAGE =
  "We could not load the BWF match catalog right now. Please try again in a moment.";

/** Log full error server-side; return a safe generic message for the UI. */
export function catalogUserError(err: unknown, scope = "bwf"): string {
  console.error(`[${scope}]`, err instanceof Error ? err.message : err);
  return CATALOG_UNAVAILABLE_MESSAGE;
}
