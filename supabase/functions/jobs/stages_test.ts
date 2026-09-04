import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callbackCompleteJobParams,
  completeJobStageFields,
  normalizeOutputKeys,
  settleDetect,
  settleNormalize,
  type Settlement,
} from "./stages.ts";

const PROBES = { duration: 12.5, width: 1920, height: 1080, fps: 30 };

Deno.test("normalize success completes at detect with no requeue", () => {
  const s = settleNormalize({}, PROBES, true);
  assertEquals(s.next, null);
  assertEquals(s.complete_stage, "detect");
  assertEquals(s.match.status, "ready");
  assertEquals(s.match.duration_sec, 12.5);
  assertEquals(s.match.width, 1920);
  assertEquals(s.match.height, 1080);
  assertEquals(s.match.fps, 30);

  const rpc = callbackCompleteJobParams(s, true);
  assertEquals(rpc.p_status, "complete");
  assertEquals(rpc.p_error, null);
  assertEquals(rpc.p_match.status, "ready");
  assertEquals(rpc.p_next_stage, null);
  assertEquals(rpc.p_complete_stage, "detect");
});

Deno.test("normalize success must not send p_next_stage=detect", () => {
  const rpc = callbackCompleteJobParams(settleNormalize({}, PROBES, true), true);
  assertEquals(rpc.p_next_stage === "detect", false);
  assertEquals(rpc.p_complete_stage, "detect");
});

Deno.test("normalize failure applies probes without ready/jump", () => {
  const s = settleNormalize({}, PROBES, false);
  assertEquals(s.next, null);
  assertEquals(s.complete_stage, undefined);
  assertEquals(s.match.status, undefined);
  assertEquals(s.match.duration_sec, 12.5);
  assertEquals(s.match.width, 1920);
  const rpc = callbackCompleteJobParams(s, false, "gpu exploded");
  assertEquals(rpc.p_status, "failed");
  assertEquals(rpc.p_error, "gpu exploded");
  assertEquals(rpc.p_match.duration_sec, 12.5);
  assertEquals(rpc.p_next_stage, null);
  assertEquals(rpc.p_complete_stage, null);
});

Deno.test("detect-only success carries probes and does not jump", () => {
  const s = settleDetect({}, { frame_count: 9, width: 1280, height: 720, fps: 25 }, true);
  assertEquals(s.next, null);
  assertEquals(s.complete_stage, undefined);
  assertEquals(s.match.status, "ready");
  assertEquals(s.match.width, 1280);
  assertEquals(s.match.height, 720);
  assertEquals(s.match.fps, 25);
  const rpc = callbackCompleteJobParams(s, true);
  assertEquals(rpc.p_status, "complete");
  assertEquals(rpc.p_next_stage, null);
  assertEquals(rpc.p_complete_stage, null);
  assertEquals(rpc.p_match.width, 1280);
  assertEquals(rpc.p_match.status, "ready");
});

Deno.test("detect-only failure does not jump or requeue", () => {
  const rpc = callbackCompleteJobParams(settleDetect({}, {}, false), false);
  assertEquals(rpc.p_next_stage, null);
  assertEquals(rpc.p_complete_stage, null);
  assertEquals(rpc.p_status, "failed");
});

Deno.test("completeJobStageFields rejects next + complete_stage together", () => {
  const bad: Settlement = {
    match: { status: "ready" },
    next: { stage: "detect" },
    complete_stage: "detect",
  };
  assertThrows(
    () => completeJobStageFields(bad),
    Error,
    "mutually exclusive",
  );
});

Deno.test("normalize envelope keys include detections.json", () => {
  const keys = normalizeOutputKeys("bwf/abc/");
  assertEquals(keys.video, "bwf/abc/normalized.mp4");
  assertEquals(keys.thumbnail, "bwf/abc/thumbnail.jpg");
  assertEquals(keys.log, "bwf/abc/preprocess-log.json");
  assertEquals(keys.detections, "bwf/abc/detections.json");
});

Deno.test("index.ts wires detections_upload_url and p_complete_stage", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(src.includes("detections_upload_url"), true);
  assertEquals(src.includes("keys.detections"), true);
  assertEquals(src.includes("p_complete_stage: rpc.p_complete_stage"), true);
  assertEquals(src.includes("callbackCompleteJobParams"), true);
  assertEquals(src.includes('next: { stage: "detect" }'), false);
});
