/** Pure settle + fused complete_job args. Presign I/O stays in index.ts. */

export type CallbackBody = Record<string, unknown> & {
  request_id?: string;
  status?: string;
  error?: string;
  duration?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
};

export interface Settlement {
  match: Record<string, unknown>;
  next: { stage: string } | null;
  complete_stage?: string;
}

function probeFields(body: CallbackBody): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.duration != null) out.duration_sec = body.duration;
  if (body.width != null) out.width = body.width;
  if (body.height != null) out.height = body.height;
  if (body.fps != null) out.fps = body.fps;
  return out;
}

export function normalizeOutputKeys(prefix: string): {
  video: string;
  thumbnail: string;
  log: string;
  detections: string;
} {
  return {
    video: `${prefix}normalized.mp4`,
    thumbnail: `${prefix}thumbnail.jpg`,
    log: `${prefix}preprocess-log.json`,
    detections: `${prefix}detections.json`,
  };
}

export function settleNormalize(
  _job: unknown,
  body: CallbackBody,
  ok: boolean,
): Settlement {
  const probes = probeFields(body);
  if (!ok) return { match: probes, next: null };
  return {
    match: { status: "ready", ...probes },
    next: null,
    complete_stage: "detect",
  };
}

export function settleDetect(
  _job: unknown,
  body: CallbackBody,
  ok: boolean,
): Settlement {
  if (!ok) return { match: {}, next: null };
  return { match: { status: "ready", ...probeFields(body) }, next: null };
}

export function completeJobStageFields(s: Settlement): {
  p_next_stage: string | null;
  p_complete_stage: string | null;
} {
  const p_next_stage = s.next?.stage ?? null;
  const p_complete_stage = s.complete_stage ?? null;
  if (p_next_stage && p_complete_stage) {
    throw new Error("p_next_stage and p_complete_stage are mutually exclusive");
  }
  return { p_next_stage, p_complete_stage };
}

/** RPC fields /jobs/callback spreads into complete_job. Failures never jump. */
export function callbackCompleteJobParams(
  settlement: Settlement,
  ok: boolean,
  error?: string | null,
): {
  p_status: "complete" | "failed";
  p_error: string | null;
  p_match: Record<string, unknown>;
  p_next_stage: string | null;
  p_complete_stage: string | null;
} {
  if (!ok) {
    return {
      p_status: "failed",
      p_error: error ?? "unknown worker error",
      p_match: settlement.match,
      p_next_stage: null,
      p_complete_stage: null,
    };
  }
  const { p_next_stage, p_complete_stage } = completeJobStageFields(settlement);
  return {
    p_status: "complete",
    p_error: null,
    p_match: settlement.match,
    p_next_stage,
    p_complete_stage,
  };
}
