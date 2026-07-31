import { BwfErrorState } from "@/components/bwf/error-state";
import { PlayersView } from "@/components/bwf/players-view";
import { getDirectoryPlayers } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { DirectoryPlayer } from "@/lib/bwf/types";

export const revalidate = 300;

export default async function BwfPlayersPage() {
  let players: DirectoryPlayer[] | null = null;
  let error: string | null = null;

  try {
    players = await getDirectoryPlayers();
  } catch (err) {
    error = catalogUserError(err, "bwf/players");
  }

  if (error || !players) {
    return <BwfErrorState message={error ?? undefined} />;
  }

  return <PlayersView players={players} />;
}
