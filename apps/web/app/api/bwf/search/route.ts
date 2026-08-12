import { NextResponse } from "next/server";
import { searchCatalog } from "@/lib/bwf/catalog";
import { BWF_SEARCH_LIMIT, BWF_SEARCH_MAX_Q } from "@/lib/bwf/types";

export const dynamic = "force-dynamic";

/** Short private cache for identical queries; still force-dynamic for catalog freshness. */
const SEARCH_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
};

const WINDOW_MS = 60_000;
/** Soft per-IP cap; cold catalog rebuilds are expensive. */
const MAX_PER_WINDOW = 60;

type Bucket = { resetAt: number; count: number };
const buckets = new Map<string, Bucket>();

function clientKey(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

function rateLimit(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { resetAt: now + WINDOW_MS, count: 1 });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count += 1;
  return true;
}

export async function GET(request: Request) {
  if (!rateLimit(clientKey(request))) {
    return NextResponse.json(
      { hits: [], error: "Too many requests" },
      {
        status: 429,
        headers: { ...SEARCH_CACHE_HEADERS, "Retry-After": "60" },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("q") ?? "";
  const q = raw.trim().slice(0, BWF_SEARCH_MAX_Q);
  if (!q) {
    return NextResponse.json(
      { hits: [] },
      { headers: SEARCH_CACHE_HEADERS },
    );
  }
  try {
    const hits = await searchCatalog(q, BWF_SEARCH_LIMIT);
    return NextResponse.json(
      { hits },
      { headers: SEARCH_CACHE_HEADERS },
    );
  } catch (err) {
    console.error("[api/bwf/search]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { hits: [], error: "Search temporarily unavailable" },
      { status: 500 },
    );
  }
}
