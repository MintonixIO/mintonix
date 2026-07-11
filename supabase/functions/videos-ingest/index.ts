/**
 * videos-ingest — the single front door of the video pipeline.
 *
 * Every producer that wants a video to exist calls this ONE endpoint: the BWF
 * scraper / backlog scripts (service token), admin/test curls (service token),
 * and eventually the web app's upload-confirm (user JWT). It never watches
 * tables and nothing watches it — the insert and the enqueue happen together
 * in the `ingest_video` RPC, one transaction, so a videos row can never exist
 * without its queue message or vice versa. Dispatching is deliberately NOT
 * here (see the jobs function): ingest must survive vast downtime, and
 * priority/spend caps belong in one place, the dispatcher.
 *
 * POST /functions/v1/videos-ingest      (verify_jwt=false; auth is in-function)
 *   headers: x-pipeline-token: <PIPELINE_SERVICE_TOKEN>   (system producers)
 *   body: {
 *     "source_kind": "youtube" | "backlog",
 *     "source_url":  "https://www.youtube.com/watch?v=…",  // youtube only
 *     "b2_prefix":   "matches/<key>/",       // optional; youtube: derived from the video id
 *     "queue":       "jobs_bulk" | "jobs_interactive",     // default jobs_bulk
 *     "priority":    100,                                  // default per queue
 *     // BWF: build valid_frames_config from a tournament preset + the
 *     // per-match player names (presets carry geometry only)
 *     "annotation_preset_id": 2,
 *     "player_names": ["CHEN", "LIN"]
 *   }
 *   -> 200 { "video_id", "job_id", "b2_prefix" }
 *
 * source_kind "upload" (user JWT auth, two-phase create → PUT → confirm) is
 * not implemented yet — this ships the system path first for the BWF test.
 *
 * When a preset is used, the resolved geometry is also materialized to
 * <b2_prefix>court_annotation.json (via the CDN Worker /presign control plane)
 * and registered in video_assets — best-effort: the job itself carries the
 * config in params, so a failed materialization never blocks the pipeline.
 *
 * Secrets: PIPELINE_SERVICE_TOKEN; CDN_PRESIGN_URL + PRESIGN_SERVICE_TOKEN
 * (materialization only). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY injected.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time compare so the service-token check can't be timed.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Mirrors normalize.py's is_youtube_url() host whitelist; returns the video id
// so the B2 prefix can default to matches/<id>/.
function youtubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    id = url.searchParams.get("v");
  } else {
    return null;
  }
  return id && /^[A-Za-z0-9_-]{5,20}$/.test(id) ? id : null;
}

interface Preset {
  id: number;
  tournament: string;
  corners: number[][];
  scoreboard_crop: Record<string, number>;
  score_sub_crop: Record<string, number>;
  row_split_y: number;
}

// Best-effort: PUT the resolved annotation to B2 and register the asset. The
// job already carries the config in params — this only materializes the
// canonical per-video file future consumers read.
async function materializeAnnotation(
  // deno-lint-ignore no-explicit-any — the generated DB types don't exist in
  // this repo yet; the structural client type varies across createClient
  // instantiations.
  service: any,
  videoId: string,
  b2Prefix: string,
  preset: Preset,
  playerNames: string[],
): Promise<void> {
  const presignUrl = Deno.env.get("CDN_PRESIGN_URL");
  const presignToken = Deno.env.get("PRESIGN_SERVICE_TOKEN");
  if (!presignUrl || !presignToken) {
    console.warn("annotation not materialized: presign control plane not configured");
    return;
  }
  const key = `${b2Prefix}court_annotation.json`;
  const presignResp = await fetch(presignUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${presignToken}`,
    },
    body: JSON.stringify({ key, op: "PUT", expiresIn: 300 }),
  });
  if (!presignResp.ok) throw new Error(`presign PUT ${key}: ${presignResp.status}`);
  const { url } = await presignResp.json() as { url: string };

  const body = JSON.stringify({
    corners: preset.corners,
    scoreboard_crop: preset.scoreboard_crop,
    score_sub_crop: preset.score_sub_crop,
    row_split_y: preset.row_split_y,
    player_names: playerNames,
    preset_id: preset.id,
    tournament: preset.tournament,
  });
  const putResp = await fetch(url, { method: "PUT", body });
  if (!putResp.ok) throw new Error(`PUT ${key}: ${putResp.status}`);

  const { error } = await service.from("video_assets").upsert({
    video_id: videoId,
    kind: "court_annotation",
    b2_key: key,
    bytes: body.length,
    meta: { preset_id: preset.id },
  });
  if (error) throw new Error(`register court_annotation: ${error.message}`);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  const serviceToken = Deno.env.get("PIPELINE_SERVICE_TOKEN");
  if (!serviceToken) return json(500, { error: "PIPELINE_SERVICE_TOKEN not configured" });
  const provided = request.headers.get("x-pipeline-token") ?? "";
  if (!provided || !timingSafeEqual(provided, serviceToken)) {
    return json(401, { error: "Bad pipeline token" });
  }

  let body: {
    source_kind?: string;
    source_url?: string;
    b2_prefix?: string;
    queue?: string;
    priority?: number;
    annotation_preset_id?: number;
    player_names?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const sourceKind = body.source_kind ?? "";
  if (sourceKind === "upload") {
    return json(501, { error: "upload ingest (user JWT + confirm flow) is not implemented yet" });
  }
  if (!["youtube", "backlog"].includes(sourceKind)) {
    return json(400, { error: "source_kind must be youtube or backlog" });
  }

  let b2Prefix = body.b2_prefix ?? null;
  if (sourceKind === "youtube") {
    const ytId = youtubeVideoId(body.source_url ?? "");
    if (!ytId) return json(400, { error: "source_url is not a recognizable YouTube URL" });
    b2Prefix ??= `matches/${ytId}/`;
  }
  if (!b2Prefix) return json(400, { error: "b2_prefix is required for backlog ingest" });

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // BWF: geometry from the tournament preset + per-match player names. All
  // five fields are required together by the worker's upfront 422 validation,
  // so reject an unusable combination here, before anything is written.
  let params: Record<string, unknown> = {};
  let preset: Preset | null = null;
  const playerNames = body.player_names ?? [];
  if (body.annotation_preset_id != null) {
    if (playerNames.length === 0 || playerNames.some((n) => typeof n !== "string" || !n)) {
      return json(400, { error: "player_names (non-empty strings) are required with annotation_preset_id" });
    }
    const { data, error } = await service
      .from("annotation_presets")
      .select("id, tournament, corners, scoreboard_crop, score_sub_crop, row_split_y")
      .eq("id", body.annotation_preset_id)
      .single();
    if (error || !data) {
      return json(404, { error: `annotation preset ${body.annotation_preset_id} not found` });
    }
    preset = data as unknown as Preset;
    params = {
      valid_frames_config: {
        court_corners: preset.corners,
        scoreboard_crop: preset.scoreboard_crop,
        score_sub_crop: preset.score_sub_crop,
        row_split_y: preset.row_split_y,
        player_names: playerNames,
      },
    };
  }

  const { data, error } = await service.rpc("ingest_video", {
    p_source_kind: sourceKind,
    p_source_url: body.source_url ?? null,
    p_owner_id: null,
    p_b2_prefix: b2Prefix,
    p_params: params,
    p_queue: body.queue ?? "jobs_bulk",
    p_priority: body.priority ?? (body.queue === "jobs_interactive" ? 10 : 100),
  });
  if (error) return json(500, { error: `ingest_video: ${error.message}` });
  const { video_id, job_id } = data as { video_id: string; job_id: string };

  if (preset) {
    try {
      await materializeAnnotation(service, video_id, b2Prefix, preset, playerNames);
    } catch (e) {
      console.warn(`court_annotation materialization failed (job unaffected): ${e}`);
    }
  }

  return json(200, { video_id, job_id, b2_prefix: b2Prefix });
});
