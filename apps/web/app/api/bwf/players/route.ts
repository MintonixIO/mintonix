import { NextResponse } from "next/server";
import { searchDirectoryPlayers } from "@/lib/bwf/catalog";
import { BWF_SEARCH_MAX_Q } from "@/lib/bwf/types";

export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_HITS = 40;
/** Per-IP soft limit for player typeahead. */
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
      { players: [], error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, BWF_SEARCH_MAX_Q);
  const limitRaw = Number(searchParams.get("limit") ?? MAX_HITS);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 80)
    : MAX_HITS;

  try {
    const players = await searchDirectoryPlayers(q, limit);
    return NextResponse.json(
      { players },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.error(
      "[api/bwf/players]",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { players: [], error: "Search temporarily unavailable" },
      { status: 500 },
    );
  }
}
