import type { Metadata } from "next";
import { BwfErrorState } from "@/components/bwf/error-state";
import { HomeView } from "@/components/bwf/home-view";
import {
  getCatalogStats,
  getFeaturedMatches,
  getTopPlayers,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type {
  CatalogMatch,
  DirectoryPlayer,
  HomeStats,
} from "@/lib/bwf/types";


export const metadata: Metadata = {
  title: "BWF home",
  description: "BWF match catalog home — stats, top players, featured matches.",
};

export const revalidate = 300;

export default async function BwfHomePage() {
  let stats: HomeStats | null = null;
  let featuredMatches: CatalogMatch[] = [];
  let topMs: DirectoryPlayer[] = [];
  let topWs: DirectoryPlayer[] = [];
  let error: string | null = null;

  try {
    const [full, featured, ms, ws] = await Promise.all([
      getCatalogStats(),
      getFeaturedMatches(6),
      getTopPlayers({ disc: "MS", limit: 8 }),
      getTopPlayers({ disc: "WS", limit: 8 }),
    ]);
    // Home only needs headline counts + disc chips — drop events/rounds/years.
    stats = {
      matches: full.matches,
      players: full.players,
      tournaments: full.tournaments,
      withVideo: full.withVideo,
      byDisc: full.byDisc,
    };
    featuredMatches = featured;
    topMs = ms;
    topWs = ws;
  } catch (err) {
    error = catalogUserError(err, "bwf/home");
  }

  if (error || !stats) return <BwfErrorState message={error ?? undefined} />;

  return (
    <HomeView
      stats={stats}
      featuredMatches={featuredMatches}
      topMs={topMs}
      topWs={topWs}
    />
  );
}
