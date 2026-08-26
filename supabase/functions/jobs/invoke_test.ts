import {
  assertEquals,
  assertRejects,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ROUTE_TICK_MS,
  WARMING_PREFIX,
  warmingError,
  warmingExpired,
  warmingSinceIso,
  WarmingError,
  WorkerHttpError,
  isWorkerStarted,
  invokeFailurePolicy,
  callbackRetry,
} from "./warming.ts";
import { invokeVast, type InvokeFetch, type InvokeVastOpts } from "./invoke.ts";

const START_ISO = "2026-08-25T00:00:00.000Z";
const START_MS = Date.parse(START_ISO);

Deno.test("ROUTE_TICK_MS is 25s per dispatch tick", () => {
  assertEquals(ROUTE_TICK_MS, 25_000);
  assertEquals(WARMING_PREFIX, "warming:");
});

Deno.test("warmingError prefixes ISO with warming:", () => {
  assertEquals(warmingError(START_ISO), `warming:${START_ISO}`);
});

Deno.test("warmingExpired: 19 min not expired; 21 min expired; non-warming false", () => {
  const err = warmingError(START_ISO);
  assertEquals(warmingExpired(err, START_MS + 19 * 60_000), false);
  assertEquals(warmingExpired(err, START_MS + 20 * 60_000), false);
  assertEquals(warmingExpired(err, START_MS + 21 * 60_000), true);
  assertEquals(warmingExpired("invoke: boom", START_MS + 21 * 60_000), false);
  assertEquals(warmingExpired(null, START_MS + 21 * 60_000), false);
  assertEquals(warmingExpired("warming:not-a-date", START_MS), true);
});

Deno.test("warmingSinceIso keeps existing warming ISO and otherwise uses now", () => {
  assertEquals(warmingSinceIso(`warming:${START_ISO}`, "2026-08-25T00:05:00.000Z"), START_ISO);
  assertEquals(warmingSinceIso(null, "2026-08-25T00:05:00.000Z"), "2026-08-25T00:05:00.000Z");
  assertEquals(warmingSinceIso("invoke: fail", "2026-08-25T00:05:00.000Z"), "2026-08-25T00:05:00.000Z");
});

Deno.test("isWorkerStarted accepts 202 and 200 only", () => {
  assertEquals(isWorkerStarted(202), true);
  assertEquals(isWorkerStarted(200), true);
  assertEquals(isWorkerStarted(503), false);
  assertEquals(isWorkerStarted(422), false);
  assertEquals(isWorkerStarted(500), false);
});

Deno.test("invokeFailurePolicy: warming retries until expired; 503 retries; 4xx does not", () => {
  const warming = new WarmingError(START_ISO);
  assertEquals(invokeFailurePolicy(warming, START_MS + 19 * 60_000, 1, 3), {
    retry: true,
    warming: true,
    error: `warming:${START_ISO}`,
  });
  assertEquals(invokeFailurePolicy(warming, START_MS + 21 * 60_000, 1, 3), {
    retry: false,
    warming: false,
    error: `warming:${START_ISO}`,
  });

  const s503 = invokeFailurePolicy(
    new WorkerHttpError("/detect/sync", 503, "models not loaded"),
    START_MS,
    1,
    3,
  );
  assertEquals(s503.retry, true);
  assertEquals(s503.warming, false);

  const s422 = invokeFailurePolicy(
    new WorkerHttpError("/detect/sync", 422, "bad envelope"),
    START_MS,
    1,
    3,
  );
  assertEquals(s422.retry, false);
  assertEquals(s422.warming, false);

  const last503 = invokeFailurePolicy(
    new WorkerHttpError("/detect/sync", 503, "models not loaded"),
    START_MS,
    3,
    3,
  );
  assertEquals(last503.retry, false);
  assertEquals(last503.warming, false);
});

Deno.test("callbackRetry: worker-reported failures are terminal", () => {
  // After HTTP 202 the GPU ran; TRT/clamp/empty-segments must not requeue.
  // Warming/503 retries stay on invokeFailurePolicy, not /jobs/callback.
  assertEquals(callbackRetry(false, 1, 3), false);
  assertEquals(callbackRetry(false, 2, 3), false);
  assertEquals(callbackRetry(true, 1, 3), false);
  assertEquals(callbackRetry(false, 3, 3), false);
});

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    elapsed: () => t - start,
  };
}

function invokeOpts(overrides: Partial<InvokeVastOpts> & {
  fetch: InvokeVastOpts["fetch"];
}): InvokeVastOpts {
  return {
    env: {
      get(key: string) {
        const m: Record<string, string> = {
          VAST_DETECT_ENDPOINT_NAME: "VIDEO-DETECTION-DEV",
          VAST_API_KEY: "account-key",
          VAST_AUTOSCALER_URL: "https://run.vast.ai",
        };
        return m[key];
      },
    },
    resolveEndpointKey: async () => "endpoint-key",
    isoNow: () => "2026-08-25T00:05:00.000Z",
    ...overrides,
  };
}

