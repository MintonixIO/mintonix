import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

function firstQueryValue(
  raw: string | string[] | undefined,
): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function BwfHomePage({
  searchParams,
}: {
  searchParams: Promise<{ disc?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawDisc = firstQueryValue(sp.disc);
  if (rawDisc && !(DISCS as string[]).includes(rawDisc)) {
    redirect("/bwf");
  }
  const disc: Disc =
    rawDisc && (DISCS as string[]).includes(rawDisc)
      ? (rawDisc as Disc)
      : "MS";
  let stats: HomeStats | null = null;
  let board: { rows: FormBoardRow[]; total: number } | null = null;
  let error: string | null = null;

  try {
    const [full, listed] = await Promise.all([
      getCatalogStats(),
      listFormBoard({ disc, limit: HOME_FORM_LIMIT }),
    ]);
    stats = {
      matches: full.matches,
      players: full.players,
      tournaments: full.tournaments,
      withVideo: full.withVideo,
      byDisc: full.byDisc,
    };
    board = listed;
  } catch (err) {
    error = catalogUserError(err, "bwf/home");
  }

  if (error || !stats || !board) {
    return <BwfErrorState message={error ?? undefined} />;
  }

  return (
    <HomeView
      stats={stats}
      disc={disc}
      formBoard={board.rows}
      formBoardTotal={board.total}
    />
  );
}
