/**
 * Allowlist for CI model-cache delivery keys.
 * Only objects under models/video-det/ may be minted via ops/model-urls.
 */

export const MODEL_CACHE_PREFIX = "models/video-det/";

/** Same character class as cdn-access isValidKey (no leading slash, no ..). */
export function isModelCacheKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.startsWith("/") || key.includes("..")) return false;
  if (!key.startsWith(MODEL_CACHE_PREFIX)) return false;
  // models/video-det/<version>/<file> — at least 4 segments, non-empty.
  const parts = key.split("/");
  if (parts.length < 4) return false;
  if (parts.some((p) => !p)) return false;
  return /^[A-Za-z0-9!_.*'()/\-]+$/.test(key);
}
