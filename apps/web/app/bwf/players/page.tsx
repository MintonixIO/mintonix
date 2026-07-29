import { BwfErrorState } from "@/components/bwf/error-state";
import { PlayersView } from "@/components/bwf/players-view";
import { getCatalogPlayers } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogPlayer } from "@/lib/bwf/types";

export const revalidate = 300;

export default async function BwfPlayersPage() {
  let players: CatalogPlayer[] | null = null;
  let error: string | null = null;

  try {
    players = await getCatalogPlayers();
  } catch (err) {
    error = catalogUserError(err, "bwf/players");
  }

  if (error || !players) {
    return <BwfErrorState message={error ?? undefined} />;
  }

  return <PlayersView players={players} />;
}
