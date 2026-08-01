import { BwfErrorState } from "@/components/bwf/error-state";
import { PlayersView } from "@/components/bwf/players-view";
import {
  listDirectoryBoard,
  listDirectoryPlayers,
} from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { Disc } from "@/lib/bwf/types";
import { DISCS } from "@/lib/bwf/types";
import type { BoardMetricKey } from "@/components/bwf/board-metrics";
import { BOARD_METRICS } from "@/components/bwf/board-metrics";

export const revalidate = 300;

const PAGE_SIZE = 60;

function parseDisc(raw: string | undefined): "all" | Disc {
  if (raw && (DISCS as string[]).includes(raw)) return raw as Disc;
  return "all";
}

function parseMetric(raw: string | undefined): BoardMetricKey {
  if (raw && BOARD_METRICS.some((m) => m.key === raw)) {
    return raw as BoardMetricKey;
  }
  return "winRate";
}

export default async function BwfPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    disc?: string;
    page?: string;
    mode?: string;
    metric?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const disc = parseDisc(sp.disc);
  const mode = sp.mode === "boards" ? "boards" : "profiles";
  const metric = parseMetric(sp.metric);
  const page = Math.max(1, Number(sp.page) || 1);

  try {
    if (mode === "boards") {
      const board = await listDirectoryBoard({
        q,
        disc,
        metric,
        limit: 50,
      });
      return (
        <PlayersView
          mode="boards"
          q={q}
          disc={disc}
          boardMetric={metric}
          boardPlayers={board.players}
          boardTotal={board.total}
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
        boardMetric={metric}
        boardPlayers={[]}
        boardTotal={0}
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