Deno.test("invokeVast throws WarmingError after ROUTE_TICK_MS with no worker url", async () => {
  const c = fakeClock();
  let routeCalls = 0;
  const err = await assertRejects(
    () =>
      invokeVast(
        "/detect/sync",
        { request_id: "j" },
        "j",
        "VAST_DETECT_ENDPOINT_NAME",
        invokeOpts({
          now: c.now,
          sleep: c.sleep,
          fetch: async (input: Parameters<InvokeFetch>[0]) => {
            const url = String(input);
            if (url.includes("/route/")) {
              routeCalls++;
              return jsonResp(200, { request_idx: routeCalls });
            }
            throw new Error(`unexpected fetch ${url}`);
          },
        }),
      ),
    WarmingError,
  );
  assertEquals(err.message, "warming:2026-08-25T00:05:00.000Z");
  assert(routeCalls >= 1);
  assert(c.elapsed() >= ROUTE_TICK_MS);
});

Deno.test("invokeVast WarmingError keeps prior warming ISO", async () => {
  const c = fakeClock();
  const err = await assertRejects(
    () =>
      invokeVast(
        "/detect/sync",
        {},
        "j",
        "VAST_DETECT_ENDPOINT_NAME",
        invokeOpts({
          priorError: "warming:2026-08-25T00:00:00.000Z",
          now: c.now,
          sleep: c.sleep,
          isoNow: () => "2026-08-25T00:19:00.000Z",
          fetch: async () => jsonResp(200, { request_idx: 1 }),
        }),
      ),
    WarmingError,
  );
  assertEquals(err.message, "warming:2026-08-25T00:00:00.000Z");
});

Deno.test("invokeVast /route/ HTTP error is not warming", async () => {
  const c = fakeClock();
  await assertRejects(
    () =>
      invokeVast(
        "/detect/sync",
        {},
        "j",
        "VAST_DETECT_ENDPOINT_NAME",
        invokeOpts({
          now: c.now,
          sleep: c.sleep,
          fetch: async () =>
            new Response("no capacity", { status: 429 }),
        }),
      ),
    Error,
    "vast /route/ failed: 429",
  );
});

async function assertDoesNotHang(p: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: invokeVast drained held body`)),
      200,
    );
  });
  try {
    await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

Deno.test("invokeVast treats 202 as started and does not drain the held body", async () => {
  let workerPosts = 0;
  const stream = new ReadableStream<Uint8Array>({ start() { /* held until GPU+callback */ } });
  const c = fakeClock();
  await assertDoesNotHang(
    invokeVast(
      "/detect/sync",
      { request_id: "j" },
      "j",
      "VAST_DETECT_ENDPOINT_NAME",
      invokeOpts({
        now: c.now,
        sleep: c.sleep,
        fetch: async (input: Parameters<InvokeFetch>[0]) => {
          const url = String(input);
          if (url.includes("/route/")) {
            return jsonResp(200, { url: "https://worker.example", req_num: 1 });
          }
          workerPosts++;
          assert(url === "https://worker.example/detect/sync");
          return new Response(stream, { status: 202 });
        },
      }),
    ),
    "202",
  );
  assertEquals(workerPosts, 1);
});

Deno.test("invokeVast treats 200 as started (preprocess / old image) without draining", async () => {
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const c = fakeClock();
  await assertDoesNotHang(
    invokeVast(
      "/preprocess/sync",
      {},
      "j",
      "VAST_PREPROCESS_ENDPOINT_NAME",
      invokeOpts({
        now: c.now,
        sleep: c.sleep,
        env: {
          get(key: string) {
            const m: Record<string, string> = {
              VAST_PREPROCESS_ENDPOINT_NAME: "VIDEO-PREPROCESS-DEV",
              VAST_API_KEY: "account-key",
              VAST_AUTOSCALER_URL: "https://run.vast.ai",
            };
            return m[key];
          },
        },
        fetch: async (input: Parameters<InvokeFetch>[0]) => {
          const url = String(input);
          if (url.includes("/route/")) {
            return jsonResp(200, { url: "https://worker.example" });
          }
          assert(url.endsWith("/preprocess/sync"));
          return new Response(stream, { status: 200 });
        },
      }),
    ),
    "200",
  );
});

Deno.test("invokeVast 503 is retryable WorkerHttpError, not warming", async () => {
  const c = fakeClock();
  const err = await assertRejects(
    () =>
      invokeVast(
        "/detect/sync",
        {},
        "j",
        "VAST_DETECT_ENDPOINT_NAME",
        invokeOpts({
          now: c.now,
          sleep: c.sleep,
          fetch: async (input: Parameters<InvokeFetch>[0]) => {
            if (String(input).includes("/route/")) {
              return jsonResp(200, { url: "https://worker.example" });
            }
            return new Response("models not loaded", { status: 503 });
          },
        }),
      ),
    WorkerHttpError,
  );
  assertEquals(err.status, 503);
  assertEquals(err.retry, true);
});

Deno.test("invokeVast 422 is terminal WorkerHttpError", async () => {
  const c = fakeClock();
  const err = await assertRejects(
    () =>
      invokeVast(
        "/detect/sync",
        {},
        "j",
        "VAST_DETECT_ENDPOINT_NAME",
        invokeOpts({
          now: c.now,
          sleep: c.sleep,
          fetch: async (input: Parameters<InvokeFetch>[0]) => {
            if (String(input).includes("/route/")) {
              return jsonResp(200, { url: "https://worker.example" });
            }
            return new Response("bad envelope", { status: 422 });
          },
        }),
      ),
    WorkerHttpError,
  );
  assertEquals(err.status, 422);
  assertEquals(err.retry, false);
});
