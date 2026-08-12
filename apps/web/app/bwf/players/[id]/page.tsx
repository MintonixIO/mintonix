import { notFound } from "next/navigation";
import { BwfErrorState } from "@/components/bwf/error-state";
import { PlayerProfile } from "@/components/bwf/player-profile";
import { getPlayerById, getPlayerMatches } from "@/lib/bwf/catalog";
import { catalogUserError } from "@/lib/bwf/errors";
import type { CatalogMatch, CatalogPlayer } from "@/lib/bwf/types";

export const revalidate = 300;

export default async function BwfPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let profile: CatalogPlayer | null = null;
  let matches: CatalogMatch[] = [];
  let error: string | null = null;

  try {
    profile = await getPlayerById(id);
    if (profile) matches = await getPlayerMatches(id, 40);
  } catch (err) {
    error = catalogUserError(err, "bwf/player-detail");
  }

  if (error) {
    return <BwfErrorState title="Could not load player" message={error} />;
  }
  if (!profile) notFound();

  return <PlayerProfile profile={profile} matches={matches} />;
}
