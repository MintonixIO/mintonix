/**
 * Allowlist for CI model-cache delivery keys.
 * Only objects under models/ (bucket root prefix) may be minted via ops/model-urls.
 *
 * Layout: s3://mintonix-{dev,prod}/models/<filename>
 */

export const MODEL_CACHE_PREFIX = "models/";

/** Same character class as cdn-access isValidKey (no leading slash, no ..). */
export function isModelCacheKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.startsWith("/") || key.includes("..")) return false;
  if (!key.startsWith(MODEL_CACHE_PREFIX)) return false;
  // models/<file> — exactly two non-empty segments.
  const parts = key.split("/");
  if (parts.length !== 2) return false;
  if (parts.some((p) => !p)) return false;
  // Filename only: no nested paths under models/.
  if (parts[1].includes("/")) return false;
  return /^[A-Za-z0-9!_.*'()\-]+$/.test(parts[1]);
}
