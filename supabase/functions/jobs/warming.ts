/** Pure helpers for jobs invoke: short /route/ ticks and warming requeue. */

export const ROUTE_TICK_MS = 25_000;
export const WARMING_PREFIX = "warming:";
export const WARMING_MAX_MS = 20 * 60_000;

export function warmingError(sinceIso: string): string {
  return `${WARMING_PREFIX}${sinceIso}`;
}

export function warmingExpired(
  error: string | null,
  nowMs: number,
  maxMs = WARMING_MAX_MS,
): boolean {
  if (!error?.startsWith(WARMING_PREFIX)) return false;
  const t = Date.parse(error.slice(WARMING_PREFIX.length));
  if (Number.isNaN(t)) return true;
  return nowMs - t > maxMs;
}

/** Keep the original warming ISO so the 20 min clock does not reset. */
export function warmingSinceIso(priorError: string | null, nowIso: string): string {
  if (priorError?.startsWith(WARMING_PREFIX)) {
    return priorError.slice(WARMING_PREFIX.length);
  }
  return nowIso;
}

export class WarmingError extends Error {
  readonly sinceIso: string;
  constructor(sinceIso: string) {
    super(warmingError(sinceIso));
    this.name = "WarmingError";
    this.sinceIso = sinceIso;
  }
}

export class WorkerHttpError extends Error {
  readonly status: number;
  readonly retry: boolean;
  constructor(route: string, status: number, body: string) {
    super(`vast worker ${route} failed: ${status} ${body}`);
    this.name = "WorkerHttpError";
    this.status = status;
    // 429 (gpu busy) retries without burning an attempt (warming restore).
    // 503 (models not loaded) is retryable and burns an attempt.
    // Other 4xx are terminal. Other 5xx stay retryable.
    this.retry = status === 429 || status === 503 || status >= 500;
  }
}

export function isWorkerStarted(status: number): boolean {
  return status === 202;
}

/**
 * complete_job `p_retry` for /jobs/callback.
 *
 * Worker-reported failures are terminal. After HTTP 202 the GPU already
 * ran; TRT / clamp / empty-segments fail the same way on requeue.
 * Warming, 429 (gpu busy), and 503 retries stay on the invoke path
 * (`invokeFailurePolicy`).
 */
export function callbackRetry(
  _ok: boolean,
  _attempt: number,
  _maxAttempts: number,
): boolean {
  return false;
}

export function invokeFailurePolicy(
  err: unknown,
  nowMs: number,
  attempt: number,
  maxAttempts: number,
): { retry: boolean; warming: boolean; error: string } {
  if (err instanceof WarmingError) {
    const expired = warmingExpired(err.message, nowMs);
    return {
      retry: !expired,
      warming: !expired,
      error: err.message,
    };
  }
  if (err instanceof WorkerHttpError) {
    if (err.status === 429) {
      return {
        retry: true,
        warming: true,
        error: `invoke: ${err}`,
      };
    }
    return {
      retry: err.retry && attempt < maxAttempts,
      warming: false,
      error: `invoke: ${err}`,
    };
  }
  return {
    retry: attempt < maxAttempts,
    warming: false,
    error: `invoke: ${err}`,
  };
}
