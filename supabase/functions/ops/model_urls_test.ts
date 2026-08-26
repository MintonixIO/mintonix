import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isModelCacheKey, MODEL_CACHE_PREFIX } from "./model_urls.ts";

Deno.test("MODEL_CACHE_PREFIX", () => {
  assertEquals(MODEL_CACHE_PREFIX, "models/");
});

Deno.test("isModelCacheKey accepts flat product keys", () => {
  assertEquals(isModelCacheKey("models/yolo26x-pose.engine"), true);
  assertEquals(isModelCacheKey("models/tracknetv5.pt"), true);
  assertEquals(isModelCacheKey("models/tracknetv5_fp16_b48.engine"), true);
});

Deno.test("isModelCacheKey rejects outside prefix, nesting, and traversal", () => {
  assertEquals(isModelCacheKey("users/u/m/original.mp4"), false);
  assertEquals(isModelCacheKey("bwf/m/original.mp4"), false);
  assertEquals(isModelCacheKey("models/video-det/v1/x.pt"), false); // nested
  assertEquals(isModelCacheKey("models/"), false);
  assertEquals(isModelCacheKey("models"), false);
  assertEquals(isModelCacheKey("models/../etc/passwd"), false);
  assertEquals(isModelCacheKey("/models/x.pt"), false);
  assertEquals(isModelCacheKey(""), false);
});
