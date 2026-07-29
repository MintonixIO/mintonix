import { NextResponse } from "next/server";
import { searchCatalog } from "@/lib/bwf/catalog";

export const dynamic = "force-dynamic";

const MAX_Q = 100;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("q") ?? "";
  const q = raw.trim().slice(0, MAX_Q);
  if (!q) {
    return NextResponse.json({ hits: [] });
  }
  try {
    const hits = await searchCatalog(q, 10);
    return NextResponse.json({ hits });
  } catch (err) {
    console.error("[api/bwf/search]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { hits: [], error: "Search temporarily unavailable" },
      { status: 500 },
    );
  }
}
