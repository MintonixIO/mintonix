/**
 * matches-ingest — front door of the match pipeline.
 *
 * Every producer that wants a match to exist and be processed calls this ONE
 * endpoint: BWF scraper / backlog (pipeline token), and the web app's upload
 * confirm (user JWT). Insert/upsert + job enqueue happen together in the
 * `ingest_match` RPC. Dispatch is deliberately NOT here (see the jobs
 * function).
 *
 * POST /functions/v1/matches-ingest   (verify_jwt=false; auth is in-function)
 *
 * System / BWF (pipeline token):
 *   headers: x-pipeline-token: <PIPELINE_SERVICE_TOKEN>
 *   body: {
 *     "id":            "<match id>",            // content-hash or stable key
 *     "source_url":    "https://youtu.be/…",    // optional
 *     "tournament":    "2026 All England Open-WS-Final",
 *     "match_date":    "2026-03-15",
 *     "team1_player1": "…", "team1_player2": null,
 *     "team2_player1": "…", "team2_player2": null,
 *     "g1_t1": 21, "g1_t2": 19, …,
 *     "queue": "jobs_bulk" | "jobs_interactive",
 *     "priority": 100,
 *     "upsert": true                              // BWF re-scrape
 *   }
 *   -> 200 { "match_id", "job_id", "b2_prefix" }
 *   B2 prefix is constructable: bwf/<match_id>/
 *   System ingest is refused if the id is already user-owned.
 *
 * User upload confirm (user JWT) — client already PUT original via cdn-access:
 *   headers: Authorization: Bearer <user access token>
 *   body: {
 *     "id":     "<client-generated UUID>",
 *     "ext":    "mp4",   // must be mp4; object key is original.mp4
 *     "upload": true     // optional if Authorization present without pipeline token
 *   }
 *   -> 200 { "match_id", "job_id", "b2_prefix" }
 *   B2 prefix: users/<uid>/<match_id>/
 *   Queue/priority are hardcoded (jobs_interactive / 10); body fields ignored.
 *   Idempotent: re-confirm while live returns already_queued; after terminal
 *   job, re-enqueues a new run for the same match.
 *
 * MVP: does not HEAD/verify the B2 object exists before enqueue (accept-as-
 * designed; empty keys will fail at normalize). Cap live jobs per owner is a
 * follow-up if abuse appears.
 *
 * Secrets: PIPELINE_SERVICE_TOKEN.
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY injected.
 */

// npm: (not esm.sh) — CI/deploy bundle must not depend on a live CDN (522s).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time compare via SHA-256 so length mismatch does not short-circuit. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

interface IngestBody {
  id?: string;
  source_url?: string | null;
  tournament?: string | null;
  match_date?: string | null;
  team1_player1?: string | null;
  team1_player2?: string | null;
  team2_player1?: string | null;
  team2_player2?: string | null;
  g1_t1?: number | null;
  g1_t2?: number | null;
  g2_t1?: number | null;
  g2_t2?: number | null;
  g3_t1?: number | null;
  g3_t2?: number | null;
  queue?: string;
  priority?: number;
  upsert?: boolean;
  /** User-upload only: must be mp4 (object is always original.mp4). */
  ext?: string;
  /** When true (or Authorization without pipeline token), treat as user confirm. */
  upload?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSystemMatchId(id: string): boolean {
  // Content hashes (hex) or other stable keys; keep permissive but bounded.
  return /^[A-Za-z0-9_.:\-]{8,128}$/.test(id);
}

function isUserMatchId(id: string): boolean {
  // Prefer UUID so users cannot squat BWF content-hash ids.
  return UUID_RE.test(id);
}

async function handleUserUpload(
  request: Request,
  body: IngestBody,
): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anon.auth.getUser();
  if (authError || !user) return json(401, { error: "Not authenticated" });

  const id = body.id ?? "";
  if (!isUserMatchId(id)) {
    return json(400, {
      error: "id is required and must be a UUID (client-generated match id)",
    });
  }

  // User lane always uses original.mp4 under users/<uid>/<match_id>/.
  const ext = (body.ext ?? "mp4").toLowerCase();
  if (ext !== "mp4") {
    return json(400, {
      error: "user uploads must use original.mp4 (ext must be mp4)",
    });
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Queue/priority hardcoded — RPC also forces this for any p_owner_id set.
  const { data, error } = await service.rpc("ingest_match", {
    p_id: id,
    p_owner_id: user.id,
    p_source_url: null,
    p_queue: "jobs_interactive",
    p_priority: 10,
    p_upsert: true, // idempotent re-confirm; ownership enforced in RPC
  });
  if (error) {
    const msg = error.message ?? "";
    if (/owned by another user|system-owned|user-owned|user ingest refused/i.test(msg)) {
      return json(403, { error: msg });
    }
    return json(500, { error: `ingest_match: ${msg}` });
  }
  return json(200, data);
}

async function handleSystemIngest(body: IngestBody): Promise<Response> {
  const id = body.id ?? "";
  if (!isSystemMatchId(id)) {
    return json(400, { error: "id is required" });
  }

  const queue = body.queue ?? "jobs_bulk";
  const priority = body.priority ?? (queue === "jobs_interactive" ? 10 : 100);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await service.rpc("ingest_match", {
    p_id: id,
    p_owner_id: null,
    p_source_url: body.source_url ?? null,
    p_tournament: body.tournament ?? null,
    p_match_date: body.match_date ?? null,
    p_team1_player1: body.team1_player1 ?? null,
    p_team1_player2: body.team1_player2 ?? null,
    p_team2_player1: body.team2_player1 ?? null,
    p_team2_player2: body.team2_player2 ?? null,
    p_g1_t1: body.g1_t1 ?? null,
    p_g1_t2: body.g1_t2 ?? null,
    p_g2_t1: body.g2_t1 ?? null,
    p_g2_t2: body.g2_t2 ?? null,
    p_g3_t1: body.g3_t1 ?? null,
    p_g3_t2: body.g3_t2 ?? null,
    p_queue: queue,
    p_priority: priority,
    p_upsert: body.upsert ?? true,
  });
  if (error) {
    const msg = error.message ?? "";
    if (/user-owned|system ingest refused/i.test(msg)) {
      return json(409, { error: msg });
    }
    return json(500, { error: `ingest_match: ${msg}` });
  }
  return json(200, data);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  let body: IngestBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const serviceToken = Deno.env.get("PIPELINE_SERVICE_TOKEN");
  const provided = request.headers.get("x-pipeline-token") ?? "";
  const hasPipeline =
    !!serviceToken && !!provided && (await timingSafeEqual(provided, serviceToken));

  if (body.upload === true || (!hasPipeline && request.headers.get("Authorization"))) {
    return handleUserUpload(request, body);
  }

  if (!serviceToken) {
    return json(500, { error: "PIPELINE_SERVICE_TOKEN not configured" });
  }
  if (!hasPipeline) return json(401, { error: "Bad pipeline token" });

  return handleSystemIngest(body);
});
