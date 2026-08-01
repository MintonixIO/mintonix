import type { Metadata } from "next";
import { Suspense } from "react";
import { BwfErrorState } from "@/components/bwf/error-state";
import { MatchesView } from "@/components/bwf/matches-view";
import { getCatalogStats, queryMatches } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogMatch, CatalogStats, Disc } from "@/lib/bwf/types";
import { DISCS } from "@/lib/bwf/types";


export const metadata: Metadata = {
  title: "BWF matches",
  description: "Browse and filter BWF matches from the Mintonix catalog.",
};

export const revalidate = 300;

function parseDisc(v: string | undefined): Disc | "all" {
  if (v && (DISCS as string[]).includes(v)) return v as Disc;
  return "all";
}

function parseLens(
  v: string | undefined,
): "all" | "video" | "three" | "comeback" {
  if (v === "video" || v === "three" || v === "comeback") return v;
  return "all";
}

function parseSort(
  v: string | undefined,
): "event" | "round" | "created" | "status" {
  if (v === "round" || v === "created" || v === "status" || v === "event") {
    return v;
  }
  return "event";
}

export default async function BwfMatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const disc = parseDisc(get("disc"));
  const lens = parseLens(get("lens"));
  const sort = parseSort(get("sort"));
  const q = get("q") ?? "";
  const event = get("event") ?? "";
  const round = get("round") ?? "";
  const yearRaw = get("year");
  const year =
    yearRaw && yearRaw !== "all" && !Number.isNaN(Number(yearRaw))
      ? Number(yearRaw)
      : "all";
  const page = Math.max(1, Number(get("page") || "1") || 1);

  let result: {
    matches: CatalogMatch[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null = null;
  let stats: CatalogStats | null = null;
  let error: string | null = null;

  try {
    [result, stats] = await Promise.all([
      queryMatches({
        q,
        disc,
        event,
        round,
        year,
        sort,
        page,
        pageSize: 24,
        hasVideo: lens === "video" ? true : undefined,
        threeGames: lens === "three" ? true : undefined,
        comeback: lens === "comeback" ? true : undefined,
      }),
      getCatalogStats(),
    ]);
  } catch (err) {
    error = catalogUserError(err, "bwf/matches");
  }

  if (error || !result || !stats) {
    return <BwfErrorState message={error ?? undefined} />;
  }

  return (
    <Suspense
      fallback={
        <div className="py-16 text-center font-mono text-sm text-[var(--text-muted)]">
          Loading matches…
        </div>
      }
    >
      <MatchesView
        matches={result.matches}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        stats={stats}
        filters={{
          q,
          disc,
          event,
          round,
          year: year === "all" ? "all" : String(year),
          sort,
          lens,
        }}
      />
    </Suspense>
  );
}
