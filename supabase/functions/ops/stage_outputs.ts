/**
 * Pure stage ↔ artifact helpers for ops purge.
 * SSOT: ARCHITECTURE.md § One job contract / Stage artifacts
 * (mirrored in scripts/ops_stage.py).
 *
 * No npm imports — unit-tested via `deno test supabase/functions/ops/stage_outputs_test.ts`.
 */

export const STAGE_ORDER = ["normalize", "detect", "analyze"] as const;
export type Stage = (typeof STAGE_ORDER)[number];

/** Live + legacy basenames deleted when regressing to this stage (or later). */
export const STAGE_OUTPUTS: Record<Stage, readonly string[]> = {
  normalize: [
    "normalized.mp4",
    "thumbnail.jpg",
    // Live BWF compact range map (jobs + video-normalization).
    "frame_ranges.csv",
    // Legacy / deferred names still possible in older buckets.
    "valid.mp4",
    "frame_manifest.csv",
    "scores.csv",
  ],
  detect: ["detections.json"],
  analyze: ["analysis.json"],
};

/** Basenames to delete when regressing *to* `stage` (that stage + all later). */
export function outputsToPurge(stage: Stage): Set<string> {
  const idx = STAGE_ORDER.indexOf(stage);
  const out = new Set<string>();
  for (let i = idx; i < STAGE_ORDER.length; i++) {
    for (const name of STAGE_OUTPUTS[STAGE_ORDER[i]]) out.add(name);
  }
  return out;
}

/**
 * Relative basename under prefix for DELETE eligibility.
 * Returns null if key is outside prefix or is nested (not a single basename).
 */
export function relativeBasename(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const rel = key.slice(prefix.length);
  if (!rel || rel.includes("/")) return null;
  return rel;
}

export function isStage(s: string): s is Stage {
  return (STAGE_ORDER as readonly string[]).includes(s);
}
