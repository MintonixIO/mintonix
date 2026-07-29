import { BwfErrorState } from "@/components/bwf/error-state";
import { HomeView } from "@/components/bwf/home-view";
import {
  getCatalogStats,
  getRecentMatches,
  getTopPlayers,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogMatch, CatalogPlayer, CatalogStats } from "@/lib/bwf/types";

export const revalidate = 300;

export default async function BwfHomePage() {
  let stats: CatalogStats | null = null;
  let recentMatches: CatalogMatch[] = [];
  let topMs: CatalogPlayer[] = [];
  let topWs: CatalogPlayer[] = [];
  let error: string | null = null;

  try {
    [stats, recentMatches, topMs, topWs] = await Promise.all([
      getCatalogStats(),
      getRecentMatches(6),
      getTopPlayers({ disc: "MS", limit: 8 }),
      getTopPlayers({ disc: "WS", limit: 8 }),
    ]);
  } catch (err) {
    error = catalogUserError(err, "bwf/home");
  }

  if (error || !stats) return <BwfErrorState message={error ?? undefined} />;

  return (
    <HomeView
      stats={stats}
      recentMatches={recentMatches}
      topMs={topMs}
      topWs={topWs}
    />
  );
}
