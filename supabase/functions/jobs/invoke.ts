/**
 * Vast /route/ + worker invoke. Resolves once /preprocess/sync or
 * /detect/sync returns 202 headers. Does not drain a held response body.
 * Both GPU routes use VAST_PREPROCESS_ENDPOINT_NAME.
 */
import {
  isWorkerStarted,
  ROUTE_TICK_MS,
  WarmingError,
  warmingSinceIso,
  WorkerHttpError,
} from "./warming.ts";

export type InvokeEnv = {
  get(key: string): string | undefined;
};

export type InvokeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type InvokeVastOpts = {
  priorError?: string | null;
  now?: () => number;
  isoNow?: () => string;
  sleep?: (ms: number) => Promise<void>;
  fetch?: InvokeFetch;
  env?: InvokeEnv;
  resolveEndpointKey?: (endpoint: string, accountKey: string) => Promise<string>;
  tlsClient?: Deno.HttpClient;
};

const defaultEnv: InvokeEnv = { get: (key) => Deno.env.get(key) };

let vastClient: Deno.HttpClient | null | undefined;
function getVastClient(env: InvokeEnv): Deno.HttpClient | undefined {
  if (vastClient !== undefined) return vastClient ?? undefined;
  const ca = env.get("VAST_TLS_CA");
  if (!ca) {
    vastClient = null;
    return undefined;
  }
  try {
    vastClient = Deno.createHttpClient({ caCerts: [ca] });
  } catch (e) {
    console.warn(`VAST_TLS_CA set but createHttpClient unavailable (${e}); using default TLS roots`);
    vastClient = null;
  }
  return vastClient ?? undefined;
}

let endpointKeyCache: { name: string; key: string; fetchedAt: number } | null = null;

async function resolveEndpointKey(
  endpointName: string,
  accountKey: string,
  doFetch: InvokeFetch,
  now: () => number,
): Promise<string> {
  const t = now();
  if (
    endpointKeyCache && endpointKeyCache.name === endpointName &&
    t - endpointKeyCache.fetchedAt < 3600_000
  ) {
    return endpointKeyCache.key;
  }
  const resp = await doFetch("https://console.vast.ai/api/v0/endptjobs/", {
    headers: { Authorization: `Bearer ${accountKey}` },
  });
  if (!resp.ok) throw new Error(`vast endptjobs failed: ${resp.status}`);
  const data = await resp.json() as {
    results?: Array<{ endpoint_name: string; api_key: string }>;
  };
  const match = data.results?.find((r) => r.endpoint_name === endpointName);
  if (!match) throw new Error(`vast endpoint '${endpointName}' not found on this account`);
  endpointKeyCache = { name: endpointName, key: match.api_key, fetchedAt: t };
  return match.api_key;
}

/** Sole vast serverless GPU endpoint. No detect/normalize/legacy aliases. */
export function resolveVastEndpointName(env: InvokeEnv): {
  name: string | undefined;
  usedEnv: string;
} {
  return {
    name: env.get("VAST_PREPROCESS_ENDPOINT_NAME"),
    usedEnv: "VAST_PREPROCESS_ENDPOINT_NAME",
  };
}

export async function invokeVast(
  route: string,
  envelope: Record<string, unknown>,
  jobId: string,
  opts: InvokeVastOpts = {},
): Promise<void> {
  const env = opts.env ?? defaultEnv;
  const now = opts.now ?? Date.now;
  const isoNow = opts.isoNow ?? (() => new Date().toISOString());
  const sleep = opts.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const doFetch = opts.fetch ?? (globalThis.fetch as InvokeFetch);

  const { name: endpoint, usedEnv } = resolveVastEndpointName(env);
  const accountKey = env.get("VAST_API_KEY");
  if (!endpoint || !accountKey) {
    throw new Error(`${usedEnv} / VAST_API_KEY not configured`);
  }
  const apiKey = await (opts.resolveEndpointKey
    ? opts.resolveEndpointKey(endpoint, accountKey)
    : resolveEndpointKey(endpoint, accountKey, doFetch, now));
  const autoscaler = env.get("VAST_AUTOSCALER_URL") ?? "https://run.vast.ai";

  let requestIdx = 0;
  let auth: Record<string, unknown> | null = null;
  let delay = 1000;
  const deadline = now() + ROUTE_TICK_MS;
  while (now() < deadline) {
    const resp = await doFetch(`${autoscaler}/route/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        endpoint,
        api_key: apiKey,
        cost: 10000,
        request_idx: requestIdx,
        replay_timeout: 60,
      }),
    });
    if (!resp.ok) {
      throw new Error(`vast /route/ failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    }
    const body = await resp.json() as Record<string, unknown>;
    requestIdx = (body.request_idx as number) ?? requestIdx;
    if (body.url) {
      auth = body;
      break;
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
  if (!auth) {
    throw new WarmingError(warmingSinceIso(opts.priorError ?? null, isoNow()));
  }

  console.log(JSON.stringify({ event: "dispatch.routed", jobId, worker: auth.url }));
  const tlsClient = "tlsClient" in opts ? opts.tlsClient : getVastClient(env);
  const workerResp = await doFetch(`${auth.url}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ auth_data: auth, session_id: null, payload: { input: envelope } }),
    ...(tlsClient ? { client: tlsClient } : {}),
  } as RequestInit);

  if (isWorkerStarted(workerResp.status)) {
    console.log(JSON.stringify({
      event: "dispatch.worker_started",
      jobId,
      status: workerResp.status,
    }));
    // Drop the unread body (Task 1 holds the worker-side job). Cancel so the
    // isolate does not keep the connection open until GPU+callback finish.
    try {
      await workerResp.body?.cancel();
    } catch {
      // already closed
    }
    return;
  }

  const workerBody = (await workerResp.text()).slice(0, 500);
  console.log(JSON.stringify({
    event: "dispatch.worker_responded",
    jobId,
    status: workerResp.status,
    body: workerBody,
  }));
  throw new WorkerHttpError(route, workerResp.status, workerBody);
}
