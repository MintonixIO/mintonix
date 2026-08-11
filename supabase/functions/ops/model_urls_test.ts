import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isModelCacheKey, MODEL_CACHE_PREFIX } from "./model_urls.ts";

Deno.test("MODEL_CACHE_PREFIX", () => {
  assertEquals(MODEL_CACHE_PREFIX, "models/video-det/");
});

Deno.test("isModelCacheKey accepts versioned product keys", () => {
  assertEquals(
    isModelCacheKey("models/video-det/2026-08-11-fp16/yolo26x-pose.engine"),
    true,
  );
  assertEquals(
    isModelCacheKey("models/video-det/v1/tracknetv5.pt"),
    true,
  );
});

Deno.test("isModelCacheKey rejects outside prefix and traversal", () => {
  assertEquals(isModelCacheKey("users/u/m/original.mp4"), false);
  assertEquals(isModelCacheKey("bwf/m/original.mp4"), false);
  assertEquals(isModelCacheKey("models/other/x.pt"), false);
  assertEquals(isModelCacheKey("models/video-det/file.pt"), false); // no version segment
  assertEquals(isModelCacheKey("models/video-det/../etc/passwd"), false);
  assertEquals(isModelCacheKey("/models/video-det/v1/x.pt"), false);
  assertEquals(isModelCacheKey(""), false);
});
