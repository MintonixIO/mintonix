/**
 * Pure unit tests for stage artifact helpers (no network / Supabase).
 *
 *   deno test supabase/functions/ops/stage_outputs_test.ts
 */
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  outputsToPurge,
  relativeBasename,
  STAGE_OUTPUTS,
  isStage,
} from "./stage_outputs.ts";

Deno.test("outputsToPurge normalize includes later stages", () => {
  const got = [...outputsToPurge("normalize")].sort();
  assertEquals(got, [
    "analysis.json",
    "detections.json",
    "frame_manifest.csv",
    "frame_ranges.csv",
    "normalized.mp4",
    "scores.csv",
    "thumbnail.jpg",
    "valid.mp4",
  ].sort());
});

Deno.test("outputsToPurge detect", () => {
  assertEquals(
    [...outputsToPurge("detect")].sort(),
    ["analysis.json", "detections.json"].sort(),
  );
});

Deno.test("outputsToPurge analyze", () => {
  assertEquals([...outputsToPurge("analyze")], ["analysis.json"]);
});

Deno.test("relativeBasename requires prefix and flat key", () => {
  const prefix = "bwf/m1/";
  assertEquals(relativeBasename("bwf/m1/detections.json", prefix), "detections.json");
  assertEquals(relativeBasename("bwf/other/detections.json", prefix), null);
  assertEquals(relativeBasename("bwf/m1/nested/x.json", prefix), null);
  assertEquals(relativeBasename("bwf/m1/", prefix), null);
});

Deno.test("STAGE_OUTPUTS golden shape", () => {
  assertEquals(STAGE_OUTPUTS.detect, ["detections.json"]);
  assertEquals(STAGE_OUTPUTS.analyze, ["analysis.json"]);
  assert(STAGE_OUTPUTS.normalize.includes("normalized.mp4"));
  assert(STAGE_OUTPUTS.normalize.includes("frame_ranges.csv"));
  assert(isStage("normalize"));
  assert(!isStage("nope"));
});
