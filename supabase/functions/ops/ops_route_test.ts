import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opsRoute } from "./ops_route.ts";

Deno.test("opsRoute prefers explicit subpath", () => {
  assertEquals(
    opsRoute("/functions/v1/ops/model-urls", { keys: ["models/a.engine"] }),
    "model-urls",
  );
  assertEquals(
    opsRoute("/functions/v1/ops/set-stage", { match_id: "m1", stage: "detect" }),
    "set-stage",
  );
  assertEquals(opsRoute("/ops/model-urls", {}), "model-urls");
  assertEquals(opsRoute("/ops/set-stage/", {}), "set-stage");
});

Deno.test("opsRoute falls back to body when gateway strips subpath", () => {
  assertEquals(
    opsRoute("/functions/v1/ops", { keys: ["models/yolo26x-pose.engine"] }),
    "model-urls",
  );
  assertEquals(
    opsRoute("/ops", { keys: ["models/yolo26x-pose.engine"] }),
    "model-urls",
  );
  assertEquals(
    opsRoute("/ops", { match_id: "abc", stage: "normalize" }),
    "set-stage",
  );
});

Deno.test("opsRoute unknown when neither path nor body is a known op", () => {
  assertEquals(opsRoute("/ops", {}), "unknown");
  assertEquals(opsRoute("/functions/v1/ops", { foo: 1 }), "unknown");
});

Deno.test("opsRoute set-stage wins over keys if both present", () => {
  assertEquals(
    opsRoute("/ops", { match_id: "m1", keys: ["models/x.engine"] }),
    "set-stage",
  );
});
