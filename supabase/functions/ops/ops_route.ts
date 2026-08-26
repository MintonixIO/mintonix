/**
 * Route ops POSTs. Supabase may invoke the `ops` function with pathname
 * `/ops` (or `/functions/v1/ops`) even when the client called
 * `/functions/v1/ops/model-urls` — subpath is not always forwarded.
 * Fall back to body shape so CI `ops/model-urls` still works.
 */
export type OpsRoute = "model-urls" | "set-stage" | "unknown";

export function opsRoute(
  pathname: string,
  body: Record<string, unknown>,
): OpsRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path.endsWith("/model-urls")) return "model-urls";
  if (path.endsWith("/set-stage")) return "set-stage";
  const hasKeys = Array.isArray(body.keys);
  const hasMatch = typeof body.match_id === "string" && body.match_id.length > 0;
  if (hasKeys && !hasMatch) return "model-urls";
  if (hasMatch) return "set-stage";
  return "unknown";
}
