import type { Metadata } from "next";
import { BwfErrorState } from "@/components/bwf/error-state";
import { PlayersView } from "@/components/bwf/players-view";
import {
  listDirectoryPlayers,
  listFormBoard,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { Disc } from "@/lib/bwf/types";
import { DISCS } from "@/lib/bwf/types";


export const metadata: Metadata = {
  title: "BWF players",
  description: "Player directory and form boards from BWF catalog results.",
};

export const revalidate = 300;

const PAGE_SIZE = 60;

function parseDisc(raw: string | undefined): "all" | Disc {
  if (raw && (DISCS as string[]).includes(raw)) return raw as Disc;
  return "all";
}

export default async function BwfPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    disc?: string;
    page?: string;
    mode?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const disc = parseDisc(sp.disc);
  const mode = sp.mode === "boards" ? "boards" : "profiles";
  const page = Math.max(1, Number(sp.page) || 1);

  try {
    if (mode === "boards") {
      const board = await listFormBoard({
        q,
        disc,
        limit: 80,
      });
      return (
        <PlayersView
          mode="boards"
          q={q}
          disc={disc}
          formBoard={board.rows}
          formBoardTotal={board.total}
          players={[]}
          total={board.total}
          page={1}
          pageSize={PAGE_SIZE}
          totalPages={1}
        />
      );
    }

    const listed = await listDirectoryPlayers({
      q,
      disc,
      page,
      pageSize: PAGE_SIZE,
    });
    return (
      <PlayersView
        mode="profiles"
        q={q}
        disc={disc}
        formBoard={[]}
        formBoardTotal={0}
        players={listed.players}
        total={listed.total}
        page={listed.page}
        pageSize={listed.pageSize}
        totalPages={listed.totalPages}
      />
    );
  } catch (err) {
    return (
      <BwfErrorState message={catalogUserError(err, "bwf/players")} />
    );
  }
}
