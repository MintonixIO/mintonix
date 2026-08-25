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
    // 503 (models not loaded) is retryable and burns an attempt — not warming.
    // Other 4xx are terminal. Other 5xx stay retryable.
    this.retry = status === 503 || status >= 500;
  }
}

export function isWorkerStarted(status: number): boolean {
  return status === 202 || status === 200;
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
