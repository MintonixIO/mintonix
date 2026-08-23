import type { Metadata } from "next";
import { HomeView } from "@/components/bwf/home-view";
import { BwfErrorState } from "@/components/bwf/error-state";
import { getCatalogStats, listFormBoard } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { Disc, FormBoardRow, HomeStats } from "@/lib/bwf/types";
import { DISCS } from "@/lib/bwf/types";

export const metadata: Metadata = {
  title: "BWF home",
  description:
    "BWF match catalog — form boards by discipline, scores, and video.",
};

export const revalidate = 300;

const HOME_FORM_LIMIT = 12;

export default async function BwfHomePage() {
  let stats: HomeStats | null = null;
  let formByDisc: Record<Disc, { rows: FormBoardRow[]; total: number }> | null =
    null;
  let error: string | null = null;

  try {
    const [full, ...boards] = await Promise.all([
      getCatalogStats(),
      ...DISCS.map((d) => listFormBoard({ disc: d, limit: HOME_FORM_LIMIT })),
    ]);
    stats = {
      matches: full.matches,
      players: full.players,
      tournaments: full.tournaments,
      withVideo: full.withVideo,
      byDisc: full.byDisc,
    };
    formByDisc = Object.fromEntries(
      DISCS.map((d, i) => [d, boards[i] ?? { rows: [], total: 0 }]),
    ) as Record<Disc, { rows: FormBoardRow[]; total: number }>;
  } catch (err) {
    error = catalogUserError(err, "bwf/home");
  }

  if (error || !stats || !formByDisc) {
    return <BwfErrorState message={error ?? undefined} />;
  }

  return <HomeView stats={stats} formByDisc={formByDisc} />;
}
