import { NextResponse } from "next/server";
import { searchCatalog } from "@/lib/bwf/catalog";
import { BWF_SEARCH_LIMIT, BWF_SEARCH_MAX_Q } from "@/lib/bwf/types";

export const dynamic = "force-dynamic";

/** Short private cache for identical queries; still force-dynamic for catalog freshness. */
const SEARCH_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
};

export async function GET(request: Request) {
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
