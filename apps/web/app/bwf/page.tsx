import type { Metadata } from "next";
import { BwfErrorState } from "@/components/bwf/error-state";
import { HomeView } from "@/components/bwf/home-view";
import {
  getCatalogStats,
  getFeaturedMatches,
  getThisWeekMatches,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogMatch, HomeStats } from "@/lib/bwf/types";


export const metadata: Metadata = {
  title: "BWF home",
  description: "BWF match catalog — this week's results, scores, and video.",
};

export const revalidate = 300;

export default async function BwfHomePage() {
  let stats: HomeStats | null = null;
  let thisWeek: CatalogMatch[] = [];
  let featuredMatches: CatalogMatch[] = [];
  let error: string | null = null;

  try {
    const [full, week, featured] = await Promise.all([
      getCatalogStats(),
      getThisWeekMatches(12),
      getFeaturedMatches(6),
    ]);
    stats = {
      matches: full.matches,
      players: full.players,
      tournaments: full.tournaments,
      withVideo: full.withVideo,
      byDisc: full.byDisc,
    };
    thisWeek = week;
    featuredMatches = featured;
  } catch (err) {
    error = catalogUserError(err, "bwf/home");
  }

  if (error || !stats) return <BwfErrorState message={error ?? undefined} />;

  return (
    <HomeView
      stats={stats}
      thisWeek={thisWeek}
      featuredMatches={featuredMatches}
    />
  );
}
